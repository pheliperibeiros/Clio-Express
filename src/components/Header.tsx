import React from 'react';
import { HelpCircle, SlidersHorizontal } from 'lucide-react';
import { AppSettings } from '../services/settingsService';
import defaultLogoUrl from '../imgs/logo.png';

interface HeaderProps {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  settings?: AppSettings;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSettings, onOpenHelp, settings }) => {
  const roleLabel = settings?.authorityRole === 'juiz' ? 'Juiz' : 'Promotor';
  const activeLogo = settings?.customLogo || defaultLogoUrl;

  const actionClass =
    'h-8 flex items-center gap-2 rounded-lg border border-white/[0.07] px-3 text-[13px] text-zinc-300 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-zinc-100';

  return (
    <header className="flex h-14 shrink-0 select-none items-center justify-between gap-6 border-b border-white/[0.07] px-6 text-zinc-100">
      {/* Identidade institucional */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2.5">
          <img
            src={activeLogo}
            alt="Logo institucional"
            className="h-8 w-8 object-contain"
            title={settings?.customLogo ? 'Logotipo personalizado ativo' : 'Logotipo padrão do GAECO'}
          />
          <span className="text-base font-semibold leading-none">Clio</span>
        </div>
        <span className="hidden h-4 w-px bg-white/10 sm:inline-block" />
        <span className="hidden truncate text-xs text-zinc-400 sm:inline">
          Sistema de registro audiovisual de audiências
        </span>
      </div>

      {/* Contexto da tela */}
      <nav className="hidden md:block" aria-label="Principal">
        <span
          aria-current="page"
          className="text-[13px] font-medium text-zinc-300"
        >
          Estúdio de gravação
        </span>
      </nav>

      {/* Ações */}
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onOpenSettings} className={actionClass} title="Definir padrões institucionais: promotor ou juiz, órgão padrão, pasta de armazenamento e titular">
          <SlidersHorizontal className="h-4 w-4 text-zinc-400" />
          <span>Configurações</span>
          {settings && (
            <span className="hidden text-xs text-zinc-400 xl:inline">· {roleLabel}</span>
          )}
        </button>

        <button type="button" onClick={onOpenHelp} className={actionClass} title="Informações do sistema, integridade e diretrizes audiovisuais">
          <HelpCircle className="h-4 w-4 text-zinc-400" />
          <span>Informações</span>
        </button>
      </div>
    </header>
  );
};
