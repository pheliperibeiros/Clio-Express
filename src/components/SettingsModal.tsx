import React, { useState, useRef, useMemo } from 'react';
import {
  X,
  Check,
  Scale,
  Shield,
  RotateCcw,
  FileText,
  Eye,
  Upload,
  Download,
  HardDrive,
  FolderOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  AppSettings,
  AuthorityRole,
  DEFAULT_REPORT_TEMPLATE,
  DEFAULT_SETTINGS,
  REPORT_TEMPLATE_VARIABLES,
  saveSettings,
  exportSettingsFile,
  importSettingsFromFile,
  pickStorageFolder,
} from '../services/settingsService';
import { renderReportTemplate } from '../services/reportTemplate';
import { isTauriEnvironment } from '../services/tauriEnvironment';
import { useDialogA11y } from '../hooks/useDialogA11y';
import defaultLogoUrl from '../imgs/logo.png';
import { SealMark } from './SealMark';

interface SettingsModalProps {
  currentSettings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  currentSettings,
  onSave,
  onClose,
}) => {
  const [role, setRole] = useState<AuthorityRole>(currentSettings.authorityRole);
  const [authorityTitle, setAuthorityTitle] = useState(currentSettings.authorityTitle);
  const [authorityName, setAuthorityName] = useState(currentSettings.authorityName);
  const [defaultOrgao, setDefaultOrgao] = useState(currentSettings.defaultOrgao);
  const [defaultOfficer, setDefaultOfficer] = useState(currentSettings.defaultOfficer);
  const [customLogo, setCustomLogo] = useState<string | undefined>(currentSettings.customLogo);
  const [customHeader, setCustomHeader] = useState<string | undefined>(currentSettings.customHeader);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [showHeaderOptions, setShowHeaderOptions] = useState(false);
  const [storageDirectory, setStorageDirectory] = useState<string>(
    currentSettings.storageDirectory || ''
  );
  const [reportTemplate, setReportTemplate] = useState(
    currentSettings.reportTemplate ?? DEFAULT_REPORT_TEMPLATE
  );
  const [savedSuccess, setSavedSuccess] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const configFileInputRef = useRef<HTMLInputElement>(null);

  const dialogRef = useDialogA11y(onClose);

  // Preset switchers
  const handleSelectRole = (newRole: AuthorityRole) => {
    setRole(newRole);
    if (newRole === 'promotor') {
      setAuthorityTitle('Promotor de Justiça');
      if (!defaultOrgao || defaultOrgao.includes('Tribunal')) {
        setDefaultOrgao('Ministério Público do Estado do Tocantins');
      }
    } else if (newRole === 'juiz') {
      setAuthorityTitle('Juiz de Direito');
      if (!defaultOrgao || defaultOrgao.includes('Ministério')) {
        setDefaultOrgao('Tribunal de Justiça do Estado do Tocantins');
      }
    }
  };

  const handleApplyPresetOrgao = (orgao: string) => {
    setDefaultOrgao(orgao);
  };

  const handleInsertVariable = (token: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setReportTemplate((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token}`);
      return;
    }

    const start = textarea.selectionStart ?? reportTemplate.length;
    const end = textarea.selectionEnd ?? reportTemplate.length;
    const before = reportTemplate.slice(0, start);
    const after = reportTemplate.slice(end);
    const nextValue = `${before}${token}${after}`;
    setReportTemplate(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const cursorPos = start + token.length;
      textarea.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const livePreview = useMemo(() => {
    const previewSettings: AppSettings = {
      authorityRole: role,
      authorityTitle: authorityTitle.trim() || (role === 'juiz' ? 'Juiz de Direito' : 'Promotor de Justiça'),
      authorityName: authorityName.trim(),
      defaultOrgao: defaultOrgao.trim() || 'Ministério Público do Estado do Tocantins',
      defaultOfficer: defaultOfficer.trim(),
      defaultProcedimentoTipo: currentSettings.defaultProcedimentoTipo || 'Autos',
      reportTemplate,
    };

    const now = new Date();
    return renderReportTemplate(reportTemplate, {
      metadata: {
        nomePessoa: 'Maria da Silva',
        qualificacao: 'Testemunha',
        documento: '000.111.222-33',
        numeroProcesso: '2026.0019284 / MPTO',
        orgaoInstituicao: previewSettings.defaultOrgao,
        autoridadeResponsavel: previewSettings.authorityName
          ? `${previewSettings.authorityTitle} - ${previewSettings.authorityName}`
          : previewSettings.authorityTitle,
        responsavelGravacao: previewSettings.defaultOfficer || 'Oficial de Promotoria',
        observacoes: '',
        advogados: [
          { id: 'prev_1', nome: 'Dr. João Carlos', oab: 'OAB/TO 1234', representando: 'Defesa do Depoente' },
          { id: 'prev_2', nome: 'Dra. Ana Paula', oab: 'OAB/TO 5678', representando: 'Defesa Técnica' },
          { id: 'prev_3', nome: 'Dr. Marcos Oliveira', oab: 'OAB/TO 9012', representando: 'Assistência' },
        ],
      },
      settings: previewSettings,
      startedAt: now,
      endedAt: new Date(now.getTime() + 15 * 60 * 1000),
      durationSeconds: 900,
      filename: 'OITIVA_Maria_da_Silva_2026.webm',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
  }, [
    role,
    authorityTitle,
    authorityName,
    defaultOrgao,
    defaultOfficer,
    reportTemplate,
    currentSettings.defaultProcedimentoTipo,
  ]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLogoError('Por favor, selecione um arquivo de imagem válido (PNG, JPG, SVG, WebP).');
      return;
    }

    setLogoError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const rawResult = event.target?.result as string;
      if (!rawResult) return;

      if (file.type === 'image/svg+xml') {
        setCustomLogo(rawResult);
        return;
      }

      // Otimização / redimensionamento com canvas para garantir storage leve
      const img = new Image();
      img.onload = () => {
        const maxDim = 512;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          setCustomLogo(canvas.toDataURL('image/png'));
        } else {
          setCustomLogo(rawResult);
        }
      };
      img.onerror = () => {
        setCustomLogo(rawResult);
      };
      img.src = rawResult;
    };
    reader.readAsDataURL(file);

    // Reset input value to allow re-uploading same file if desired
    e.target.value = '';
  };

  const handleRestoreDefaultLogo = () => {
    setCustomLogo(undefined);
    setLogoError(null);
  };

  const handleHeaderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawResult = event.target?.result as string;
      if (rawResult) {
        setCustomHeader(rawResult);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleResetToDefault = () => {
    setRole(DEFAULT_SETTINGS.authorityRole);
    setAuthorityTitle(DEFAULT_SETTINGS.authorityTitle);
    setAuthorityName(DEFAULT_SETTINGS.authorityName);
    setDefaultOrgao(DEFAULT_SETTINGS.defaultOrgao);
    setDefaultOfficer(DEFAULT_SETTINGS.defaultOfficer);
    setReportTemplate(DEFAULT_SETTINGS.reportTemplate);
    setCustomLogo(DEFAULT_SETTINGS.customLogo);
    setCustomHeader(DEFAULT_SETTINGS.customHeader);
    setStorageDirectory(DEFAULT_SETTINGS.storageDirectory || '');
    setLogoError(null);
  };

  const handleExportConfig = () => {
    const current: AppSettings = {
      authorityRole: role,
      authorityTitle: authorityTitle.trim() || (role === 'juiz' ? 'Juiz de Direito' : 'Promotor de Justiça'),
      authorityName: authorityName.trim(),
      defaultOrgao: defaultOrgao.trim() || 'Ministério Público do Estado do Tocantins',
      defaultOfficer: defaultOfficer.trim(),
      defaultProcedimentoTipo: currentSettings.defaultProcedimentoTipo || 'Autos',
      reportTemplate,
      storageDirectory: storageDirectory.trim(),
      customLogo,
      customHeader,
    };
    exportSettingsFile(current);
  };

  const handleImportConfig = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importSettingsFromFile(file);
      setRole(imported.authorityRole);
      setAuthorityTitle(imported.authorityTitle);
      setAuthorityName(imported.authorityName);
      setDefaultOrgao(imported.defaultOrgao);
      setDefaultOfficer(imported.defaultOfficer);
      setReportTemplate(imported.reportTemplate);
      setCustomLogo(imported.customLogo);
      setCustomHeader(imported.customHeader);
      setStorageDirectory(imported.storageDirectory || '');
      alert('Configurações e logotipos importados com sucesso!');
    } catch (err: any) {
      alert(err.message || 'Erro ao importar arquivo de configuração.');
    }
    e.target.value = '';
  };

  const handleSave = async () => {
    const updated: AppSettings = {
      authorityRole: role,
      authorityTitle: authorityTitle.trim() || (role === 'juiz' ? 'Juiz de Direito' : 'Promotor de Justiça'),
      authorityName: authorityName.trim(),
      defaultOrgao: defaultOrgao.trim() || 'Ministério Público do Estado do Tocantins',
      defaultOfficer: defaultOfficer.trim(),
      defaultProcedimentoTipo: currentSettings.defaultProcedimentoTipo || 'Autos',
      reportTemplate,
      storageDirectory: storageDirectory.trim(),
      customLogo,
      customHeader,
    };

    await saveSettings(updated);
    onSave(updated);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabIndex={-1}
        className="my-auto flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900 shadow-2xl shadow-black/50 focus:outline-none"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] bg-zinc-950 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <SealMark className="text-brass-500" size={18} />
            <div className="min-w-0">
              <h2 id="settings-modal-title" className="text-base font-semibold text-zinc-100">
                Padrões institucionais e perfil
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Valores carregados por padrão em todas as novas oitivas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações"
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Corpo */}
        <div className="space-y-6 overflow-y-auto p-6 text-[13px] leading-relaxed text-zinc-300">
          {/* Perfil da autoridade */}
          <section className="space-y-2.5">
            <span className="block text-xs text-zinc-400">Perfil da autoridade conducente</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleSelectRole('promotor')}
                aria-pressed={role === 'promotor'}
                className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors ${
                  role === 'promotor'
                    ? 'border-zinc-400/50 bg-zinc-950'
                    : 'border-white/[0.06] bg-zinc-950/40 hover:border-white/[0.12]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-zinc-300" />
                    <span className="text-[13px] font-medium text-zinc-100">Promotor(a) de Justiça</span>
                  </div>
                  {role === 'promotor' && <Check className="h-4 w-4 text-zinc-300" />}
                </div>
                <span className="text-xs leading-relaxed text-zinc-400">
                  Ministério Público: inquéritos civis, PIC e procedimentos preparatórios
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectRole('juiz')}
                aria-pressed={role === 'juiz'}
                className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors ${
                  role === 'juiz'
                    ? 'border-zinc-400/50 bg-zinc-950'
                    : 'border-white/[0.06] bg-zinc-950/40 hover:border-white/[0.12]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Scale className="h-4 w-4 text-zinc-300" />
                    <span className="text-[13px] font-medium text-zinc-100">Juiz(a) de Direito</span>
                  </div>
                  {role === 'juiz' && <Check className="h-4 w-4 text-zinc-300" />}
                </div>
                <span className="text-xs leading-relaxed text-zinc-400">
                  Poder Judiciário: audiências de instrução e julgamento, varas
                </span>
              </button>
            </div>
          </section>

          {/* Título e nome */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-authority-title" className="text-xs text-zinc-400">
                Título oficial da autoridade
              </label>
              <input
                id="settings-authority-title"
                type="text"
                value={authorityTitle}
                onChange={(e) => setAuthorityTitle(e.target.value)}
                placeholder="Promotor de Justiça"
                className="h-9 w-full rounded-lg border border-white/[0.08] bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-authority-name" className="text-xs text-zinc-400">
                Nome da autoridade titular (opcional)
              </label>
              <input
                id="settings-authority-name"
                type="text"
                value={authorityName}
                onChange={(e) => setAuthorityName(e.target.value)}
                placeholder="Dr(a). Nome e sobrenome"
                className="h-9 w-full rounded-lg border border-white/[0.08] bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
              />
            </div>
          </div>

          {/* Órgão padrão */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor="settings-default-orgao" className="text-xs text-zinc-400">
                Órgão padrão
              </label>
              <span className="text-xs text-zinc-500">Estampado no vídeo e no extrato</span>
            </div>
            <input
              id="settings-default-orgao"
              type="text"
              value={defaultOrgao}
              onChange={(e) => setDefaultOrgao(e.target.value)}
              placeholder="Grupo de Atuação Especial de Combate ao Crime Organizado"
              className="h-9 w-full rounded-lg border border-white/[0.08] bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
              <span className="text-xs text-zinc-500">Sugestões</span>
              {[
                { label: 'GAECO', value: 'Grupo de Atuação Especial de Combate ao Crime Organizado - GAECO' },
                { label: 'MPTO', value: 'Ministério Público do Estado do Tocantins' },
                { label: 'Tribunal de Justiça', value: 'Tribunal de Justiça do Estado do Tocantins' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleApplyPresetOrgao(preset.value)}
                  className="text-xs text-zinc-400 underline decoration-white/20 underline-offset-4 transition-colors hover:text-zinc-100 hover:decoration-white/40"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logotipo institucional */}
          <section className="space-y-3 border-t border-white/[0.06] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-zinc-100">Logotipo institucional</h3>
              {customLogo && (
                <button
                  type="button"
                  onClick={handleRestoreDefaultLogo}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-100"
                  title="Restaurar o logo padrão do GAECO"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Restaurar padrão</span>
                </button>
              )}
            </div>

            <p className="text-xs leading-relaxed text-zinc-400">
              Substitua o logo padrão do GAECO pela marca ou brasão da sua promotoria, vara, tribunal,
              delegacia ou órgão. A imagem é estampada no canto inferior direito do vídeo e na barra
              institucional.
            </p>

            <div className="flex flex-col items-center gap-4 rounded-xl border border-white/[0.06] bg-zinc-950 p-4 sm:flex-row">
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-white/[0.06] bg-zinc-900 p-2">
                  <img
                    src={customLogo || defaultLogoUrl}
                    alt="Prévia do logo"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <span className="text-xs text-zinc-500">Prévia no vídeo</span>
              </div>

              <div className="flex w-full flex-col gap-2.5 text-left">
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  {customLogo ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      Logo personalizado ativo
                    </>
                  ) : (
                    <>
                      <Shield className="h-3.5 w-3.5 text-zinc-400" />
                      Logo padrão do GAECO
                    </>
                  )}
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="custom-logo-file-input"
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-xs text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100"
                  >
                    <Upload className="h-4 w-4 text-zinc-400" />
                    <span>{customLogo ? 'Substituir imagem' : 'Carregar logo'}</span>
                  </button>

                  {customLogo && (
                    <button
                      type="button"
                      onClick={handleRestoreDefaultLogo}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-400 transition-colors hover:text-zinc-100"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Voltar ao GAECO</span>
                    </button>
                  )}
                </div>

                <p className="text-xs leading-relaxed text-zinc-500">
                  PNG, JPG, SVG ou WebP. Recomendado fundo transparente e proporção 1:1.
                </p>

                {logoError && (
                  <p className="text-xs font-medium text-seal-300">{logoError}</p>
                )}
              </div>
            </div>

            {/* Cabeçalho timbrado do extrato */}
            <div>
              <button
                type="button"
                onClick={() => setShowHeaderOptions(!showHeaderOptions)}
                className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-100"
                aria-expanded={showHeaderOptions}
              >
                {showHeaderOptions ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span>Cabeçalho timbrado do extrato (opcional)</span>
              </button>

              {showHeaderOptions && (
                <div className="mt-2.5 space-y-2.5 rounded-xl border border-white/[0.06] bg-zinc-950/60 p-3.5">
                  <p className="text-xs leading-relaxed text-zinc-400">
                    O cabeçalho é exibido no topo do termo de oitiva e da certidão técnica em PDF.
                    Você pode anexar uma imagem panorâmica personalizada.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={headerInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleHeaderUpload}
                      className="hidden"
                      id="custom-header-file-input"
                    />
                    <button
                      type="button"
                      onClick={() => headerInputRef.current?.click()}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-xs text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100"
                    >
                      <Upload className="h-4 w-4 text-zinc-400" />
                      <span>{customHeader ? 'Alterar cabeçalho' : 'Carregar cabeçalho'}</span>
                    </button>
                    {customHeader && (
                      <button
                        type="button"
                        onClick={() => setCustomHeader(undefined)}
                        className="text-xs text-zinc-400 underline decoration-white/20 underline-offset-4 transition-colors hover:text-zinc-100"
                      >
                        Restaurar cabeçalho padrão
                      </button>
                    )}
                  </div>
                  {customHeader && (
                    <div className="flex max-h-12 items-center justify-center overflow-hidden rounded-md border border-white/[0.08] bg-white p-1">
                      <img src={customHeader} alt="Prévia do cabeçalho" className="max-h-10 object-contain" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Responsável pela gravação */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="settings-default-officer" className="text-xs text-zinc-400">
              Responsável padrão pela gravação
            </label>
            <input
              id="settings-default-officer"
              type="text"
              value={defaultOfficer}
              onChange={(e) => setDefaultOfficer(e.target.value)}
              placeholder="Oficial de promotoria ou secretário(a) de audiência"
              className="h-9 w-full rounded-lg border border-white/[0.08] bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
            />
          </div>

          {/* Armazenamento local */}
          <section className="space-y-2 border-t border-white/[0.06] pt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor="settings-storage-directory" className="flex items-center gap-1.5 text-xs text-zinc-400">
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Armazenamento local</span>
              </label>
              {storageDirectory && (
                <button
                  type="button"
                  onClick={() => setStorageDirectory('')}
                  className="text-xs text-zinc-400 underline decoration-white/20 underline-offset-4 transition-colors hover:text-zinc-100"
                >
                  Limpar pasta
                </button>
              )}
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">
              Os vídeos serão salvos automaticamente nesta pasta ao finalizar cada gravação.
            </p>
            <div className="flex items-center gap-2">
              <input
                id="settings-storage-directory"
                type="text"
                readOnly
                value={storageDirectory || 'Nenhuma pasta selecionada'}
                className="h-9 flex-1 rounded-lg border border-white/[0.08] bg-zinc-950 px-3 font-mono text-xs text-zinc-300 transition-colors focus:outline-none"
              />
              <button
                type="button"
                onClick={async () => {
                  const picked = await pickStorageFolder(storageDirectory);
                  if (picked) setStorageDirectory(picked);
                }}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 text-[13px] text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <FolderOpen className="h-4 w-4" />
                <span>Selecionar pasta</span>
              </button>
            </div>
          </section>

          {/* Texto base do relatório */}
          <section className="space-y-2.5 border-t border-white/[0.06] pt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor="settings-report-template" className="flex items-center gap-1.5 text-xs text-zinc-400">
                <FileText className="h-3.5 w-3.5" />
                <span>Texto base do relatório</span>
              </label>
              <button
                type="button"
                onClick={() => setReportTemplate(DEFAULT_REPORT_TEMPLATE)}
                className="text-xs text-zinc-400 transition-colors hover:text-zinc-100"
              >
                Restaurar texto padrão
              </button>
            </div>

            <p className="text-xs leading-relaxed text-zinc-400">
              Texto introdutório do relatório e do PDF oficial. Clique nos termos variáveis para
              inseri-los na posição do cursor.
            </p>

            <textarea
              id="settings-report-template"
              ref={textareaRef}
              rows={4}
              value={reportTemplate}
              onChange={(e) => setReportTemplate(e.target.value)}
              placeholder="Aos [dia] dias do mês de [mes] de [ano], na sede do [local], na presença do [Titulo da Autoridade], [Nome da Autoridade]..."
              className="w-full resize-y rounded-lg border border-white/[0.08] bg-zinc-950 px-3 py-2.5 text-xs leading-relaxed text-zinc-100 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
            />

            <div className="space-y-1.5">
              <span className="block text-xs text-zinc-500">Termos variáveis</span>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {REPORT_TEMPLATE_VARIABLES.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => handleInsertVariable(v.token)}
                    title={`${v.label}: ${v.description}`}
                    className="font-mono text-xs text-zinc-400 transition-colors hover:text-zinc-100"
                  >
                    {v.token}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 rounded-lg border border-white/[0.06] bg-zinc-950/80 p-3">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Eye className="h-3.5 w-3.5" />
                <span>Prévia do texto gerado</span>
              </div>
              <p className="text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap">
                {livePreview.trim()
                  ? livePreview
                  : 'Nenhum texto base definido. A seção introdutória não será exibida no relatório.'}
              </p>
            </div>
          </section>
        </div>

        {/* Persistência e backup */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-zinc-950/80 px-6 py-2.5 text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span>
              {isTauriEnvironment()
                ? 'Persistência nativa · arquivo local e IndexedDB'
                : 'Persistência ativa · IndexedDB e localStorage'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={configFileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportConfig}
              className="hidden"
              id="import-config-file-input"
            />
            <button
              type="button"
              onClick={() => configFileInputRef.current?.click()}
              className="flex items-center gap-1.5 transition-colors hover:text-zinc-200"
              title="Carregar configurações exportadas em JSON"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Importar</span>
            </button>

            <button
              type="button"
              onClick={handleExportConfig}
              className="flex items-center gap-1.5 transition-colors hover:text-zinc-200"
              title="Exportar todas as configurações e logotipos em JSON"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exportar backup</span>
            </button>
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] bg-zinc-950 px-6 py-3">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="flex items-center gap-1.5 text-[13px] text-zinc-400 transition-colors hover:text-zinc-100"
            title="Redefinir para o padrão de fábrica (MPTO)"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Restaurar padrão MPTO</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg px-3 text-[13px] text-zinc-400 transition-colors hover:text-zinc-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-100 px-4 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-white"
            >
              <Check className="h-4 w-4" />
              <span>{savedSuccess ? 'Salvo' : 'Salvar e aplicar'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
