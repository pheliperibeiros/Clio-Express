/**
 * Detects if the application is running inside a Tauri desktop container.
 */
export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as any).__TAURI__ ||
      (window as any).__TAURI_INTERNALS__ ||
      (window as any).__TAURI_METADATA__
  );
}

/**
 * Returns the Tauri runtime instance when running inside the desktop container, or null.
 */
export function getTauri(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__TAURI__ ?? null;
}

/**
 * Converts an absolute file path into a URL that the webview can load
 * (`http://asset.localhost/...` no Windows). Depende do protocolo `asset`
 * habilitado no tauri.conf.json e do arquivo liberado no escopo pelo Rust.
 */
export function filePathToSrc(path: string): string {
  const tauri = getTauri();
  if (tauri?.core?.convertFileSrc) {
    try {
      return tauri.core.convertFileSrc(path);
    } catch {
      /* cai no retorno abaixo */
    }
  }
  return path;
}
