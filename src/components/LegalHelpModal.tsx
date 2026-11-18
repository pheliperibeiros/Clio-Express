import React from 'react';
import { X, Check } from 'lucide-react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { SealMark } from './SealMark';

interface LegalHelpModalProps {
  onClose: () => void;
}

export const LegalHelpModal: React.FC<LegalHelpModalProps> = ({ onClose }) => {
  const dialogRef = useDialogA11y(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        tabIndex={-1}
        className="my-auto flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900 shadow-2xl shadow-black/50 focus:outline-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] bg-zinc-950 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <SealMark className="text-brass-500" size={18} />
            <div className="min-w-0">
              <h2 id="help-modal-title" className="text-base font-semibold text-zinc-100">
                Informações do sistema
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Integridade probatória e diretrizes de gravação
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar informações do sistema"
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-6 text-[13px] leading-relaxed text-zinc-300">
          <section className="space-y-2 rounded-xl border border-white/[0.06] bg-zinc-950 p-4">
            <h3 className="text-sm font-medium text-zinc-100">
              Autenticidade e integridade probatória
            </h3>
            <p className="text-zinc-400">
              Para assegurar a validade jurídica da evidência digital, o Clio aplica quatro mecanismos:
            </p>
            <ul className="space-y-2 pt-1">
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                <span><strong className="font-medium text-zinc-200">Carimbo temporal inalterável:</strong> data, hora e autos estampados no fluxo de vídeo.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                <span><strong className="font-medium text-zinc-200">Gravação tolerante a falhas:</strong> contêiner MKV/WebM contínuo com diário de segurança.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                <span><strong className="font-medium text-zinc-200">Integridade matemática:</strong> hash SHA-256 calculado ao encerrar a gravação.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                <span><strong className="font-medium text-zinc-200">Certidão documental:</strong> extrato em PDF com assinatura eletrônica ou física.</span>
              </li>
            </ul>
          </section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <section className="space-y-1.5 rounded-xl border border-white/[0.06] bg-zinc-950 p-4">
              <h3 className="text-sm font-medium text-zinc-100">Posicionamento de câmeras</h3>
              <p className="text-zinc-400">
                <strong className="font-medium text-zinc-200">Câmera 1 (depoente):</strong> plano médio na altura dos olhos.<br />
                <strong className="font-medium text-zinc-200">Câmera 2 (mesa):</strong> visão angular da autoridade e dos defensores.
              </p>
            </section>

            <section className="space-y-1.5 rounded-xl border border-white/[0.06] bg-zinc-950 p-4">
              <h3 className="text-sm font-medium text-zinc-100">Monitoramento de áudio</h3>
              <p className="text-zinc-400">
                Acompanhe o medidor no rodapé do estúdio. Mantenha os níveis médios entre 30% e 70% para garantir clareza nas transcrições oficiais.
              </p>
            </section>
          </div>
        </div>

        <div className="flex justify-end border-t border-white/[0.06] bg-zinc-950 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-white/[0.08] px-4 text-[13px] text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
