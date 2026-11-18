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
import { AppSettings, loadSettings, loadSettingsAsync, pickStorageFolder, writeNativeFile, saveSettings } from './services/settingsService';
import { renderReportTemplate } from './services/reportTemplate';
import { getTauri, isTauriEnvironment } from './services/tauriEnvironment';

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
  }, []);

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
  const [completedVideoBlob, setCompletedVideoBlob] = useState<Blob | null>(null);
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

    // Initialize Crash Recovery Journal in IndexedDB
    await initRecoverySession(sessionId, metadata, mimeType);

    try {
      const recorder = new MediaRecorder(finalStream, {
        mimeType,
        videoBitsPerSecond: 3000000, // 3.0 Mbps crystal clear Full HD
      });

      let chunkIndex = 0;
      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
          setRecordingBytes((prev) => prev + e.data.size);
          setChunksCount((prev) => prev + 1);

          // Flush to IndexedDB crash journal
          await saveRecoveryChunk(sessionId, chunkIndex++, e.data);

          // Pipe to direct disk if enabled
          if (isTauriEnvironment()) {
            if (fileSavePathRef.current) {
              try {
                const tauri = getTauri();
                if (tauri?.core?.invoke) {
                  const bytes = new Uint8Array(await e.data.arrayBuffer());
                  await tauri.core.invoke('clio_write_file_raw', bytes, {
                    headers: {
                      'x-path': fileSavePathRef.current!,
                      'x-append': '1',
                    },
                  });
                }
              } catch (writeErr) {
                console.warn('Error writing direct disk chunk (Tauri):', writeErr);
              }
            }
          } else if (fileWritableStreamRef.current) {
            try {
              await fileWritableStreamRef.current.write(e.data);
            } catch (writeErr) {
              console.warn('Error writing direct disk chunk:', writeErr);
            }
          }
        }
      };

      recorder.onstop = async () => {
        // Finalize
        if (isTauriEnvironment()) {
          fileSavePathRef.current = null;
        } else if (fileWritableStreamRef.current) {
          try {
            await fileWritableStreamRef.current.close();
          } catch {}
          fileWritableStreamRef.current = null;
        }

        const completeBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        setCompletedVideoBlob(completeBlob);

        // Mark session as complete in IndexedDB
        await finalizeRecoverySession(sessionId);

        // Compute SHA-256 Hash of entire recording
        const sha256 = await computeSha256(completeBlob);

        const startedAt = recordingStartTimeRef.current || new Date();
        const frozen = frozenStopStateRef.current;
        const durationSeconds = frozen
          ? frozen.durationSeconds
          : Math.max(1, Math.floor((Date.now() - startedAt.getTime()) / 1000));
        const endedAt = frozen
          ? frozen.endedAt
          : new Date(startedAt.getTime() + durationSeconds * 1000);
        frozenStopStateRef.current = null;

        const filename = generateRecordingFilename(
          metadata.nomePessoa,
          metadata.numeroProcesso,
          startedAt,
          'webm'
        );

        // Salva automaticamente o vídeo na pasta de Armazenamento Local
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

          if (storageDir && isTauriEnvironment()) {
            const sep = storageDir.includes('/') && !storageDir.includes('\\') ? '/' : '\\';
            const cleanDir = storageDir.replace(/[\\/]+$/, '');
            const targetPath = `${cleanDir}${sep}${filename}`;
            const ok = await writeNativeFile(targetPath, completeBlob);
            if (ok) {
              setSavedVideoPath(targetPath);
            }
          }
        } catch (saveErr) {
          console.warn('[Clio] Erro ao salvar vídeo automaticamente na pasta local:', saveErr);
        }
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
          totalBytes: completeBlob.size,
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
      totalBytes,
      interruptionReason,
    } = recovered;
    const sha256 = await computeSha256(blob);

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
      totalBytes,
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

    setCompletedVideoBlob(blob);
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
            const buffer = await recovered.blob.arrayBuffer();
            const uint8 = new Uint8Array(buffer);
            await tauri.core.invoke('plugin:fs|write_file', {
              path: savePath,
              data: Array.from(uint8),
            });
            saved = true;
          } else if (savePath === null) {
            // Usuário cancelou o diálogo
            return;
          }
        } catch (tauriErr) {
          console.warn('[Clio] Tauri save dialog falhou, usando fallback:', tauriErr);
        }
      }

      if (!saved && typeof (window as any).showSaveFilePicker === 'function') {
        try {
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'Arquivo de Vídeo WebM', accept: { 'video/webm': ['.webm'] } }],
          });
          const writable = await fileHandle.createWritable();
          await writable.write(recovered.blob);
          await writable.close();
          saved = true;
        } catch (err: any) {
          if (err?.name === 'AbortError') return; // Usuário cancelou
        }
      }

      if (!saved) {
        // Último recurso: download direto sem escolha de pasta
        downloadRecoveredVideo(recovered.blob, filename);
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
      {extratoData && completedVideoBlob && (
        <ExtratoModal
          data={extratoData}
          videoBlob={completedVideoBlob}
          settings={settings}
          savedVideoPath={savedVideoPath}
          onClose={() => {
            setExtratoData(null);
            setCompletedVideoBlob(null);
            // Reseta o estado da sessão para a próxima oitiva
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
