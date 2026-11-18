import { getTauri, isTauriEnvironment } from './tauriEnvironment';

export type AuthorityRole = 'promotor' | 'juiz' | 'outro';

export interface ReportTemplateVariable {
  token: string;
  label: string;
  description: string;
}

export const REPORT_TEMPLATE_VARIABLES: ReportTemplateVariable[] = [
  { token: '[dia]', label: 'Dia', description: 'Dia do mês (ex: 15)' },
  { token: '[mes]', label: 'Mês', description: 'Mês por extenso (ex: novembro)' },
  { token: '[ano]', label: 'Ano', description: 'Ano com 4 dígitos (ex: 2026)' },
  { token: '[hora]', label: 'Hora', description: 'Horário resumido (ex: 14:30)' },
  { token: '[Inicio da Gravacao]', label: 'Começo da Gravação', description: 'Horário de início da gravação (ex: 14:30:00)' },
  { token: '[Fim da Gravacao]', label: 'Final da Gravação', description: 'Horário de término da gravação (ex: 14:45:00)' },
  { token: '[local]', label: 'Local / Órgão', description: 'Órgão ou instituição da oitiva' },
  { token: '[Titulo da Autoridade]', label: 'Título da Autoridade', description: 'Cargo configurado (ex: Promotor de Justiça)' },
  { token: '[Nome da Autoridade]', label: 'Nome da Autoridade', description: 'Nome da autoridade titular' },
  { token: '[Autoridade]', label: 'Autoridade', description: 'Autoridade conducente da oitiva' },
  { token: '[Nome da Pessoa]', label: 'Pessoa Ouvida', description: 'Nome completo do depoente' },
  { token: '[Qualificacao]', label: 'Qualificação', description: 'Condição (Testemunha, Investigado(a), etc.)' },
  { token: '[Documento]', label: 'Documento', description: 'CPF ou RG do depoente' },
  { token: '[Numero do Processo]', label: 'Nº do Processo', description: 'Número dos autos ou procedimento' },
  { token: '[Operador]', label: 'Operador', description: 'Responsável técnico pela gravação' },
  { token: '[Defensor 1]', label: 'Defensor 1', description: '1º advogado/defensor registrado' },
  { token: '[OAB 1]', label: 'OAB 1', description: 'Número da OAB do 1º advogado/defensor' },
  { token: '[Defensor 2]', label: 'Defensor 2', description: '2º advogado/defensor registrado' },
  { token: '[OAB 2]', label: 'OAB 2', description: 'Número da OAB do 2º advogado/defensor' },
  { token: '[Defensor 3]', label: 'Defensor 3', description: '3º advogado/defensor registrado' },
  { token: '[OAB 3]', label: 'OAB 3', description: 'Número da OAB do 3º advogado/defensor' },
  { token: '[Duracao]', label: 'Duração', description: 'Duração total da gravação' },
  { token: '[Arquivo]', label: 'Arquivo', description: 'Nome do arquivo de mídia gerado' },
  { token: '[Hash]', label: 'Hash SHA-256', description: 'Código hash criptográfico da gravação' },
];

export const DEFAULT_REPORT_TEMPLATE =
  'Aos [dia] dias do mês de [mes] de [ano], às [hora], na sede do [local], na presença do(a) [Titulo da Autoridade], [Nome da Autoridade], realizou-se a oitiva de [Nome da Pessoa], qualificado(a) como [Qualificacao], portador(a) do documento [Documento], no âmbito do procedimento nº [Numero do Processo]. O ato foi registrado em meio audiovisual, de forma contínua e ininterrupta.';

export interface AppSettings {
  authorityRole: AuthorityRole;
  authorityTitle: string; // "Promotor de Justiça", "Juiz de Direito", etc.
  authorityName: string; // Nome da autoridade titular
  defaultOrgao: string; // Órgão padrão (ex: Ministério Público do Estado do Tocantins)
  defaultOfficer: string; // Responsável pela gravação
  defaultProcedimentoTipo: string; // Tipo padrão (ex: Autos / Processo)
  reportTemplate: string; // Texto base do relatório com variáveis [termo]
  customLogo?: string; // Data URL da logo institucional personalizada (substitui a logo padrão do Gaeco no vídeo e sistema)
  customHeader?: string; // Data URL do cabeçalho institucional personalizado (para extrato/PDF)
  storageDirectory?: string; // Pasta de armazenamento local selecionada para os vídeos das oitivas
}

const SETTINGS_KEY = 'clio_app_settings_v1';
const SETTINGS_DB_NAME = 'clio_settings_db';
const SETTINGS_STORE = 'settings';
const SETTINGS_RECORD_ID = 'current_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  authorityRole: 'promotor',
  authorityTitle: 'Promotor de Justiça',
  authorityName: '',
  defaultOrgao: 'Ministério Público do Estado do Tocantins',
  defaultOfficer: '',
  defaultProcedimentoTipo: 'Autos',
  reportTemplate: DEFAULT_REPORT_TEMPLATE,
  customLogo: undefined,
  customHeader: undefined,
};


/**
 * Open or initialize the IndexedDB database dedicated to durable settings
 */
function openSettingsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB não suportado'));
      return;
    }
    const req = indexedDB.open(SETTINGS_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Persists settings into IndexedDB (supports large logos without localStorage 5MB quota limits)
 */
async function saveToIndexedDB(settings: AppSettings): Promise<void> {
  try {
    const db = await openSettingsDB();
    const tx = db.transaction([SETTINGS_STORE], 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    store.put({ id: SETTINGS_RECORD_ID, settings, updatedAt: new Date().toISOString() });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[Clio Settings] Falha ao persistir em IndexedDB:', err);
  }
}

/**
 * Loads settings from IndexedDB
 */
async function loadFromIndexedDB(): Promise<AppSettings | null> {
  try {
    const db = await openSettingsDB();
    const tx = db.transaction([SETTINGS_STORE], 'readonly');
    const store = tx.objectStore(SETTINGS_STORE);
    const req = store.get(SETTINGS_RECORD_ID);
    return new Promise((resolve) => {
      req.onsuccess = () => {
        if (req.result && req.result.settings) {
          resolve({
            ...DEFAULT_SETTINGS,
            ...req.result.settings,
          });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Desktop Tauri Native File Persistence:
 * Persists settings to a physical file (clio_settings.json) in the user's desktop application directory
 */
async function saveToTauriDesktop(settings: AppSettings): Promise<void> {
  if (!isTauriEnvironment()) return;
  try {
    const tauri = getTauri();
    const jsonStr = JSON.stringify(settings, null, 2);

    // Método 1: Chamada de comando IPC Tauri nativo
    if (tauri?.core?.invoke) {
      await tauri.core.invoke('clio_save_settings', {
        settingsJson: jsonStr,
      });
      return;
    }

    // Método 2: Plugin FS do Tauri
    if (tauri?.fs?.writeTextFile) {
      await tauri.fs.writeTextFile('clio_settings.json', jsonStr);
    }
  } catch (err) {
    console.warn('[Tauri Desktop] Erro ao gravar configurações no disco nativo:', err);
  }
}

/**
 * Desktop Tauri Native File Loader:
 * Reads settings from physical file (clio_settings.json) on desktop disk
 */
async function loadFromTauriDesktop(): Promise<AppSettings | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const tauri = getTauri();

    // Método 1: Chamada de comando IPC Tauri nativo
    if (tauri?.core?.invoke) {
      const result = await tauri.core.invoke('clio_load_settings');
      if (typeof result === 'string' && result.trim()) {
        const parsed = JSON.parse(result);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
      if (typeof result === 'object' && result !== null) {
        return { ...DEFAULT_SETTINGS, ...result };
      }
    }

    // Método 2: Plugin FS do Tauri
    if (tauri?.fs?.readTextFile) {
      const content = await tauri.fs.readTextFile('clio_settings.json');
      if (content) {
        const parsed = JSON.parse(content);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    }
  } catch (err) {
    console.info('[Tauri Desktop] Nenhuma configuração em arquivo físico encontrada (usando defaults/cache)');
  }
  return null;
}

/**
 * Synchronous initial load from localStorage for immediate flash-free rendering
 */
export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch (err) {
    console.warn('Erro ao carregar configurações salvas no localStorage:', err);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Asynchronous deep loader: checks Desktop Tauri file first, then IndexedDB, then LocalStorage.
 * Ensures that executable desktop instances never lose settings or high-res institutional logos.
 */
export async function loadSettingsAsync(): Promise<AppSettings> {
  // 1. Prioridade no ambiente desktop executável (Tauri)
  if (isTauriEnvironment()) {
    const desktopSettings = await loadFromTauriDesktop();
    if (desktopSettings) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(desktopSettings));
      } catch {}
      saveToIndexedDB(desktopSettings).catch(() => {});
      return desktopSettings;
    }
  }

  // 2. Prioridade de persistência estruturada (IndexedDB)
  const idbSettings = await loadFromIndexedDB();
  if (idbSettings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(idbSettings));
    } catch {}
    return idbSettings;
  }

  // 3. Fallback para localStorage
  return loadSettings();
}

/**
 * Persists settings across all layers:
 * 1. Synchronous localStorage (instant memory)
 * 2. Durable IndexedDB (no 5MB quota cap, durable browser/WebView database)
 * 3. Tauri Desktop disk filesystem (physical file when running as an executable)
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  if (typeof window === 'undefined') return;

  // 1. Save to LocalStorage with quota protection
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err: any) {
    console.warn('[Clio Settings] Aviso de cota de LocalStorage, salvando versão sem imagens pesadas no LocalStorage:', err);
    try {
      // Salva dados de texto no localStorage caso a imagem da logo estoure a cota de 5MB
      const lightSettings = { ...settings, customLogo: undefined, customHeader: undefined };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(lightSettings));
    } catch {}
  }

  // 2. Save complete object with full-resolution images to IndexedDB
  await saveToIndexedDB(settings);

  // 3. Save to Tauri Desktop Native File if running in executable desktop
  if (isTauriEnvironment()) {
    await saveToTauriDesktop(settings);
  }
}

/**
 * Exports current configuration to a downloadable JSON file for easy backup or transfer between computers
 */
export function exportSettingsFile(settings: AppSettings): void {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(settings, null, 2));
  const a = document.createElement('a');
  a.setAttribute('href', dataStr);
  a.setAttribute('download', 'clio_configuracoes.json');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Imports configuration from a user-uploaded JSON file
 */
export async function importSettingsFromFile(file: File): Promise<AppSettings> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        const merged: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
        };
        resolve(merged);
      } catch (err) {
        reject(new Error('Arquivo de configuração inválido ou corrompido.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo de configuração.'));
    reader.readAsText(file);
  });
}

/**
 * Invokes native desktop folder picker dialog.
 */
export async function pickStorageFolder(defaultPath?: string): Promise<string | null> {
  if (isTauriEnvironment()) {
    try {
      const tauri = getTauri();
      if (tauri?.core?.invoke) {
        const folder = await tauri.core.invoke('clio_pick_folder', {
          title: 'Selecionar Pasta para Armazenamento Local das Gravações',
          defaultPath: defaultPath || null,
        });
        return folder || null;
      }
    } catch (err) {
      console.warn('[Clio] Erro ao selecionar pasta no Tauri:', err);
    }
    // No Tauri não se usa showDirectoryPicker: o FileSystemHandle
    // não expõe caminhos absolutos e seria rejeitado pelo Rust
    // (validate_user_path exige caminho absoluto). Retorna null.
    return null;
  }

  // Fallback apenas para navegador puro (não-Tauri)
  if (typeof (window as any).showDirectoryPicker === 'function') {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      return handle.name || 'Pasta Selecionada';
    } catch (err: any) {
      if (err?.name !== 'AbortError') console.warn('Erro showDirectoryPicker:', err);
    }
  }

  return null;
}

/**
 * Invokes native save file dialog and writes binary content directly to disk.
 */
export async function saveFileWithNativeDialog(
  data: Uint8Array | Blob,
  suggestedName: string,
  filterName: string,
  extensions: string[]
): Promise<string | null> {
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;

  if (isTauriEnvironment()) {
    try {
      const tauri = getTauri();
      if (tauri?.core?.invoke) {
        const chosenPath = await tauri.core.invoke('clio_save_file_dialog', {
          title: `Salvar ${filterName}`,
          defaultFilename: suggestedName,
          filterName,
          extensions,
        });

        if (chosenPath) {
          await tauri.core.invoke('clio_write_file', {
            path: chosenPath,
            data: Array.from(bytes),
          });
          return chosenPath;
        }
        return null; // Cancelado pelo usuário
      }
    } catch (err) {
      console.error('[Clio] Erro ao salvar via comando Tauri:', err);
    }
  }

  // Fallback: showSaveFilePicker
  if (typeof (window as any).showSaveFilePicker === 'function') {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [{ description: filterName, accept: { 'application/octet-stream': extensions.map((e) => `.${e}`) } }],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return handle.name || suggestedName;
    } catch (err: any) {
      if (err?.name === 'AbortError') return null;
    }
  }

  // Último fallback: link <a> para download
  const blob = data instanceof Blob ? data : new Blob([bytes as unknown as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
  return suggestedName;
}

/**
 * Directly writes a file to disk via Tauri command (used for automatic video saving).
 */
export async function writeNativeFile(path: string, data: Uint8Array | Blob): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  try {
    const tauri = getTauri();
    if (tauri?.core?.invoke) {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
      await tauri.core.invoke('clio_write_file', {
        path,
        data: Array.from(bytes),
      });
      return true;
    }
  } catch (err) {
    console.error('[Clio] Erro ao gravar arquivo direto no disco:', err);
  }
  return false;
}

/**
 * Opens a path in Windows Explorer.
 */
export async function openPathNative(path: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  try {
    const tauri = getTauri();
    if (tauri?.core?.invoke) {
      await tauri.core.invoke('clio_open_path', { path });
    }
  } catch (err) {
    console.warn('[Clio] Erro ao abrir pasta:', err);
  }
}
