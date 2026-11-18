import { OitivaMetadata, StoredRecoveryChunk } from '../types/oitiva';
import { getTauri, isTauriEnvironment } from './tauriEnvironment';

const DB_NAME = 'clio_recovery_db';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_CHUNKS = 'chunks';

export interface ActiveSessionRecord {
  id: string;
  metadata: OitivaMetadata;
  startedAt: string;
  lastChunkAt?: string;
  interruptedAt?: string;
  interruptionReason?: string;
  mimeType: string;
  isCompleted: boolean;
  totalBytes?: number;
  chunkCount?: number;
}

export interface RecoveredSessionData {
  blob: Blob;
  mimeType: string;
  metadata: OitivaMetadata;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  totalBytes: number;
  chunkCount: number;
  interruptionReason?: string;
}


/**
 * Fila sequencial das cópias nativas (`<session>/chunk_*.webm`).
 * Evita que uma escrita ainda em voo recrie a pasta da sessão depois que ela
 * for removida em `deleteRecoverySession`.
 */
let nativeChunkWrites: Promise<void> = Promise.resolve();

/**
 * Tauri desktop streaming adapter:
 * When running in Tauri, forwards chunks directly to the native desktop backend
 * so chunks are persisted immediately to the user's local disk filesystem.
 */
export async function streamChunkToTauri(
  sessionId: string,
  chunkIndex: number,
  data: Blob
): Promise<void> {
  if (!isTauriEnvironment()) return;

  nativeChunkWrites = nativeChunkWrites
    .catch(() => {})
    .then(async () => {
      try {
        const tauri = getTauri();
        if (tauri?.core?.invoke) {
          const buffer = await data.arrayBuffer();
          const uint8 = new Uint8Array(buffer);
          // Corpo binário: a versão antiga enviava um array JSON gigante
          // (`Array.from`), que custa CPU/tempo de IPC a cada segundo.
          await tauri.core.invoke('clio_write_recording_chunk_raw', uint8, {
            headers: {
              'x-session-id': sessionId,
              'x-chunk-index': String(chunkIndex),
            },
          });
        }
      } catch (tauriErr) {
        console.warn('[Tauri Desktop] Falha ao enviar bloco para o disco nativo:', tauriErr);
      }
    });

  return nativeChunkWrites;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: ['sessionId', 'chunkIndex'] });
        chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Initializes a new crash-safe journal session in IndexedDB and Tauri (if present)
 */
export async function initRecoverySession(id: string, metadata: OitivaMetadata, mimeType: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_SESSIONS], 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);

    const record: ActiveSessionRecord = {
      id,
      metadata,
      startedAt: new Date().toISOString(),
      lastChunkAt: new Date().toISOString(),
      mimeType,
      isCompleted: false,
      totalBytes: 0,
      chunkCount: 0,
    };

    store.put(record);

    // IMPORTANTE: registra os handlers da transação ANTES de qualquer await.
    // A transação do IndexedDB completa sozinha enquanto aguardamos o IPC do
    // Tauri; se o oncomplete fosse anexado depois, ele nunca dispararia e a
    // gravação ficaria travada para sempre em `await initRecoverySession(...)`.
    const txDone = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    // Inicialização nativa em disco é "fire-and-forget": nunca deve bloquear
    // o início da gravação.
    if (isTauriEnvironment()) {
      const tauri = getTauri();
      if (tauri?.core?.invoke) {
        tauri.core
          .invoke('clio_init_recording_session', {
            sessionId: id,
            metadata,
            mimeType,
          })
          .catch((tauriErr: unknown) =>
            console.warn('[Tauri Desktop] Erro ao inicializar sessão nativa:', tauriErr)
          );
      }
    }

    await txDone;
  } catch (err) {
    console.error('Failed to init recovery session in IndexedDB:', err);
  }
}

/**
 * Appends a recorded chunk into IndexedDB immediately, updating metadata heartbeat
 */
export async function saveRecoveryChunk(
  sessionId: string,
  chunkIndex: number,
  data: Blob
): Promise<void> {
  try {
    // 1. Dual-write to Tauri native filesystem if available
    streamChunkToTauri(sessionId, chunkIndex, data).catch(() => {});

    // 2. Persist to IndexedDB journal
    const db = await openDB();
    const tx = db.transaction([STORE_CHUNKS, STORE_SESSIONS], 'readwrite');
    const chunkStore = tx.objectStore(STORE_CHUNKS);
    const sessionStore = tx.objectStore(STORE_SESSIONS);

    const now = Date.now();
    const chunkRecord: StoredRecoveryChunk = {
      sessionId,
      chunkIndex,
      data,
      timestamp: now,
    };

    chunkStore.put(chunkRecord);

    // Update session heartbeat info
    const sessionReq = sessionStore.get(sessionId);
    sessionReq.onsuccess = () => {
      const record = sessionReq.result as ActiveSessionRecord | undefined;
      if (record && !record.isCompleted) {
        record.lastChunkAt = new Date(now).toISOString();
        record.chunkCount = (record.chunkCount || 0) + 1;
        record.totalBytes = (record.totalBytes || 0) + data.size;
        sessionStore.put(record);
      }
    };
  } catch (err) {
    console.warn('Failed to persist chunk in IndexedDB journal:', err);
  }
}

/**
 * Marks session as interrupted with a specific reason (hardware disconnect, crash, window closed)
 */
export async function markSessionInterrupted(
  sessionId: string,
  reason: string
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_SESSIONS], 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);

    const req = store.get(sessionId);
    req.onsuccess = () => {
      const record = req.result as ActiveSessionRecord | undefined;
      if (record && !record.isCompleted) {
        record.interruptionReason = reason;
        record.interruptedAt = new Date().toISOString();
        store.put(record);
      }
    };
  } catch (err) {
    console.warn('Failed to mark session as interrupted:', err);
  }
}

/**
 * Marks session as gracefully finished
 */
export async function finalizeRecoverySession(sessionId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_SESSIONS], 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);

    const req = store.get(sessionId);
    req.onsuccess = () => {
      const record = req.result as ActiveSessionRecord | undefined;
      if (record) {
        record.isCompleted = true;
        store.put(record);
      }
    };

    // If Tauri is active, finalize the native desktop file
    if (isTauriEnvironment()) {
      try {
        const tauri = getTauri();
        if (tauri?.core?.invoke) {
          await tauri.core.invoke('clio_finalize_recording_session', { sessionId });
        }
      } catch {}
    }
  } catch (err) {
    console.error('Failed to finalize recovery session:', err);
  }
}

/**
 * Checks if any unfinalized (crashed/interrupted) sessions exist
 */
export async function checkInterruptedSessions(): Promise<Array<{
  session: ActiveSessionRecord;
  chunkCount: number;
  totalSize: number;
}>> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_SESSIONS, STORE_CHUNKS], 'readonly');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const chunkStore = tx.objectStore(STORE_CHUNKS);

    return new Promise((resolve) => {
      const getAllSessionsReq = sessionStore.getAll();
      getAllSessionsReq.onsuccess = () => {
        const allSessions = (getAllSessionsReq.result || []) as ActiveSessionRecord[];
        const interrupted = allSessions.filter((s) => !s.isCompleted);

        if (interrupted.length === 0) {
          resolve([]);
          return;
        }

        const getAllChunksReq = chunkStore.getAll();
        getAllChunksReq.onsuccess = () => {
          const allChunks = (getAllChunksReq.result || []) as StoredRecoveryChunk[];

          const results = interrupted
            .map((session) => {
              const sessionChunks = allChunks.filter((c) => c.sessionId === session.id);
              const totalSize = sessionChunks.reduce((acc, c) => acc + (c.data?.size || 0), 0);
              return {
                session,
                chunkCount: sessionChunks.length,
                totalSize,
              };
            })
            .filter((r) => r.chunkCount > 0);

          resolve(results);
        };
        getAllChunksReq.onerror = () => resolve([]);
      };
      getAllSessionsReq.onerror = () => resolve([]);
    });
  } catch (err) {
    console.error('Error checking interrupted sessions:', err);
    return [];
  }
}

/**
 * Reconstructs full playable Blob and precise timing from recovered chunks in order
 */
export async function recoverSessionBlob(sessionId: string): Promise<RecoveredSessionData | null> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_SESSIONS, STORE_CHUNKS], 'readonly');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const chunkStore = tx.objectStore(STORE_CHUNKS);

    return new Promise((resolve, reject) => {
      const sessionReq = sessionStore.get(sessionId);
      sessionReq.onsuccess = () => {
        const session = sessionReq.result as ActiveSessionRecord | undefined;
        if (!session) {
          resolve(null);
          return;
        }

        const index = chunkStore.index('sessionId');
        const chunksReq = index.getAll(IDBKeyRange.only(sessionId));

        chunksReq.onsuccess = () => {
          const chunks = (chunksReq.result || []) as StoredRecoveryChunk[];
          chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

          if (chunks.length === 0) {
            resolve(null);
            return;
          }

          const blobParts = chunks.map((c) => c.data);
          const mimeType = session.mimeType || 'video/webm';
          const combinedBlob = new Blob(blobParts, { type: mimeType });

          const startedAtDate = new Date(session.startedAt || chunks[0].timestamp);
          const lastChunkTimestamp = chunks[chunks.length - 1].timestamp || Date.now();
          const endedAtDate = new Date(lastChunkTimestamp);

          // Calculate precise duration from chunks and timestamps (1s per chunk minimum)
          const timeSpanSeconds = Math.max(1, Math.round((lastChunkTimestamp - startedAtDate.getTime()) / 1000));
          const chunkBasedSeconds = Math.max(1, chunks.length); // With 1000ms timeslice, 1 chunk = ~1 sec
          const durationSeconds = Math.max(chunkBasedSeconds, timeSpanSeconds);

          resolve({
            blob: combinedBlob,
            mimeType,
            metadata: session.metadata,
            startedAt: startedAtDate,
            endedAt: endedAtDate,
            durationSeconds,
            totalBytes: combinedBlob.size,
            chunkCount: chunks.length,
            interruptionReason: session.interruptionReason,
          });
        };
        chunksReq.onerror = () => reject(chunksReq.error);
      };
      sessionReq.onerror = () => reject(sessionReq.error);
    });
  } catch (err) {
    console.error('Failed to recover session blob:', err);
    return null;
  }
}

/**
 * Triggers a direct download of a recovered video blob
 */
export function downloadRecoveredVideo(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Clears an old or recovered session from storage
 */
export async function deleteRecoverySession(sessionId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_SESSIONS, STORE_CHUNKS], 'readwrite');
    tx.objectStore(STORE_SESSIONS).delete(sessionId);

    const chunkStore = tx.objectStore(STORE_CHUNKS);
    const index = chunkStore.index('sessionId');
    const req = index.getAllKeys(IDBKeyRange.only(sessionId));

    req.onsuccess = () => {
      const keys = req.result || [];
      keys.forEach((key) => chunkStore.delete(key));
    };

    // If Tauri is active, also clean up native temporary files if present
    if (isTauriEnvironment()) {
      try {
        // Espera as cópias nativas em voo: sem isso, uma escrita atrasada
        // recriaria a pasta da sessão logo após a remoção.
        await nativeChunkWrites.catch(() => {});
        const tauri = getTauri();
        if (tauri?.core?.invoke) {
          await tauri.core.invoke('clio_delete_recovery_session', { sessionId });
        }
      } catch {}
    }
  } catch (err) {
    console.error('Failed to delete recovery session:', err);
  }
}
