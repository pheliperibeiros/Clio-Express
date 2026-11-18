// Clio - Native Tauri commands
// Disk I/O for crash-safe recording chunks, persistent settings,
// native folder/file picking and direct file writing.

use std::fs::{self, OpenOptions};
use std::io::Write;
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
