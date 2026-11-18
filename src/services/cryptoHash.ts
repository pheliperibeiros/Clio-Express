/**
 * Computes the SHA-256 hash of a Blob using the standard Web Crypto API.
 */
export async function computeSha256(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Formats a 64-character SHA-256 string with 8-character spacing for clear legibility on legal documents.
 * Example: "a1b2c3d4 e5f6a7b8 ..."
 */
export function formatSha256ForDisplay(hash: string): string {
  if (!hash || hash.length < 16) return hash;
  return hash.match(/.{1,8}/g)?.join(' ') ?? hash;
}

/**
 * Sanitizes names for filesystem safety according to judicial archiving conventions
 */
export function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-zA-Z0-9_-]/g, '_') // replace spaces and special chars with _
    .replace(/_+/g, '_')
    .trim();
}

/**
 * Generates official filename for the recording
 * Format: Oitiva_[Nome]_[Processo]_[DataHora].[ext]
 */
export function generateRecordingFilename(
  nome: string,
  processo: string,
  date: Date = new Date(),
  ext: string = 'webm'
): string {
  const safeNome = sanitizeFilename(nome || 'Sem_Nome');
  const safeProc = sanitizeFilename(processo || 'Sem_Proc');
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  return `Oitiva_${safeNome}_Proc-${safeProc}_${yyyy}${mm}${dd}_${hh}h${min}.${ext}`;
}
