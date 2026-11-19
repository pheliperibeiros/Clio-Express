// Clio - Native Tauri commands
// Disk I/O for crash-safe recording chunks, persistent settings,
// native folder/file picking and direct file writing.

use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tokio::task::spawn_blocking;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Falha ao obter diretório de dados do app: {e}"))
}

fn recordings_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join("recordings"))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join("clio_settings.json"))
}

/// Resolve o diretório de uma sessão validando o ID (evita path traversal
/// como "../../Windows").
fn session_dir(app: &tauri::AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let valid = !session_id.is_empty()
        && session_id.len() <= 128
        && session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err("ID de sessão inválido".into());
    }
    Ok(recordings_dir(app)?.join(session_id))
}

/// Aceita apenas caminhos absolutos e sem componentes "..".
fn validate_user_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("Caminho deve ser absoluto".into());
    }
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Caminho inválido".into());
    }
    Ok(p)
}

fn percent_decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3).ok_or("Cabeçalho x-path inválido")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "Cabeçalho x-path inválido")?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Cabeçalho x-path inválido".to_string())
}

// ---------------------------------------------------------------------------
// Recording session commands
// ---------------------------------------------------------------------------

/// Cria a pasta da sessão e grava meta.json (metadados + mime type), que são
/// necessários para recuperar a gravação após uma falha.
#[tauri::command]
pub fn clio_init_recording_session(
    app: tauri::AppHandle,
    session_id: String,
    metadata: serde_json::Value,
    mime_type: String,
) -> Result<(), String> {
    let dir = session_dir(&app, &session_id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Erro ao criar diretório de sessão: {e}"))?;
    let meta = serde_json::json!({ "metadata": metadata, "mimeType": mime_type });
    fs::write(dir.join("meta.json"), meta.to_string())
        .map_err(|e| format!("Erro ao gravar metadados: {e}"))?;
    Ok(())
}

fn write_chunk(
    app: &tauri::AppHandle,
    session_id: &str,
    chunk_index: u32,
    data: &[u8],
) -> Result<(), String> {
    let dir = session_dir(app, session_id)?;
    let final_path = dir.join(format!("chunk_{:06}.bin", chunk_index));
    let tmp_path = dir.join(format!("chunk_{:06}.part", chunk_index));

    let mut file = fs::File::create(&tmp_path)
        .map_err(|e| format!("Erro ao criar arquivo de chunk: {e}"))?;
    file.write_all(data)
        .map_err(|e| format!("Erro ao escrever chunk: {e}"))?;
    file.sync_data()
        .map_err(|e| format!("Erro ao sincronizar chunk: {e}"))?;
    drop(file);
    fs::rename(&tmp_path, &final_path).map_err(|e| format!("Erro ao finalizar chunk: {e}"))
}

/// Grava um chunk de forma atômica (.part -> rename) e força flush em disco.
/// Versão antiga: Vec<u8> viaja como array JSON (lento). Prefira a versão _raw.
#[tauri::command]
pub fn clio_write_recording_chunk(
    app: tauri::AppHandle,
    session_id: String,
    chunk_index: u32,
    chunk_data: Vec<u8>,
) -> Result<(), String> {
    write_chunk(&app, &session_id, chunk_index, &chunk_data)
}

/// Versão eficiente (corpo binário). Front-end:
///   await invoke("clio_write_recording_chunk_raw", uint8Array, {
///     headers: { "x-session-id": sessionId, "x-chunk-index": String(i) }
///   });
#[tauri::command]
pub async fn clio_write_recording_chunk_raw(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<(), String> {
    let hdr = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };
    let session_id = hdr("x-session-id").ok_or("Cabeçalho x-session-id ausente")?;
    let chunk_index: u32 = hdr("x-chunk-index")
        .ok_or("Cabeçalho x-chunk-index ausente")?
        .parse()
        .map_err(|_| "x-chunk-index inválido".to_string())?;
    let data = match request.body() {
        InvokeBody::Raw(d) => d.clone(),
        _ => return Err("Corpo da requisição deve ser binário".into()),
    };
    // Fora da thread principal: o flush de cada chunk não pode travar o canvas.
    spawn_blocking(move || write_chunk(&app, &session_id, chunk_index, &data))
        .await
        .map_err(|e| format!("Erro ao gravar chunk: {e}"))?
}

#[tauri::command]
pub fn clio_finalize_recording_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let dir = session_dir(&app, &session_id)?;
    if dir.exists() {
        fs::write(dir.join("FINALIZED"), "").map_err(|e| format!("Erro ao criar marcador: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn clio_delete_recovery_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let dir = session_dir(&app, &session_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Erro ao remover sessão: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn clio_save_settings(app: tauri::AppHandle, settings_json: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Erro ao criar diretório de configurações: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &settings_json).map_err(|e| format!("Erro ao salvar configurações: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Erro ao salvar configurações: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn clio_load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_path(&app)?;
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| format!("Erro ao carregar configurações: {e}"))
    } else {
        Ok(String::new())
    }
}

// ---------------------------------------------------------------------------
// Dialogs — DEVEM ser async: comandos síncronos rodam na thread principal e
// blocking_* nela trava/deadlocka a janela.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn clio_pick_folder(
    app: tauri::AppHandle,
    title: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    if let Some(p) = default_path {
        builder = builder.set_directory(PathBuf::from(p));
    }
    spawn_blocking(move || builder.blocking_pick_folder().map(|p| p.to_string()))
        .await
        .map_err(|e| format!("Erro ao selecionar pasta: {e}"))
}

#[tauri::command]
pub async fn clio_save_file_dialog(
    app: tauri::AppHandle,
    title: Option<String>,
    default_filename: Option<String>,
    filter_name: Option<String>,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    if let Some(name) = default_filename {
        builder = builder.set_file_name(name);
    }
    if !extensions.is_empty() {
        let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
        let fname = filter_name.unwrap_or_else(|| "Arquivos".to_string());
        builder = builder.add_filter(fname, &ext_refs);
    }
    spawn_blocking(move || builder.blocking_save_file().map(|p| p.to_string()))
        .await
        .map_err(|e| format!("Erro ao abrir diálogo de salvar: {e}"))
}

// ---------------------------------------------------------------------------
// File writing
// ---------------------------------------------------------------------------

/// Versão antiga (Vec<u8> viaja como array JSON: muito lenta/pesada p/ vídeo).
/// Mantida por compatibilidade; prefira `clio_write_file_raw`.
#[tauri::command]
pub fn clio_write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let p = validate_user_path(&path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Erro ao criar pasta: {e}"))?;
    }
    fs::write(&p, &data).map_err(|e| format!("Erro ao gravar arquivo em disco: {e}"))
}

/// Escrita binária eficiente (corpo bruto, sem JSON).
/// Front-end:
///   await invoke("clio_write_file_raw", uint8Array, {
///     headers: { "x-path": encodeURIComponent(caminho), "x-append": "1" }
///   });
/// `x-append: 1` acrescenta ao arquivo (gravação em pedaços direto no destino).
#[tauri::command]
pub async fn clio_write_file_raw(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> {
    let path_hdr = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("Cabeçalho x-path ausente")?;
    let path = validate_user_path(&percent_decode(path_hdr)?)?;
    let append = request
        .headers()
        .get("x-append")
        .and_then(|v| v.to_str().ok())
        == Some("1");

    let data = match request.body() {
        InvokeBody::Raw(d) => d.clone(),
        _ => return Err("Corpo da requisição deve ser binário".into()),
    };

    // `spawn_blocking`: abrir, escrever e sincronizar (fsync) um chunk pode
    // levar dezenas de ms. Síncrono, isso travaria a thread principal e o
    // canvas (requestAnimationFrame) perderia quadros durante a gravação.
    let write_path = path.clone();
    spawn_blocking(move || -> Result<(), String> {
        if let Some(parent) = write_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Erro ao criar pasta: {e}"))?;
        }
        let mut opts = OpenOptions::new();
        opts.create(true).write(true);
        if append {
            opts.append(true);
        } else {
            opts.truncate(true);
        }
        let mut f = opts
            .open(&write_path)
            .map_err(|e| format!("Erro ao abrir arquivo: {e}"))?;
        f.write_all(&data)
            .map_err(|e| format!("Erro ao gravar arquivo em disco: {e}"))?;
        f.sync_data()
            .map_err(|e| format!("Erro ao sincronizar arquivo: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Erro ao gravar arquivo: {e}"))??;

    // Permite a prévia deste arquivo pelo protocolo `asset` (convertFileSrc).
    // O escopo da config começa vazio: só o que o próprio app grava é liberado.
    let _ = app.asset_protocol_scope().allow_file(&path);

    Ok(())
}

// ---------------------------------------------------------------------------
// Hash & finalização de arquivo
// ---------------------------------------------------------------------------

/// Calcula o SHA-256 de um arquivo em disco lendo em blocos (memória constante).
/// Retorna `{ "size": <bytes>, "sha256": "<hex>" }`.
///
/// Assíncrono + spawn_blocking: hashear vários GB não pode travar a thread
/// principal (a janela congelaria durante o cálculo).
#[tauri::command]
pub async fn clio_sha256_file(path: String) -> Result<serde_json::Value, String> {
    let p = validate_user_path(&path)?;
    spawn_blocking(move || -> Result<serde_json::Value, String> {
        use sha2::{Digest, Sha256};
        use std::io::Read;

        let mut file =
            fs::File::open(&p).map_err(|e| format!("Erro ao abrir arquivo para hash: {e}"))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1024 * 1024];
        let mut total: u64 = 0;
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| format!("Erro ao ler arquivo para hash: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            total += n as u64;
        }
        let digest = hasher.finalize();
        let hex = digest.iter().map(|b| format!("{b:02x}")).collect::<String>();
        Ok(serde_json::json!({ "size": total, "sha256": hex }))
    })
    .await
    .map_err(|e| format!("Erro ao calcular hash do arquivo: {e}"))?
}

// ---------------------------------------------------------------------------
// Duração do WebM
// ---------------------------------------------------------------------------

const SEGMENT_ID: u64 = 0x1853_8067;
const INFO_ID: u64 = 0x1549_a966;
const DURATION_ID: u64 = 0x4489;

struct EbmlElement {
    id: u64,
    size_offset: usize,
    size_length: usize,
    /// `None` quando o elemento usa tamanho desconhecido (streaming).
    size: Option<u64>,
    data_start: usize,
}

fn read_vint(buf: &[u8], pos: usize, keep_marker: bool) -> Option<(u64, usize, bool)> {
    if pos >= buf.len() {
        return None;
    }
    let first = buf[pos];
    if first == 0 {
        return None;
    }

    let mut length = 1usize;
    let mut mask: u8 = 0x80;
    while length <= 8 && (first & mask) == 0 {
        length += 1;
        mask >>= 1;
    }
    if length > 8 || pos + length > buf.len() {
        return None;
    }

    let mut value: u64 = if keep_marker {
        first as u64
    } else {
        (first & (mask - 1)) as u64
    };
    let mut unknown = !keep_marker && (first & (mask - 1)) == mask - 1;
    for i in 1..length {
        value = value * 256 + buf[pos + i] as u64;
        if buf[pos + i] != 0xff {
            unknown = false;
        }
    }

    Some((value, length, unknown))
}

fn read_element(buf: &[u8], pos: usize) -> Option<EbmlElement> {
    let (id, id_length, _) = read_vint(buf, pos, true)?;
    let (size, size_length, unknown) = read_vint(buf, pos + id_length, false)?;
    Some(EbmlElement {
        id,
        size_offset: pos + id_length,
        size_length,
        size: if unknown { None } else { Some(size) },
        data_start: pos + id_length + size_length,
    })
}

fn find_info_element(header: &[u8]) -> Option<EbmlElement> {
    let mut pos = 0usize;
    while pos < header.len() {
        let el = read_element(header, pos)?;

        if el.id == SEGMENT_ID {
            let mut child_pos = el.data_start;
            let segment_end = match el.size {
                Some(size) => (el.data_start as u64 + size).min(header.len() as u64) as usize,
                None => header.len(),
            };

            while child_pos < segment_end {
                let child = read_element(header, child_pos)?;
                if child.id == INFO_ID {
                    return Some(child);
                }
                // Cluster tem tamanho desconhecido e aparece depois do Info.
                let size = child.size?;
                let next = child.data_start as u64 + size;
                if next > header.len() as u64 {
                    return None;
                }
                child_pos = next as usize;
            }
            return None;
        }

        let next = el.data_start as u64 + el.size?;
        if next > header.len() as u64 {
            return None;
        }
        pos = next as usize;
    }
    None
}

fn patch_webm_duration(path: &Path, duration_ms: u64) -> Result<u64, String> {
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("Erro ao abrir vídeo para ajustar duração: {e}"))?;

    let file_len = file
        .metadata()
        .map_err(|e| format!("Erro ao ler dados do vídeo: {e}"))?
        .len();

    let read_len = file_len.min(1024 * 1024) as usize;
    let mut header = vec![0u8; read_len];
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Erro ao posicionar no vídeo: {e}"))?;
    file.read_exact(&mut header)
        .map_err(|e| format!("Erro ao ler cabeçalho do vídeo: {e}"))?;

    let info = find_info_element(&header)
        .ok_or("Cabeçalho WebM sem o elemento Info: duração não pôde ser ajustada")?;
    let info_size = info
        .size
        .ok_or("Elemento Info com tamanho desconhecido: duração não pôde ser ajustada")?;
    let info_end = info.data_start as u64 + info_size;
    if info_end > file_len {
        return Err("Cabeçalho WebM inconsistente: duração não pôde ser ajustada".into());
    }

    let duration_value = duration_ms.max(1) as f64;

    // Se o Duration já existir, apenas sobrescreve o valor (sem deslocar bytes).
    let mut child_pos = info.data_start;
    while (child_pos as u64) < info_end {
        let child = match read_element(&header, child_pos) {
            Some(child) => child,
            None => break,
        };

        if child.id == DURATION_ID {
            match child.size {
                Some(8) => {
                    file.seek(SeekFrom::Start(child.data_start as u64))
                        .map_err(|e| format!("Erro ao posicionar no Duration: {e}"))?;
                    file.write_all(&duration_value.to_be_bytes())
                        .map_err(|e| format!("Erro ao gravar Duration: {e}"))?;
                    file.sync_all()
                        .map_err(|e| format!("Erro ao sincronizar Duration: {e}"))?;
                    return Ok(0);
                }
                Some(4) => {
                    file.seek(SeekFrom::Start(child.data_start as u64))
                        .map_err(|e| format!("Erro ao posicionar no Duration: {e}"))?;
                    file.write_all(&(duration_value as f32).to_be_bytes())
                        .map_err(|e| format!("Erro ao gravar Duration: {e}"))?;
                    file.sync_all()
                        .map_err(|e| format!("Erro ao sincronizar Duration: {e}"))?;
                    return Ok(0);
                }
                _ => break,
            }
        }

        let size = match child.size {
            Some(size) => size,
            None => break,
        };
        let next = child.data_start as u64 + size;
        if next > info_end {
            break;
        }
        child_pos = next as usize;
    }

    // Duration: ID (2 bytes) + tamanho (1 byte) + float64 big-endian (8 bytes).
    let mut duration_element = [0u8; 11];
    duration_element[0] = 0x44;
    duration_element[1] = 0x89;
    duration_element[2] = 0x88;
    duration_element[3..11].copy_from_slice(&duration_value.to_be_bytes());

    let inserted = duration_element.len() as u64;
    let new_info_size = info_size + inserted;
    let max_size = (1u64 << (7 * info.size_length as u32)) - 2;
    if new_info_size > max_size {
        return Err("Elemento Info grande demais para receber a duração".into());
    }

    // Recalcula o VINT de tamanho do Info preservando a largura original.
    let mut size_field = vec![0u8; info.size_length];
    let mut remaining = new_info_size;
    for i in (0..info.size_length).rev() {
        size_field[i] = (remaining & 0xff) as u8;
        remaining >>= 8;
    }
    size_field[0] |= 0x80u8 >> (info.size_length - 1);

    // Abre espaço deslocando o restante do arquivo (de trás para frente,
    // em blocos, para não carregar o vídeo inteiro na memória).
    let insert_at = info_end;
    file.set_len(file_len + inserted)
        .map_err(|e| format!("Erro ao expandir o arquivo de vídeo: {e}"))?;

    let mut shift_buffer = vec![0u8; 8 * 1024 * 1024];
    let mut end = file_len;
    while end > insert_at {
        let start = end.saturating_sub(shift_buffer.len() as u64).max(insert_at);
        let count = (end - start) as usize;

        file.seek(SeekFrom::Start(start))
            .map_err(|e| format!("Erro ao posicionar para deslocar o vídeo: {e}"))?;
        file.read_exact(&mut shift_buffer[..count])
            .map_err(|e| format!("Erro ao ler bloco do vídeo: {e}"))?;

        file.seek(SeekFrom::Start(start + inserted))
            .map_err(|e| format!("Erro ao posicionar para deslocar o vídeo: {e}"))?;
        file.write_all(&shift_buffer[..count])
            .map_err(|e| format!("Erro ao deslocar bloco do vídeo: {e}"))?;

        end = start;
    }

    file.seek(SeekFrom::Start(info.size_offset as u64))
        .map_err(|e| format!("Erro ao posicionar no tamanho do Info: {e}"))?;
    file.write_all(&size_field)
        .map_err(|e| format!("Erro ao atualizar tamanho do Info: {e}"))?;

    file.seek(SeekFrom::Start(insert_at))
        .map_err(|e| format!("Erro ao posicionar para gravar a duração: {e}"))?;
    file.write_all(&duration_element)
        .map_err(|e| format!("Erro ao gravar a duração: {e}"))?;

    file.sync_all()
        .map_err(|e| format!("Erro ao sincronizar o vídeo: {e}"))?;

    Ok(inserted)
}

/// Insere o elemento Duration no cabeçalho de um WebM gravado pelo
/// MediaRecorder, permitindo que players (VLC, Windows) exibam a duração e
/// permitam adiantar/retroceder. Retorna os bytes inseridos (0 se já existia).
#[tauri::command]
pub async fn clio_fix_webm_duration(path: String, duration_ms: u64) -> Result<u64, String> {
    let p = validate_user_path(&path)?;
    spawn_blocking(move || patch_webm_duration(&p, duration_ms))
        .await
        .map_err(|e| format!("Erro ao ajustar duração do vídeo: {e}"))?
}

/// Renomeia o arquivo finalizado (`.part` -> `.webm`).
/// No Windows `fs::rename` falha se o destino já existir, então remove antes.
#[tauri::command]
pub async fn clio_rename_file(
    app: tauri::AppHandle,
    from: String,
    to: String,
) -> Result<(), String> {
    let from_p = validate_user_path(&from)?;
    let to_p = validate_user_path(&to)?;
    let allowed = to_p.clone();

    spawn_blocking(move || -> Result<(), String> {
        if let Some(parent) = to_p.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Erro ao criar pasta de destino: {e}"))?;
        }
        if to_p.exists() {
            fs::remove_file(&to_p)
                .map_err(|e| format!("Erro ao substituir arquivo existente: {e}"))?;
        }
        fs::rename(&from_p, &to_p).map_err(|e| format!("Erro ao renomear arquivo: {e}"))
    })
    .await
    .map_err(|e| format!("Erro ao renomear arquivo: {e}"))??;

    // Libera o caminho final no escopo do protocolo `asset` (prévia).
    let _ = app.asset_protocol_scope().allow_file(&allowed);

    Ok(())
}

/// Exclui um arquivo gravado pelo app (usado para limpar `.part` órfão).
/// Não falha se o arquivo já não existir.
#[tauri::command]
pub fn clio_delete_file(path: String) -> Result<(), String> {
    let p = validate_user_path(&path)?;
    if p.exists() {
        fs::remove_file(&p).map_err(|e| format!("Erro ao excluir arquivo: {e}"))?;
    }
    Ok(())
}

/// Abre a pasta (ou seleciona o arquivo) no Explorer.
#[tauri::command]
pub fn clio_open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let p = validate_user_path(&path)?;
        let norm = p.to_string_lossy().replace('/', "\\");
        let mut cmd = std::process::Command::new("explorer");
        if Path::new(&norm).is_file() {
            // raw_arg: evita o escape de aspas do Rust, que quebra o /select
            cmd.raw_arg(format!("/select,\"{}\"", norm));
        } else {
            cmd.raw_arg(format!("\"{}\"", norm));
        }
        cmd.spawn()
            .map_err(|e| format!("Falha ao abrir Explorer: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_webm_duration_inserts_element() {
        let mut data = Vec::new();
        // EBML header vazio.
        data.extend_from_slice(&[0x1A, 0x45, 0xDF, 0xA3, 0x80]);
        // Segment com tamanho desconhecido.
        data.extend_from_slice(&[
            0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        ]);
        // Info vazio.
        data.extend_from_slice(&[0x15, 0x49, 0xA9, 0x66, 0x80]);
        // Cluster com tamanho desconhecido.
        data.extend_from_slice(&[
            0x1F, 0x43, 0xB6, 0x75, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        ]);

        let path = std::env::temp_dir().join(format!(
            "clio_webm_duration_test_{}.webm",
            std::process::id()
        ));
        fs::write(&path, &data).expect("escrever fixture");

        let inserted = patch_webm_duration(&path, 12_345).expect("inserir duração");
        assert_eq!(inserted, 11);

        let patched = fs::read(&path).expect("ler arquivo corrigido");
        assert_eq!(patched.len(), data.len() + 11);
        // Info passa de tamanho 0 para 11 (VINT 0x8B) e recebe o Duration.
        assert_eq!(patched[21], 0x8B);
        assert_eq!(
            &patched[22..33],
            &[0x44, 0x89, 0x88, 0x40, 0xC8, 0x1C, 0x80, 0x00, 0x00, 0x00, 0x00]
        );
        // O Cluster original foi deslocado em 11 bytes.
        assert_eq!(&patched[33..37], &[0x1F, 0x43, 0xB6, 0x75]);

        let _ = fs::remove_file(&path);
    }
}
