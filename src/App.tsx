import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { DeviceSelector } from './components/DeviceSelector';
import { VideoCanvasCompositor } from './components/VideoCanvasCompositor';
import { MetadataForm } from './components/MetadataForm';
import { RecordingControls } from './components/RecordingControls';
import { AudioVisualizer } from './components/AudioVisualizer';
import { CrashRecoveryBanner } from './components/CrashRecoveryBanner';
import { ExtratoModal } from './components/ExtratoModal';
import { LegalHelpModal } from './components/LegalHelpModal';
import { SettingsModal } from './components/SettingsModal';
import { AlertTriangle, Focus } from 'lucide-react';

import { LayoutMode, OitivaMetadata } from './types/oitiva';
import {
  enumerateHardwareDevices,
  requestMediaPermissions,
  getCameraStream,
  getMicrophoneStream,
  DetectedDevice,
} from './services/deviceManager';
import { AudioEngine } from './services/audioEngine';
import {
  initRecoverySession,
  saveRecoveryChunk,
  finalizeRecoverySession,
  checkInterruptedSessions,
  recoverSessionBlob,
  deleteRecoverySession,
  markSessionInterrupted,
  downloadRecoveredVideo,
} from './services/storageRecovery';
import { computeSha256, generateRecordingFilename } from './services/cryptoHash';
import { ExtratoData } from './services/pdfGenerator';
import { AppSettings, loadSettings, loadSettingsAsync, pickStorageFolder, saveSettings } from './services/settingsService';
import { renderReportTemplate } from './services/reportTemplate';
import { getTauri, isTauriEnvironment, filePathToSrc } from './services/tauriEnvironment';
import { fixWebmDurationBlob, fixWebmDurationFile } from './services/webmDuration';

export default function App() {
  // 0. Institutional Settings (Promotor vs Juiz, Órgão Padrão)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);

  // 1. Metadata State
  const [metadata, setMetadata] = useState<OitivaMetadata>(() => {
    const s = loadSettings();
    const defaultAuthor = s.authorityName
      ? `${s.authorityTitle} - ${s.authorityName}`
      : s.authorityTitle;
    return {
      nomePessoa: '',
      qualificacao: 'Testemunha',
      documento: '',
      numeroProcesso: '',
      orgaoInstituicao: s.defaultOrgao || 'Ministério Público do Estado do Tocantins',
      autoridadeResponsavel: defaultAuthor || 'Promotor de Justiça',
      responsavelGravacao: s.defaultOfficer || '',
      observacoes: '',
    };
  });

  // 2. Hardware Devices State
  const [cameras, setCameras] = useState<DetectedDevice[]>([]);
  const [microphones, setMicrophones] = useState<DetectedDevice[]>([]);
  const [selectedCamera1Id, setSelectedCamera1Id] = useState<string | null>(null);
  const [selectedCamera2Id, setSelectedCamera2Id] = useState<string | null>(null);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string | null>(null);
  const [selectedMicrophone2Id, setSelectedMicrophone2Id] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split');
  const [isDetectingDevices, setIsDetectingDevices] = useState(false);
  const [autoFramingEnabled, setAutoFramingEnabled] = useState(false);

  // Selection refs to allow stable callbacks without dependency loops
  const selectedCamera1IdRef = useRef<string | null>(null);
  const selectedCamera2IdRef = useRef<string | null>(null);
  const selectedMicrophoneIdRef = useRef<string | null>(null);
  const selectedMicrophone2IdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedCamera1IdRef.current = selectedCamera1Id;
  }, [selectedCamera1Id]);

  useEffect(() => {
    selectedCamera2IdRef.current = selectedCamera2Id;
  }, [selectedCamera2Id]);

  useEffect(() => {
    selectedMicrophoneIdRef.current = selectedMicrophoneId;
  }, [selectedMicrophoneId]);

  useEffect(() => {
    selectedMicrophone2IdRef.current = selectedMicrophone2Id;
  }, [selectedMicrophone2Id]);

  // 3. Streams
  const [camera1Stream, setCamera1Stream] = useState<MediaStream | null>(null);
  const [camera2Stream, setCamera2Stream] = useState<MediaStream | null>(null);
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const [microphoneStream2, setMicrophoneStream2] = useState<MediaStream | null>(null);

  // 4. Audio Engine & Levels
  const audioEngineRef = useRef<AudioEngine>(new AudioEngine());
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioPeak, setAudioPeak] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [audioGain, setAudioGain] = useState(1.0);
  const [savedVideoPath, setSavedVideoPath] = useState<string | undefined>(undefined);

  // 5. Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [recordingBytes, setRecordingBytes] = useState(0);
  const [chunksCount, setChunksCount] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const currentSessionIdRef = useRef<string | null>(null);
  const recordingStartTimeRef = useRef<Date | null>(null);
  const activeAccumulatedMsRef = useRef<number>(0);
  const activeSegmentStartMsRef = useRef<number | null>(null);
  const hadPauseDuringSessionRef = useRef<boolean>(false);
  const frozenStopStateRef = useRef<{ endedAt: Date; durationSeconds: number } | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const fileWritableStreamRef = useRef<any>(null);
  const fileSavePathRef = useRef<string | null>(null);
  // Streaming para disco (Tauri): fila ordenada, primeiro chunk trunca, demais anexam
  const diskWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const diskStreamOkRef = useRef(false);
  const diskFirstChunkRef = useRef(true);
  const diskErrorShownRef = useRef(false);
  const finalVideoPathRef = useRef<string | null>(null);
  // true somente depois que o vídeo foi confirmado em disco (permite limpar o diário)
  const sessionSavedRef = useRef(false);
  // Última URL de prévia gerada, para revogar blob: ao trocar/fechar.
  const completedVideoSrcRef = useRef<string | null>(null);

  /**
   * Define a fonte da prévia do vídeo revogando a anterior quando era um blob:.
   * `asset:` aponta para o arquivo em disco e não precisa (nem pode) ser revogado.
   */
  const setVideoPreview = useCallback((src: string | null) => {
    const previous = completedVideoSrcRef.current;
    if (previous && previous !== src && previous.startsWith('blob:')) {
      URL.revokeObjectURL(previous);
    }
    completedVideoSrcRef.current = src;
    setCompletedVideoSrc(src);
  }, []);

  /**
   * Resets all recording-session state so the app is ready for the next oitiva
   * without requiring a full page reload.
   */
  const resetSessionState = useCallback(() => {
    setRecordingElapsedSeconds(0);
    setRecordingBytes(0);
    setChunksCount(0);
    setIsRecording(false);
    setIsPaused(false);
    setSavedVideoPath(undefined);
    setDiskWarning(null);

    // Vídeo confirmado em disco: o diário (IndexedDB + pasta nativa) já pode sair.
    if (currentSessionIdRef.current && sessionSavedRef.current) {
      deleteRecoverySession(currentSessionIdRef.current).catch(() => {});
    }
    sessionSavedRef.current = false;
    setVideoPreview(null);

    recordedChunksRef.current = [];
    currentSessionIdRef.current = null;
    recordingStartTimeRef.current = null;
    activeAccumulatedMsRef.current = 0;
    activeSegmentStartMsRef.current = null;
    hadPauseDuringSessionRef.current = false;
    frozenStopStateRef.current = null;
    fileWritableStreamRef.current = null;

    // Reset per-deponent metadata; institutional fields are kept
    setMetadata((prev) => ({
      ...prev,
      nomePessoa: '',
      qualificacao: 'Testemunha',
      documento: '',
      numeroProcesso: '',
      observacoes: '',
      advogados: [],
      retificadoEm: undefined,
    }));
  }, [setVideoPreview]);

  const startElapsedTicker = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    recordingTimerRef.current = window.setInterval(() => {
      const currentSegmentMs =
        activeSegmentStartMsRef.current !== null
          ? Math.max(0, Date.now() - activeSegmentStartMsRef.current)
          : 0;
      const totalMs = activeAccumulatedMsRef.current + currentSegmentMs;
      setRecordingElapsedSeconds(Math.floor(totalMs / 1000));
    }, 200);
  }, []);

  // 6. Crash Recovery & Modals
  const [recoverySessions, setRecoverySessions] = useState<any[]>([]);
  const [isRecovering, setIsRecovering] = useState(false);
  const [extratoData, setExtratoData] = useState<ExtratoData | null>(null);
  // URL do vídeo para a prévia: `asset:` (arquivo em disco, sem ocupar RAM)
  // ou `blob:` (somente quando o salvamento em disco falhou).
  const [completedVideoSrc, setCompletedVideoSrc] = useState<string | null>(null);
  const [diskWarning, setDiskWarning] = useState<string | null>(null);
  const [showLegalHelp, setShowLegalHelp] = useState(false);

  // --- Initial Hardware Scan & Interrupted Session Check ---
  const refreshDevices = useCallback(async () => {
    audioEngineRef.current.resume();
    setIsDetectingDevices(true);
    await requestMediaPermissions();
    const { cameras: detectedCameras, microphones: detectedMics } = await enumerateHardwareDevices();
    setCameras(detectedCameras);
    setMicrophones(detectedMics);

    // Auto-assignment Camera 1
    setSelectedCamera1Id((prev) => {
      if (prev && detectedCameras.some((c) => c.deviceId === prev)) {
        return prev;
      }
      return detectedCameras[0]?.deviceId || null;
    });

    // Auto-assignment Camera 2 (separate physical camera if available)
    setSelectedCamera2Id((prev) => {
      if (prev && detectedCameras.some((c) => c.deviceId === prev)) {
        return prev;
      }
      if (detectedCameras.length > 1) {
        const c1 = selectedCamera1IdRef.current || detectedCameras[0]?.deviceId;
        const other = detectedCameras.find((c) => c.deviceId !== c1);
        return other ? other.deviceId : detectedCameras[1].deviceId;
      }
      return null;
    });

    // Auto-assignment Microphone
    setSelectedMicrophoneId((prev) => {
      if (prev && detectedMics.some((m) => m.deviceId === prev)) {
        return prev;
      }
      return detectedMics[0]?.deviceId || null;
    });

    if (detectedCameras.length <= 1) {
      setLayoutMode('single-camera1');
    } else {
      setLayoutMode('split');
    }

    setIsDetectingDevices(false);
  }, []);

  useEffect(() => {
    refreshDevices();

    // Check for crash recovery
    checkInterruptedSessions().then((sessions) => {
      setRecoverySessions(sessions);
    });

    // Deep persistent settings check (Desktop Tauri file / IndexedDB)
    loadSettingsAsync().then((asyncSettings) => {
      if (asyncSettings) {
        setSettings(asyncSettings);
      }
    });

    // Device change listener (USB plug/unplug)
    const handleDeviceChange = () => {
      refreshDevices();
    };

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    return () => {
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
      audioEngineRef.current.close();
    };
  }, [refreshDevices]);

  // --- Active Recording Crash-Protection & Unload Interception ---
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRecording) {
        // Tenta forçar a descarga do último bloco gravado antes do encerramento
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          try {
            mediaRecorderRef.current.requestData();
          } catch {}
        }
        if (currentSessionIdRef.current) {
          markSessionInterrupted(
            currentSessionIdRef.current,
            'Fechamento ou recarregamento inesperado da janela'
          ).catch(() => {});
        }
        e.preventDefault();
        e.returnValue = 'Atenção: Uma gravação oficial está em andamento. Fechar ou atualizar o programa agora causará a interrupção da gravação.';
        return e.returnValue;
      }
    };

    const handlePageHide = () => {
      if (isRecording) {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          try {
            mediaRecorderRef.current.requestData();
          } catch {}
        }
        if (currentSessionIdRef.current) {
          markSessionInterrupted(
            currentSessionIdRef.current,
            'Processo encerrado abruptamente pelo sistema operacional ou usuário'
          ).catch(() => {});
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [isRecording]);

  // --- Camera 1 Stream Lifecycle ---
  useEffect(() => {
    let active = true;
    let streamToStop: MediaStream | null = null;

    if (selectedCamera1Id) {
      getCameraStream(selectedCamera1Id).then((stream) => {
        if (!active) {
          stream?.getTracks().forEach((t) => t.stop());
          return;
        }
        streamToStop = stream;
        setCamera1Stream(stream);
      });
    } else {
      setCamera1Stream(null);
    }

    return () => {
      active = false;
      if (streamToStop) {
        streamToStop.getTracks().forEach((t) => t.stop());
      }
    };
  }, [selectedCamera1Id]);

  // --- Camera 2 Stream Lifecycle ---
  useEffect(() => {
    let active = true;
    let streamToStop: MediaStream | null = null;

    if (selectedCamera2Id) {
      // Mesmo dispositivo físico da Câmera 1: reutiliza o mesmo stream.
      // Nunca solicita captura exclusiva duplicada para o mesmo hardware,
      // o que causava piscar/reinício das câmeras.
      if (selectedCamera2Id === selectedCamera1Id) {
        if (camera1Stream) {
          setCamera2Stream(camera1Stream);
        }
        return;
      }

      getCameraStream(selectedCamera2Id).then((stream) => {
        if (!active) {
          stream?.getTracks().forEach((t) => t.stop());
          return;
        }
        streamToStop = stream;
        setCamera2Stream(stream);
      });
    } else {
      setCamera2Stream(null);
    }

    return () => {
      active = false;
      if (streamToStop) {
        streamToStop.getTracks().forEach((t) => t.stop());
      }
    };
  }, [selectedCamera2Id, selectedCamera1Id]);

  // --- Dual-Microphone & Audio Engine Lifecycle ---
  useEffect(() => {
    // Avoid ghost stream acquisition before hardware devices have been enumerated
    if (microphones.length === 0 && !selectedMicrophoneId && !selectedMicrophone2Id) return;

    let active = true;
    let stream1ToStop: MediaStream | null = null;
    let stream2ToStop: MediaStream | null = null;

    const setupMics = async () => {
      const [s1, s2] = await Promise.all([
        selectedMicrophoneId ? getMicrophoneStream(selectedMicrophoneId) : Promise.resolve(null),
        selectedMicrophone2Id ? getMicrophoneStream(selectedMicrophone2Id) : Promise.resolve(null),
      ]);

      if (!active) {
        s1?.getTracks().forEach((t) => t.stop());
        s2?.getTracks().forEach((t) => t.stop());
        return;
      }

      stream1ToStop = s1;
      stream2ToStop = s2;
      setMicrophoneStream(s1);
      setMicrophoneStream2(s2);

      if (s1) {
        await audioEngineRef.current.init(s1, s2);
        audioEngineRef.current.onLevel((level, peak) => {
          setAudioLevel(level);
          setAudioPeak(peak);
        });
      }
    };

    setupMics().catch((err) => {
      console.error('AudioEngine setup error:', err);
    });

    return () => {
      active = false;
      if (stream1ToStop) stream1ToStop.getTracks().forEach((t) => t.stop());
      if (stream2ToStop) stream2ToStop.getTracks().forEach((t) => t.stop());
    };
  }, [selectedMicrophoneId, selectedMicrophone2Id, microphones.length]);

  // Save settings and optionally update current metadata if unedited
  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    setMetadata((prev) => {
      const isOrgaoDefault =
        !prev.orgaoInstituicao || prev.orgaoInstituicao === settings.defaultOrgao;
      const isAuthorDefault =
        !prev.autoridadeResponsavel ||
        prev.autoridadeResponsavel.includes(settings.authorityTitle);

      const newAuthor = newSettings.authorityName
        ? `${newSettings.authorityTitle} - ${newSettings.authorityName}`
        : newSettings.authorityTitle;

      return {
        ...prev,
        orgaoInstituicao: isOrgaoDefault ? newSettings.defaultOrgao : prev.orgaoInstituicao,
        autoridadeResponsavel: isAuthorDefault ? newAuthor : prev.autoridadeResponsavel,
        responsavelGravacao: prev.responsavelGravacao || newSettings.defaultOfficer,
      };
    });
  };

  // Audio mute & gain handlers (applies to both active microphones)
  const handleToggleMute = () => {
    audioEngineRef.current.resume();
    const newMuteState = !isMicMuted;
    if (microphoneStream) {
      microphoneStream.getAudioTracks().forEach((t) => {
        t.enabled = !newMuteState;
      });
    }
    if (microphoneStream2) {
      microphoneStream2.getAudioTracks().forEach((t) => {
        t.enabled = !newMuteState;
      });
    }
    setIsMicMuted(newMuteState);
  };

  const handleChangeGain = (gain: number) => {
    audioEngineRef.current.resume();
    setAudioGain(gain);
    audioEngineRef.current.setGain(gain);
  };

  // --- Start Recording ---
  const handleStartRecording = async () => {
    if (!metadata.nomePessoa.trim()) {
      // Leva o usuário direto ao campo em falta, com a dica visível ao lado,
      // em vez de abrir um alerta bloqueante do sistema.
      const nameField = document.getElementById('meta-nome-pessoa');
      if (nameField instanceof HTMLInputElement) {
        nameField.focus();
        nameField.scrollIntoView({ block: 'nearest' });
      }
      return;
    }

    if (!canvasStreamRef.current) {
      alert('O compositor de vídeo ainda está inicializando. Aguarde um instante.');
      return;
    }

    // Ensure audio engine context is active
    await audioEngineRef.current.resume();

    // 1. Prepare combined stream: Canvas video + mixed microphone audio
    const compositeStream = canvasStreamRef.current;
    const finalStream = new MediaStream();

    compositeStream.getVideoTracks().forEach((t) => finalStream.addTrack(t));

    const mixedAudioTrack = audioEngineRef.current.getMixedAudioTrack();
    const isAudioContextRunning = audioEngineRef.current.getContextState() === 'running';

    if (isAudioContextRunning && mixedAudioTrack && mixedAudioTrack.readyState === 'live') {
      finalStream.addTrack(mixedAudioTrack);
    } else if (microphoneStream && microphoneStream.getAudioTracks().length > 0) {
      const rawTrack = microphoneStream.getAudioTracks()[0];
      rawTrack.enabled = !isMicMuted;
      finalStream.addTrack(rawTrack);
    }

    // 2. Select codec with priority on VP9/VP8 in WebM container (append-only tolerant)
    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    const sessionId = `oitiva_${Date.now()}`;
    currentSessionIdRef.current = sessionId;
    recordedChunksRef.current = [];
    sessionSavedRef.current = false;
    setDiskWarning(null);
    setSavedVideoPath(undefined);
    setVideoPreview(null);

    // Define o caminho final ANTES de gravar: o vídeo vai para o disco durante a gravação
    diskWriteQueueRef.current = Promise.resolve();
    diskStreamOkRef.current = false;
    diskFirstChunkRef.current = true;
    diskErrorShownRef.current = false;
    finalVideoPathRef.current = null;
    fileSavePathRef.current = null;
    if (isTauriEnvironment()) {
      try {
        let dir = settings.storageDirectory?.trim();
        if (!dir) {
          const picked = await pickStorageFolder();
          if (picked) {
            dir = picked;
            const updated = { ...settings, storageDirectory: picked };
            setSettings(updated);
            saveSettings(updated).catch(() => {});
          }
        }
        if (dir) {
          const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\';
          // Calculado só depois do seletor de pasta: se o usuário demorar para
          // escolher, o nome do arquivo ainda bate com o horário real de início.
          const plannedStartedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
          const fname = generateRecordingFilename(
            metadata.nomePessoa,
            metadata.numeroProcesso,
            plannedStartedAt,
            'webm'
          );
          const path = `${dir.replace(/[\\/]+$/, '')}${sep}${fname}`;
          // Grava em <nome>.webm.part; ao parar com sucesso é renomeado para <nome>.webm
          fileSavePathRef.current = path + '.part';
          finalVideoPathRef.current = path;
          diskStreamOkRef.current = true;
        } else {
          alert('Nenhuma pasta de armazenamento definida: a gravação NÃO está sendo salva em disco durante a sessão.');
        }
      } catch (e) {
        console.warn('[Clio] Não foi possível preparar gravação direta em disco:', e);
      }
    }

    // Initialize Crash Recovery Journal in IndexedDB
    await initRecoverySession(sessionId, metadata, mimeType);

    try {
      const recorder = new MediaRecorder(finalStream, {
        mimeType,
        videoBitsPerSecond: 3000000, // 3.0 Mbps crystal clear Full HD
      });

      let chunkIndex = 0;
      recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        const data = e.data;
        const idx = chunkIndex++;
        recordedChunksRef.current.push(data);
        setRecordingBytes((prev) => prev + data.size);
        setChunksCount((prev) => prev + 1);

        // Enfileira SINCRONAMENTE: garante ordem dos chunks (journal + disco)
        diskWriteQueueRef.current = diskWriteQueueRef.current.then(async () => {
          try {
            await saveRecoveryChunk(sessionId, idx, data);
          } catch (jerr) {
            console.warn('[Clio] Falha no diário IndexedDB:', jerr);
          }

          const path = fileSavePathRef.current;
          if (!path || !diskStreamOkRef.current) return;
          try {
            const tauri = getTauri();
            const bytes = new Uint8Array(await data.arrayBuffer());
            const headers: Record<string, string> = { 'x-path': encodeURIComponent(path) };
            if (!diskFirstChunkRef.current) headers['x-append'] = '1';
            await tauri.core.invoke('clio_write_file_raw', bytes, { headers });
            diskFirstChunkRef.current = false;
          } catch (writeErr) {
            // Se o 1º chunk falhou, o arquivo não existe; se um posterior falhou, há lacuna.
            diskStreamOkRef.current = false;
            console.error('[Clio] Falha ao gravar chunk em disco:', writeErr);
            if (!diskErrorShownRef.current) {
              diskErrorShownRef.current = true;
              // Nunca usar alert() aqui: a thread principal bloqueada congela o
              // canvas (requestAnimationFrame) e o trecho gravado perde imagem.
              setDiskWarning(
                'Falha ao gravar o vídeo no disco (' +
                  String((writeErr as any)?.message ?? writeErr) +
                  '). A gravação continua sendo guardada no diário interno. Verifique espaço e permissão da pasta.'
              );
            }
          }
        });
      };

      recorder.onstop = async () => {
        // Aguarda todos os chunks pendentes irem para disco/diário
        await diskWriteQueueRef.current;
        if (isTauriEnvironment()) {
          fileSavePathRef.current = null;
        } else if (fileWritableStreamRef.current) {
          try {
            await fileWritableStreamRef.current.close();
          } catch {}
          fileWritableStreamRef.current = null;
        }

        const completeBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        const totalBytes = completeBlob.size;

        const startedAt = recordingStartTimeRef.current || new Date();
        const frozen = frozenStopStateRef.current;
        const durationSeconds = frozen
          ? frozen.durationSeconds
          : Math.max(1, Math.floor((Date.now() - startedAt.getTime()) / 1000));
        const endedAt = frozen
          ? frozen.endedAt
          : new Date(startedAt.getTime() + durationSeconds * 1000);
        const durationMs = Math.max(1, endedAt.getTime() - startedAt.getTime());
        frozenStopStateRef.current = null;

        // Se o vídeo foi gravado em disco durante a sessão, o nome do arquivo já está definido
        const filename = finalVideoPathRef.current
          ? finalVideoPathRef.current.split(/[\\/]/).pop()!
          : generateRecordingFilename(metadata.nomePessoa, metadata.numeroProcesso, startedAt, 'webm');

        // Salva/finaliza o vídeo na pasta de Armazenamento Local
        let diskHash: string | null = null; // hash calculado pelo Rust sobre o arquivo em disco
        let finalTotalBytes = totalBytes;
        // Blob já corrigido com o Duration (fallback em memória).
        let fixedBlob: Blob | null = null;
        let savedOnDisk = false;
        let savedPath: string | null = null;
        // true quando `savedPath` é o arquivo final legível (e não um .part)
        let previewFromDisk = false;

        try {
          let storageDir = settings.storageDirectory?.trim();
          if (!storageDir && isTauriEnvironment()) {
            // Se ainda não houver pasta configurada, solicita ao usuário onde deseja salvar
            const picked = await pickStorageFolder();
            if (picked) {
              storageDir = picked;
              const updated = { ...settings, storageDirectory: picked };
              setSettings(updated);
              saveSettings(updated).catch(() => {});
            }
          }

          if (isTauriEnvironment()) {
            const tauri = getTauri();
            const finalPath = finalVideoPathRef.current;
            let finalizedOnDisk = false;

            if (diskStreamOkRef.current && finalPath) {
              const partPath = finalPath + '.part';
              try {
                // Insere o Duration no cabeçalho antes de hashear/renomear:
                // sem ele o VLC exibe o vídeo sem duração e não permite avançar.
                const inserted = await fixWebmDurationFile(partPath, durationMs);
                // Hash em streaming no Rust + conferência de tamanho (disco == gravado)
                const info = await tauri.core.invoke('clio_sha256_file', { path: partPath });
                const expectedSize = totalBytes + (inserted ?? 0);
                if (info && info.size === expectedSize) {
                  let finalOnDisk = partPath;
                  try {
                    await tauri.core.invoke('clio_rename_file', { from: partPath, to: finalPath });
                    finalOnDisk = finalPath;
                  } catch (renErr) {
                    console.error('[Clio] Falha ao renomear .part:', renErr);
                    alert('O vídeo foi salvo, mas não foi possível renomear o arquivo .part para .webm: ' + partPath);
                  }
                  diskHash = info.sha256;
                  finalTotalBytes = info.size;
                  savedOnDisk = true;
                  savedPath = finalOnDisk;
                  previewFromDisk = finalOnDisk === finalPath;
                  finalizedOnDisk = true;
                } else {
                  console.error('[Clio] Tamanho em disco difere do gravado', info?.size, expectedSize);
                  alert('O arquivo em disco não confere com a gravação (tamanho divergente). Será regravado a partir da memória.');
                }
              } catch (hashErr) {
                console.error('[Clio] Falha ao verificar o arquivo em disco:', hashErr);
              }
            }

            if (!finalizedOnDisk && storageDir) {
              // Fallback: grava de uma vez em binário (sem JSON por byte).
              const sep = storageDir.includes('/') && !storageDir.includes('\\') ? '/' : '\\';
              const cleanDir = storageDir.replace(/[\\/]+$/, '');
              const targetPath = finalPath ?? `${cleanDir}${sep}${filename}`;
              fixedBlob = await fixWebmDurationBlob(completeBlob, durationMs);
              await tauri.core.invoke(
                'clio_write_file_raw',
                new Uint8Array(await fixedBlob.arrayBuffer()),
                { headers: { 'x-path': encodeURIComponent(targetPath) } }
              );
              // Remove o .part que ficou de uma tentativa de streaming interrompida.
              if (finalPath) {
                try {
                  await tauri.core.invoke('clio_delete_file', { path: finalPath + '.part' });
                } catch {}
              }
              finalTotalBytes = fixedBlob.size;
              savedOnDisk = true;
              savedPath = targetPath;
              previewFromDisk = true;
            }
          }
        } catch (saveErr) {
          console.error('[Clio] Erro ao salvar vídeo na pasta local:', saveErr);
          alert('FALHA ao salvar o vídeo na pasta local: ' + String((saveErr as any)?.message ?? saveErr) + '. Use a recuperação para exportar a gravação.');
        }

        if (savedOnDisk && savedPath) {
          setSavedVideoPath(savedPath);
          if (previewFromDisk) {
            sessionSavedRef.current = true;
            // Só agora a sessão é considerada concluída: se algo falhou acima,
            // ela continua "interrompida" e aparece na recuperação.
            await finalizeRecoverySession(sessionId);
            // Arquivo confirmado em disco: a cópia do diário não é mais necessária.
            deleteRecoverySession(sessionId).catch(() => {});
            // Prévia direto do arquivo (protocolo asset), sem manter o vídeo na RAM.
            setVideoPreview(filePathToSrc(savedPath));
          } else {
            // O arquivo foi gravado, mas o rename `.part` -> `.webm` falhou.
            // Mantém o diário (a prévia vem do Blob) para permitir a exportação.
            await markSessionInterrupted(
              sessionId,
              'Arquivo .part não pôde ser renomeado para .webm'
            ).catch(() => {});
            checkInterruptedSessions().then(setRecoverySessions).catch(() => {});
            fixedBlob = fixedBlob ?? (await fixWebmDurationBlob(completeBlob, durationMs));
            setVideoPreview(URL.createObjectURL(fixedBlob));
          }
        } else {
          await markSessionInterrupted(
            sessionId,
            'Falha ao gravar o arquivo final em disco'
          ).catch(() => {});
          checkInterruptedSessions().then(setRecoverySessions).catch(() => {});
          // Sem arquivo final, o diário é a única cópia: prévia a partir do Blob.
          fixedBlob = fixedBlob ?? (await fixWebmDurationBlob(completeBlob, durationMs));
          setVideoPreview(URL.createObjectURL(fixedBlob));
        }

        // Libera os chunks da RAM: o Blob da prévia (quando houver) mantém os dados.
        recordedChunksRef.current = [];

        // SHA-256: do arquivo em disco quando disponível; senão, do blob em memória
        const hashBlob = diskHash ? null : fixedBlob ?? (await fixWebmDurationBlob(completeBlob, durationMs));
        const sha256 = diskHash ?? (await computeSha256(hashBlob ?? completeBlob));

        const textoRelatorio = settings.reportTemplate
          ? renderReportTemplate(settings.reportTemplate, {
              metadata,
              settings,
              startedAt,
              endedAt,
              durationSeconds,
              filename,
              sha256,
            })
          : '';

        const data: ExtratoData = {
          metadata,
          filename,
          durationSeconds,
          totalBytes: finalTotalBytes,
          sha256,
          startedAt,
          endedAt,
          resolution: '1920x1080 (Full HD)',
          fps: 30,
          container: 'WebM / Matroska VP9 (Contínuo Tolerante a Falhas)',
          textoRelatorio,
        };

        setExtratoData(data);
      };

      // Monitor hardware / device disconnection during active recording
      finalStream.getTracks().forEach((track) => {
        track.onended = () => {
          console.warn(`[Segurança Clio] Dispositivo desconectado durante a gravação: ${track.kind} (${track.label})`);
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            const reason = `Desconexão física de hardware: o dispositivo de ${
              track.kind === 'video' ? 'câmera' : 'áudio'
            } foi desconectado durante a sessão.`;
            if (currentSessionIdRef.current) {
              markSessionInterrupted(currentSessionIdRef.current, reason).catch(() => {});
            }
            try {
              mediaRecorderRef.current.requestData();
            } catch {}
            mediaRecorderRef.current.stop();
          }
        };
      });

      // Monitor MediaRecorder engine errors
      recorder.onerror = (recErr: any) => {
        console.error('[Segurança Clio] Erro no gravador MediaRecorder:', recErr);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          const reason = 'Falha no codificador de vídeo do sistema operacional/navegador durante a gravação.';
          if (currentSessionIdRef.current) {
            markSessionInterrupted(currentSessionIdRef.current, reason).catch(() => {});
          }
          try {
            mediaRecorderRef.current.requestData();
          } catch {}
          mediaRecorderRef.current.stop();
          alert('O gravador detectou uma interrupção técnica no sistema. Todo o vídeo gravado até este instante foi protegido e salvo com segurança.');
        }
      };
      // timeslice = 1000ms (1 segundo exato: grava no diário a cada segundo para tolerância máxima a falhas)
      recorder.start(1000);
      const startNow = Date.now();
      recordingStartTimeRef.current = new Date(Math.floor(startNow / 1000) * 1000);
      activeAccumulatedMsRef.current = 0;
      activeSegmentStartMsRef.current = startNow;
      hadPauseDuringSessionRef.current = false;
      frozenStopStateRef.current = null;

      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setIsPaused(false);
      setRecordingElapsedSeconds(0);
      setRecordingBytes(0);
      setChunksCount(0);

      // Start accurate wall-clock elapsed ticker
      startElapsedTicker();
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      alert('Erro ao iniciar gravador. Verifique as permissões de vídeo e áudio.');
    }
  };

  // --- Pause / Resume Recording ---
  const handleTogglePause = () => {
    if (!mediaRecorderRef.current) return;

    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      activeSegmentStartMsRef.current = Date.now();
      startElapsedTicker();
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      hadPauseDuringSessionRef.current = true;
      if (activeSegmentStartMsRef.current !== null) {
        activeAccumulatedMsRef.current += Math.max(0, Date.now() - activeSegmentStartMsRef.current);
        activeSegmentStartMsRef.current = null;
      }
      setRecordingElapsedSeconds(Math.floor(activeAccumulatedMsRef.current / 1000));
    }
  };

  // --- Stop Recording ---
  const handleStopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const stopNow = Date.now();
    let totalActiveMs = activeAccumulatedMsRef.current;
    if (!isPaused && activeSegmentStartMsRef.current !== null) {
      totalActiveMs += Math.max(0, stopNow - activeSegmentStartMsRef.current);
    }
    activeAccumulatedMsRef.current = totalActiveMs;
    activeSegmentStartMsRef.current = null;

    const exactSeconds = Math.max(1, Math.floor(totalActiveMs / 1000));
    setRecordingElapsedSeconds(exactSeconds);

    const startedAt = recordingStartTimeRef.current || new Date(Math.floor(stopNow / 1000) * 1000);
    const endedAt = hadPauseDuringSessionRef.current
      ? new Date(Math.floor(stopNow / 1000) * 1000)
      : new Date(startedAt.getTime() + exactSeconds * 1000);

    frozenStopStateRef.current = {
      endedAt,
      durationSeconds: exactSeconds,
    };

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
  };

  // --- Crash Recovery Actions ---
  const handleRecoverSession = async (sessionId: string) => {
    setIsRecovering(true);
    const recovered = await recoverSessionBlob(sessionId);
    if (!recovered) {
      alert('Não foi possível resgatar os blocos desta gravação.');
      setIsRecovering(false);
      return;
    }

    const {
      blob,
      metadata: recMeta,
      startedAt,
      endedAt,
      durationSeconds,
      interruptionReason,
    } = recovered;
    const durationMs = Math.max(
      1,
      durationSeconds * 1000,
      endedAt.getTime() - startedAt.getTime()
    );
    // Insere o Duration também na prévia/recuperação para permitir avançar.
    const fixedBlob = await fixWebmDurationBlob(blob, durationMs);
    const sha256 = await computeSha256(fixedBlob);

    const sessionMeta = recMeta || metadata;

    const filename = generateRecordingFilename(
      sessionMeta.nomePessoa || 'Recuperada',
      sessionMeta.numeroProcesso || '000',
      startedAt,
      'webm'
    );

    const textoRelatorio = settings.reportTemplate
      ? renderReportTemplate(settings.reportTemplate, {
          metadata: sessionMeta,
          settings,
          startedAt,
          endedAt,
          durationSeconds,
          filename,
          sha256,
        })
      : '';

    const data: ExtratoData = {
      metadata: sessionMeta,
      filename,
      durationSeconds,
      totalBytes: fixedBlob.size,
      sha256,
      startedAt,
      endedAt,
      resolution: '1920x1080 (Recuperado)',
      fps: 30,
      container: `WebM / Matroska (Restaurado do Diário de Falhas${
        interruptionReason ? ` · ${interruptionReason}` : ''
      })`,
      textoRelatorio,
    };

    setVideoPreview(URL.createObjectURL(fixedBlob));
    setExtratoData(data);
    setIsRecovering(false);
    setRecoverySessions((prev) => prev.filter((s) => s.session.id !== sessionId));
  };

  const handleDirectDownloadRecovered = async (sessionId: string) => {
    try {
      const recovered = await recoverSessionBlob(sessionId);
      if (!recovered) {
        alert('Não foi possível carregar os blocos desta gravação.');
        return;
      }
      const filename = generateRecordingFilename(
        recovered.metadata?.nomePessoa || 'Gravacao_Recuperada',
        recovered.metadata?.numeroProcesso || '000',
        recovered.startedAt,
        'webm'
      );
      const durationMs = Math.max(
        1,
        recovered.durationSeconds * 1000,
        recovered.endedAt.getTime() - recovered.startedAt.getTime()
      );

      // Tenta salvar via diálogo nativo (Tauri ou showSaveFilePicker)
      let saved = false;
      if (isTauriEnvironment()) {
        try {
          const tauri = getTauri();
          let savePath: string | null = null;
          if (tauri?.core?.invoke) {
            savePath = await tauri.core.invoke('plugin:dialog|save', {
              options: {
                defaultPath: filename,
                filters: [{ name: 'Arquivo de Vídeo WebM', extensions: ['webm'] }],
              },
            }).catch(() => null);
          }
          if (savePath) {
            const uint8 = new Uint8Array(await recovered.blob.arrayBuffer());
            await tauri.core.invoke('clio_write_file_raw', uint8, {
              headers: { 'x-path': encodeURIComponent(savePath) },
            });
            // Garante duração no arquivo recuperado (permite avançar no VLC).
            await fixWebmDurationFile(savePath, durationMs);
            saved = true;
          } else if (savePath === null) {
            // Usuário cancelou o diálogo
            return;
          }
        } catch (tauriErr) {
          console.warn('[Clio] Tauri save dialog falhou, usando fallback:', tauriErr);
        }
      }

      const fixedBlob = saved ? recovered.blob : await fixWebmDurationBlob(recovered.blob, durationMs);

      if (!saved && typeof (window as any).showSaveFilePicker === 'function') {
        try {
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'Arquivo de Vídeo WebM', accept: { 'video/webm': ['.webm'] } }],
          });
          const writable = await fileHandle.createWritable();
          await writable.write(fixedBlob);
          await writable.close();
          saved = true;
        } catch (err: any) {
          if (err?.name === 'AbortError') return; // Usuário cancelou
        }
      }

      if (!saved) {
        // Último recurso: download direto sem escolha de pasta
        downloadRecoveredVideo(fixedBlob, filename);
      }
    } catch (err) {
      console.error('Erro ao salvar vídeo recuperado:', err);
      alert('Erro ao exportar o vídeo recuperado.');
    }
  };

  const handleDismissRecovery = async (sessionId: string) => {
    await deleteRecoverySession(sessionId);
    setRecoverySessions((prev) => prev.filter((s) => s.session.id !== sessionId));
  };

  const selectedMicObj = microphones.find((m) => m.deviceId === selectedMicrophoneId);

  const sceneLabel = {
    split: 'Lado a lado',
    'pip-camera1': 'PiP · depoente',
    'pip-camera2': 'PiP · mesa',
    'single-camera1': 'Câmera 1',
    'single-camera2': 'Câmera 2',
  }[layoutMode];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 font-sans text-zinc-100">
      {/* Top Header */}
      <Header
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowLegalHelp(true)}
        settings={settings}
      />

      {/* Main Workspace */}
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-6 py-5 xl:h-[calc(100vh-3.5rem)] xl:flex-none xl:overflow-hidden">
        {/* Falha ao gravar em disco — banner não bloqueante (alert() congelaria
            o canvas via requestAnimationFrame e o vídeo perderia imagens). */}
        {diskWarning && (
          <div
            role="alert"
            className="flex shrink-0 flex-col justify-between gap-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3 sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <div>
                <p className="text-[13px] font-medium text-zinc-100">
                  A gravação não está sendo salva no disco
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">{diskWarning}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDiskWarning(null)}
              className="flex h-8 shrink-0 items-center self-start rounded-lg border border-white/[0.08] px-3 text-xs text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100 sm:self-auto"
            >
              Ocultar
            </button>
          </div>
        )}

        {/* Crash Recovery Notification (if an interrupted recording is detected) */}
        <CrashRecoveryBanner
          recoverySessions={recoverySessions}
          onRecover={handleRecoverSession}
          onDirectDownload={handleDirectDownloadRecovered}
          onDismiss={handleDismissRecovery}
          isRecovering={isRecovering}
        />

        {/* Camera in-use / locked by another program (e.g. OBS Studio) */}
        {cameras.length > 0 && !camera1Stream && !isDetectingDevices && (
          <div className="flex shrink-0 flex-col justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div>
                <p className="text-[13px] font-medium text-zinc-100">Câmera em uso por outro programa</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Se o OBS Studio ou o Teams estiver aberto, feche-o para que o sistema conceda acesso exclusivo da câmera ao Clio.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={refreshDevices}
              className="flex h-8 shrink-0 items-center self-start rounded-lg border border-white/[0.08] px-3 text-xs text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100 sm:self-auto"
            >
              Reconectar câmera
            </button>
          </div>
        )}

        {/* Top Split Layout: Left is Video Canvas Viewport, Right is Controls & Metadata */}
        <div className="grid flex-1 grid-cols-1 items-stretch gap-4 xl:min-h-0 xl:grid-cols-12">
          {/* Main Video Viewport (Col 1-8) */}
          <div className="flex min-h-[480px] flex-col xl:col-span-8 xl:min-h-0">
            <section className="flex flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-900">
              {/* Estado da sessão e leitura da cena */}
              <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isRecording
                        ? isPaused
                          ? 'bg-amber-400'
                          : 'animate-pulse bg-seal-500'
                        : 'bg-zinc-600'
                    }`}
                  />
                  <span
                    aria-live="polite"
                    className={`truncate text-[13px] font-medium ${
                      isRecording
                        ? isPaused
                          ? 'text-amber-200'
                          : 'text-seal-200'
                        : 'text-zinc-300'
                    }`}
                  >
                    {isRecording
                      ? isPaused
                        ? 'Gravação pausada'
                        : 'Gravando'
                      : 'Pronto para gravar'}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-400">
                  <span className="hidden sm:inline">{sceneLabel}</span>
                  <span className="hidden text-zinc-600 sm:inline">·</span>
                  <span className="font-mono tabular-nums">1920×1080 · 30 fps</span>
                </div>
              </div>

              <div className="relative flex-1 overflow-hidden bg-black">
                <VideoCanvasCompositor
                  camera1Stream={camera1Stream}
                  camera2Stream={camera2Stream}
                  layoutMode={layoutMode}
                  metadata={metadata}
                  autoFramingEnabled={autoFramingEnabled}
                  customLogo={settings.customLogo}
                  onCanvasStreamReady={(stream) => {
                    canvasStreamRef.current = stream;
                  }}
                />
              </div>

              {/* Áudio e enquadramento */}
              <div className="flex h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4">
                <AudioVisualizer
                  currentLevel={audioLevel}
                  peakLevel={audioPeak}
                  isMuted={isMicMuted}
                  gain={audioGain}
                  onToggleMute={handleToggleMute}
                  onChangeGain={handleChangeGain}
                  micLabel={selectedMicObj?.label}
                />

                <button
                  type="button"
                  role="switch"
                  aria-checked={autoFramingEnabled}
                  onClick={() => setAutoFramingEnabled((prev) => !prev)}
                  className="flex h-8 items-center gap-2 rounded-lg px-2 text-xs text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
                  title="Enquadramento automático: a câmera segue o rosto do depoente"
                >
                  <Focus className="h-4 w-4" />
                  <span>Foco automático</span>
                  <span
                    className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                      autoFramingEnabled ? 'bg-zinc-300' : 'bg-zinc-800'
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full transition-transform ${
                        autoFramingEnabled
                          ? 'translate-x-[14px] bg-zinc-900'
                          : 'translate-x-0 bg-zinc-400'
                      }`}
                    />
                  </span>
                </button>
              </div>
            </section>
          </div>

          {/* Configuration & Form Sidebar (Col 9-12) */}
          <div className="flex flex-col gap-4 xl:col-span-4 xl:min-h-0 xl:overflow-y-auto xl:pr-1 xl:pb-1">
            {/* Metadata / Qualification Form */}
            <MetadataForm
              metadata={metadata}
              onChange={(updated) => setMetadata((prev) => ({ ...prev, ...updated }))}
              isRecording={isRecording}
            />

            {/* Automated Hardware Selector */}
            <DeviceSelector
              cameras={cameras}
              microphones={microphones}
              selectedCamera1Id={selectedCamera1Id}
              selectedCamera2Id={selectedCamera2Id}
              selectedMicrophoneId={selectedMicrophoneId}
              selectedMicrophone2Id={selectedMicrophone2Id}
              layoutMode={layoutMode}
              onSelectCamera1={(id) => {
                audioEngineRef.current.resume();
                setSelectedCamera1Id(id);
              }}
              onSelectCamera2={(id) => {
                audioEngineRef.current.resume();
                setSelectedCamera2Id(id);
              }}
              onSelectMicrophone={(id) => {
                audioEngineRef.current.resume();
                setSelectedMicrophoneId(id);
              }}
              onSelectMicrophone2={(id) => {
                audioEngineRef.current.resume();
                setSelectedMicrophone2Id(id);
              }}
              onChangeLayout={(mode) => {
                audioEngineRef.current.resume();
                setLayoutMode(mode);
              }}
              onRefreshDevices={() => {
                audioEngineRef.current.resume();
                refreshDevices();
              }}
              isDetecting={isDetectingDevices}
            />
          </div>
        </div>

        {/* Bottom Recording Control Strip */}
        <RecordingControls
          isRecording={isRecording}
          isPaused={isPaused}
          elapsedSeconds={recordingElapsedSeconds}
          totalBytes={recordingBytes}
          chunksCount={chunksCount}
          hasName={metadata.nomePessoa.trim().length > 0}
          storageDirectory={settings.storageDirectory}
          onSelectStorageDirectory={async () => {
            const folder = await pickStorageFolder(settings.storageDirectory);
            if (folder) {
              const updated = { ...settings, storageDirectory: folder };
              setSettings(updated);
              saveSettings(updated).catch(() => {});
            }
          }}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onTogglePause={handleTogglePause}
        />
      </main>

      {/* Extrato & PDF Modal */}
      {extratoData && completedVideoSrc && (
        <ExtratoModal
          data={extratoData}
          videoSrc={completedVideoSrc}
          settings={settings}
          savedVideoPath={savedVideoPath}
          onClose={() => {
            setExtratoData(null);
            // Reseta o estado da sessão para a próxima oitiva
            // (também revoga a URL de prévia e limpa o diário já salvo)
            resetSessionState();
          }}
          onSaveMetadata={(updated) => {
            setMetadata((prev) => ({ ...prev, ...updated }));
          }}
        />
      )}

      {/* Institutional Settings Modal */}
      {showSettings && (
        <SettingsModal
          currentSettings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Legal & Chain of Custody Help Modal */}
      {showLegalHelp && <LegalHelpModal onClose={() => setShowLegalHelp(false)} />}
    </div>
  );
}