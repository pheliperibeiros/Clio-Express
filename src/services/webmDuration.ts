import { getTauri, isTauriEnvironment } from './tauriEnvironment';

/**
 * MediaRecorder grava WebM em modo "streaming": o cabeçalho do arquivo não
 * contém o elemento Duration, então players como o VLC exibem o vídeo sem
 * duração e não permitem adiantar/retroceder. As funções abaixo inserem o
 * Duration no Segment > Info, tanto em um Blob (fallback no navegador) quanto
 * no arquivo já gravado em disco (comando nativo do Tauri).
 */

const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const DURATION_ID = 0x4489;

interface EbmlElement {
  id: number;
  sizeOffset: number;
  sizeLength: number;
  /** null quando o elemento usa tamanho desconhecido (streaming). */
  size: number | null;
  dataStart: number;
}

function readVint(
  buf: Uint8Array,
  pos: number,
  keepMarker: boolean
): { value: number; length: number; unknown: boolean } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }
  if (length > 8 || pos + length > buf.length) return null;

  let value = keepMarker ? first : first & (mask - 1);
  let unknown = !keepMarker && (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) unknown = false;
  }

  return { value, length, unknown };
}

function readElement(buf: Uint8Array, pos: number): EbmlElement | null {
  const id = readVint(buf, pos, true);
  if (!id) return null;
  const size = readVint(buf, pos + id.length, false);
  if (!size) return null;
  return {
    id: id.value,
    sizeOffset: pos + id.length,
    sizeLength: size.length,
    size: size.unknown ? null : size.value,
    dataStart: pos + id.length + size.length,
  };
}

function findInfoElement(buf: Uint8Array): EbmlElement | null {
  let pos = 0;
  while (pos < buf.length) {
    const el = readElement(buf, pos);
    if (!el) return null;

    if (el.id === SEGMENT_ID) {
      let childPos = el.dataStart;
      const segmentEnd =
        el.size === null ? buf.length : Math.min(buf.length, el.dataStart + el.size);

      while (childPos < segmentEnd) {
        const child = readElement(buf, childPos);
        if (!child) return null;
        if (child.id === INFO_ID) return child;
        // Cluster usa tamanho desconhecido e vem depois do Info: se chegamos
        // nele sem achar o Info, o cabeçalho não segue o padrão esperado.
        if (child.size === null) return null;
        childPos = child.dataStart + child.size;
      }
      return null;
    }

    if (el.size === null) return null;
    pos = el.dataStart + el.size;
  }
  return null;
}

function encodeSize(value: number, length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  let remaining = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  out[0] |= 0x80 >> (length - 1);
  return out;
}

function maxSizeForLength(length: number): number {
  return Math.pow(2, 7 * length) - 2;
}

/**
 * Retorna uma cópia do Blob com o elemento Duration gravado no Info.
 * Se o cabeçalho não puder ser interpretado, devolve o Blob original.
 */
export async function fixWebmDurationBlob(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob || blob.size === 0) return blob;

  try {
    const header = new Uint8Array(await blob.slice(0, 131072).arrayBuffer());
    const info = findInfoElement(header);
    if (!info || info.size === null) return blob;

    const infoEnd = info.dataStart + info.size;
    if (infoEnd > header.length) return blob;

    const durationMsSafe = Math.max(1, Math.round(durationMs));

    // Duration já presente: sobrescreve o valor sem alterar o tamanho.
    let childPos = info.dataStart;
    while (childPos < infoEnd) {
      const child = readElement(header, childPos);
      if (!child) break;
      if (child.id === DURATION_ID && (child.size === 4 || child.size === 8)) {
        const value = new Uint8Array(new ArrayBuffer(child.size));
        const view = new DataView(value.buffer);
        if (child.size === 8) view.setFloat64(0, durationMsSafe, false);
        else view.setFloat32(0, durationMsSafe, false);
        return new Blob(
          [
            blob.slice(0, child.dataStart),
            value,
            blob.slice(child.dataStart + child.size),
          ],
          { type: blob.type || 'video/webm' }
        );
      }
      if (child.size === null) return blob;
      childPos = child.dataStart + child.size;
    }

    // Insere o Duration (ID 2 bytes + tamanho 1 byte + float64 8 bytes).
    const durationElement = new Uint8Array(11);
    durationElement[0] = 0x44;
    durationElement[1] = 0x89;
    durationElement[2] = 0x88;
    new DataView(durationElement.buffer).setFloat64(3, durationMsSafe, false);

    const newSize = info.size + durationElement.length;
    if (newSize > maxSizeForLength(info.sizeLength)) return blob;

    return new Blob(
      [
        blob.slice(0, info.sizeOffset),
        encodeSize(newSize, info.sizeLength),
        blob.slice(info.sizeOffset + info.sizeLength, infoEnd),
        durationElement,
        blob.slice(infoEnd),
      ],
      { type: blob.type || 'video/webm' }
    );
  } catch (err) {
    console.warn('[Clio] Não foi possível inserir a duração no WebM:', err);
    return blob;
  }
}

/**
 * Insere o Duration no arquivo WebM em disco via comando nativo.
 * Retorna quantos bytes foram inseridos (0 se o Duration já existia) ou
 * `null` quando não foi possível corrigir o arquivo.
 */
export async function fixWebmDurationFile(
  path: string,
  durationMs: number
): Promise<number | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const tauri = getTauri();
    if (!tauri?.core?.invoke) return null;
    const inserted = await tauri.core.invoke('clio_fix_webm_duration', {
      path,
      durationMs: Math.max(1, Math.round(durationMs)),
    });
    return typeof inserted === 'number' ? inserted : 0;
  } catch (err) {
    console.warn('[Clio] Falha ao inserir duração no arquivo WebM:', err);
    return null;
  }
}
