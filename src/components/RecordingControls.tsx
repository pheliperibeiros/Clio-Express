import React from 'react';
import { Play, Square, Pause, FolderOpen } from 'lucide-react';

interface RecordingControlsProps {
  isRecording: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  totalBytes: number;
  chunksCount: number;
  hasName: boolean;
  storageDirectory?: string;
  onSelectStorageDirectory: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTogglePause: () => void;
}

const secondaryButton =
  'flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/[0.08] px-3 text-[13px] text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100 disabled:opacity-50';

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  isPaused,
  elapsedSeconds,
  totalBytes,
  chunksCount,
  hasName,
  storageDirectory,
  onSelectStorageDirectory,
  onStartRecording,
  onStopRecording,
  onTogglePause,
}) => {
  const h = Math.floor(elapsedSeconds / 3600);
  const m = Math.floor((elapsedSeconds % 3600) / 60);
  const s = Math.floor(elapsedSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  const timerStr = `${pad(h)}:${pad(m)}:${pad(s)}`;

  const formatMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

  const folderShortName = React.useMemo(() => {
    if (!storageDirectory) return 'Armazenamento local';
    const clean = storageDirectory.replace(/[\\/]+$/, '');
    const parts = clean.split(/[\\/]/);
    return parts[parts.length - 1] || 'Armazenamento local';
  }, [storageDirectory]);

  const stateLabel = isRecording ? (isPaused ? 'Pausada' : 'Gravando') : 'Aguardando';
  const stateColor = isRecording
    ? isPaused
      ? 'text-amber-200'
      : 'text-seal-200'
    : 'text-zinc-400';

  const primaryButton = hasName
    ? 'bg-seal-600 text-white hover:bg-seal-500'
    : 'border border-white/[0.08] bg-zinc-800 text-zinc-300 hover:bg-zinc-700';

  return (
    <section
      aria-label="Controles de gravação"
      className="flex shrink-0 flex-col items-start justify-between gap-4 rounded-xl border border-white/[0.07] bg-zinc-900 px-4 py-3 md:flex-row md:items-center"
    >
      {/* Estado e cronômetro */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span aria-live="polite" className={`text-xs ${stateColor}`}>
          {stateLabel}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[22px] font-medium leading-tight tabular-nums tracking-tight text-zinc-100">
            {timerStr}
          </span>
          {isRecording && (
            <span className="font-mono text-xs tabular-nums text-zinc-400">
              {formatMB(totalBytes)} MB · {chunksCount} {chunksCount === 1 ? 'bloco' : 'blocos'}
            </span>
          )}
          <span className="hidden text-xs text-zinc-400 sm:inline">
            {isRecording ? ' · ' : ''}WebM contínuo
          </span>
        </div>
      </div>

      {/* Ações */}
      <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
        <button
          type="button"
          onClick={onSelectStorageDirectory}
          disabled={isRecording}
          className={`${secondaryButton} max-w-[200px]`}
          title={
            storageDirectory
              ? `Vídeos salvos em: ${storageDirectory} (clique para alterar)`
              : 'Selecionar a pasta onde os vídeos serão salvos automaticamente'
          }
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />
          <span className="truncate">{folderShortName}</span>
        </button>

        {isRecording ? (
          <>
            <button
              type="button"
              onClick={onTogglePause}
              aria-pressed={isPaused}
              className={`${secondaryButton} w-[104px]`}
            >
              <Pause className="h-4 w-4 shrink-0" />
              <span>{isPaused ? 'Retomar' : 'Pausar'}</span>
            </button>

            <button
              type="button"
              onClick={onStopRecording}
              title="Finalizar gravação, salvar o vídeo e gerar o extrato"
              className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-seal-600 px-4 text-[13px] font-medium text-white transition-colors hover:bg-seal-500"
            >
              <Square className="h-3.5 w-3.5 shrink-0 fill-current" />
              <span>Finalizar e gerar extrato</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStartRecording}
            title={
              hasName
                ? 'Iniciar a gravação da oitiva'
                : 'Informe o nome da pessoa ouvida para iniciar a gravação'
            }
            aria-describedby={hasName ? undefined : 'meta-nome-pessoa-hint'}
            className={`flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-colors ${primaryButton}`}
          >
            <Play className="h-3.5 w-3.5 shrink-0 fill-current" />
            <span>Iniciar gravação</span>
          </button>
        )}
      </div>
    </section>
  );
};
