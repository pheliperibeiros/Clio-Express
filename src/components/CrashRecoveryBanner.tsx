import React, { useEffect, useState } from 'react';
import { Trash2, AlertCircle, FileVideo, FileText } from 'lucide-react';
import { formatBytes } from '../services/pdfGenerator';
import { OitivaMetadata } from '../types/oitiva';

interface InterruptedSessionInfo {
  session: {
    id: string;
    metadata: OitivaMetadata;
    startedAt: string;
    lastChunkAt?: string;
    mimeType: string;
    interruptionReason?: string;
  };
  chunkCount: number;
  totalSize: number;
}

interface CrashRecoveryBannerProps {
  recoverySessions: InterruptedSessionInfo[];
  onRecover: (sessionId: string) => void;
  onDirectDownload?: (sessionId: string) => void;
  onDismiss: (sessionId: string) => void;
  isRecovering: boolean;
}

const secondaryButton =
  'flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-xs text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100 disabled:opacity-50';

export const CrashRecoveryBanner: React.FC<CrashRecoveryBannerProps> = ({
  recoverySessions,
  onRecover,
  onDirectDownload,
  onDismiss,
  isRecovering,
}) => {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const firstSessionId = recoverySessions[0]?.session.id;

  // Um novo conjunto de sessões sempre começa sem confirmação pendente.
  useEffect(() => {
    setConfirmDiscard(false);
  }, [firstSessionId]);

  if (recoverySessions.length === 0) return null;

  const firstSession = recoverySessions[0];
  const dateStr = new Date(firstSession.session.startedAt).toLocaleString('pt-BR');
  const nome = firstSession.session.metadata?.nomePessoa || 'Depoente não identificado';
  const proc = firstSession.session.metadata?.numeroProcesso
    ? ` · Autos ${firstSession.session.metadata.numeroProcesso}`
    : '';
  const reason =
    firstSession.session.interruptionReason ||
    'Interrupção ou fechamento inesperado do aplicativo';

  return (
    <div
      role="region"
      aria-label="Gravação anterior interrompida"
      className="flex shrink-0 flex-col justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 lg:flex-row lg:items-center"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="min-w-0" role="status">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-medium text-zinc-100">
              Gravação interrompida preservada
            </span>
            <span className="text-xs text-zinc-500">·</span>
            <span className="font-mono text-xs text-zinc-400">{dateStr}</span>
            {recoverySessions.length > 1 && (
              <span className="text-xs text-amber-200">
                +{recoverySessions.length - 1} pendente(s)
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">
            Sessão de <strong className="font-medium text-zinc-100">{nome}</strong>{proc} preservada no
            diário de segurança com{' '}
            <strong className="font-medium text-zinc-100">{formatBytes(firstSession.totalSize)}</strong>{' '}
            em {firstSession.chunkCount} blocos.
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Motivo registrado: <span className="text-zinc-300">{reason}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {confirmDiscard ? (
          <>
            <button
              type="button"
              onClick={() => onDismiss(firstSession.session.id)}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-seal-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-seal-500"
              title="Excluir definitivamente esta gravação interrompida"
            >
              <Trash2 className="h-4 w-4" />
              <span>Confirmar descarte</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className={secondaryButton}
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDiscard(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
            title="Descartar gravação interrompida (pede confirmação)"
          >
            <Trash2 className="h-4 w-4" />
            <span>Descartar</span>
          </button>
        )}

        {onDirectDownload && (
          <button
            type="button"
            onClick={() => onDirectDownload(firstSession.session.id)}
            disabled={isRecovering}
            className={secondaryButton}
            title="Baixar o arquivo de vídeo (.webm) diretamente no computador"
          >
            <FileVideo className="h-4 w-4 text-zinc-400" />
            <span>Salvar vídeo</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onRecover(firstSession.session.id)}
          disabled={isRecovering}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-white disabled:opacity-50"
          title="Abrir o extrato com o vídeo, o termo e o hash"
        >
          <FileText className="h-4 w-4" />
          <span>{isRecovering ? 'Restaurando…' : 'Resgatar no extrato'}</span>
        </button>
      </div>
    </div>
  );
};
