import React, { useState, useEffect } from 'react';
import {
  Copy,
  Check,
  FileText,
  X,
  Edit3,
  Eye,
  Plus,
  Trash2,
  Printer,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ShieldCheck,
  Scale,
  Video,
  Maximize2,
  Minimize2,
  Save,
  AlertCircle,
  FolderOpen,
} from 'lucide-react';
import {
  ExtratoData,
  formatDuration,
  formatBytes,
  generateExtratoPdf,
  stripHtmlToText,
} from '../services/pdfGenerator';
import { formatSha256ForDisplay } from '../services/cryptoHash';
import { Advogado, OitivaMetadata } from '../types/oitiva';
import { AppSettings, loadSettings, saveFileWithNativeDialog, openPathNative } from '../services/settingsService';
import { renderReportTemplate, resolveAuthorityDisplayParts } from '../services/reportTemplate';
import { HEADER_IMAGE_DATA_URI } from '../services/headerImage';
import { RichTextEditor } from './RichTextEditor';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { SealMark } from './SealMark';

interface ExtratoModalProps {
  data: ExtratoData;
  /**
   * URL do vídeo para a prévia. Pode ser `asset:` (arquivo em disco, sem
   * ocupar RAM) ou `blob:` (quando o arquivo final não pôde ser salvo).
   */
  videoSrc: string;
  settings?: AppSettings;
  savedVideoPath?: string;
  onClose: () => void;
  onSaveMetadata?: (updatedMetadata: OitivaMetadata) => void;
}

type ViewMode = 'edit' | 'preview';

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeDisplayHtml(html: string): string {
  if (!html) return '';
  const hasHtml = /<\/?(p|div|br|b|strong|i|em|u|ul|ol|li|span|font)\b[^>]*>/i.test(html);
  if (!hasHtml) {
    const escaped = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped
      .split(/\r?\n/)
      .map((line) => (line.trim() ? `<p>${line}</p>` : '<p><br></p>'))
      .join('');
  }
  if (typeof DOMParser === 'undefined') return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  const allowedTags = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'SPAN', 'FONT']);
  const cleanNode = (node: Node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!allowedTags.has(el.tagName)) {
          const textNode = doc.createTextNode(el.textContent || '');
          node.replaceChild(textNode, child);
          return;
        }
        const textAlign = el.style?.textAlign;
        const alignAttr = el.getAttribute('align');
        Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
        if (textAlign && ['left', 'center', 'right', 'justify'].includes(textAlign)) {
          el.style.textAlign = textAlign;
        } else if (alignAttr && ['left', 'center', 'right', 'justify'].includes(alignAttr.toLowerCase())) {
          el.style.textAlign = alignAttr.toLowerCase();
        }
        cleanNode(el);
      }
    });
  };
  cleanNode(root);
  return root.innerHTML;
}

export const ExtratoModal: React.FC<ExtratoModalProps> = ({
  data: initialData,
  videoSrc,
  settings: providedSettings,
  savedVideoPath,
  onClose,
  onSaveMetadata,
}) => {
  const effectiveSettings = providedSettings ?? loadSettings();
  const dialogRef = useDialogA11y(onClose);

  const buildReportText = (meta: OitivaMetadata, base: ExtratoData) => {
    const tpl = effectiveSettings.reportTemplate;
    if (!tpl || !tpl.trim()) return '';
    return renderReportTemplate(tpl, {
      metadata: meta,
      settings: effectiveSettings,
      startedAt: base.startedAt,
      endedAt: base.endedAt,
      durationSeconds: base.durationSeconds,
      filename: base.filename,
      sha256: base.sha256,
    });
  };

  const [data, setData] = useState<ExtratoData>(() => {
    const initialMeta: OitivaMetadata = {
      ...initialData.metadata,
      advogados: initialData.metadata.advogados || [],
    };
    return {
      ...initialData,
      metadata: initialMeta,
      textoRelatorio:
        initialData.textoRelatorio !== undefined
          ? initialData.textoRelatorio
          : buildReportText(initialMeta, initialData),
    };
  });

  const [isReportTextCustom, setIsReportTextCustom] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [showVideoDrawer, setShowVideoDrawer] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const [copiedHash, setCopiedHash] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [pdfSaved, setPdfSaved] = useState(false);
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    setVideoError(false);
  }, [videoSrc]);

  const calculateWordCount = () => {
    const meta = data.metadata;
    const advNames = (meta.advogados || []).map((a) => `${a.nome} ${a.oab} ${a.representando}`).join(' ');
    const reportPlain = stripHtmlToText(data.textoRelatorio || '');
    const obsPlain = stripHtmlToText(meta.observacoes || '');
    const allText = `${reportPlain} ${meta.nomePessoa} ${meta.qualificacao} ${meta.documento} ${meta.numeroProcesso} ${meta.orgaoInstituicao} ${meta.autoridadeResponsavel} ${meta.responsavelGravacao} ${obsPlain} ${advNames} ${data.filename}`;
    return allText.trim().split(/\s+/).filter(Boolean).length;
  };

  const updateMetadataField = <K extends keyof OitivaMetadata>(field: K, value: OitivaMetadata[K]) => {
    setData((prev) => {
      const nextMeta: OitivaMetadata = {
        ...prev.metadata,
        [field]: value,
        retificadoEm: new Date().toISOString(),
      };
      return {
        ...prev,
        metadata: nextMeta,
        textoRelatorio: isReportTextCustom
          ? prev.textoRelatorio
          : buildReportText(nextMeta, prev),
      };
    });
  };

  const handleUpdateReportText = (htmlValue: string) => {
    setIsReportTextCustom(true);
    setData((prev) => ({
      ...prev,
      textoRelatorio: htmlValue,
      metadata: {
        ...prev.metadata,
        retificadoEm: new Date().toISOString(),
      },
    }));
  };

  const handleRegenerateReportText = () => {
    setIsReportTextCustom(false);
    setData((prev) => ({
      ...prev,
      textoRelatorio: buildReportText(prev.metadata, prev),
    }));
  };

  const handleAddAdvogado = () => {
    const newAdv: Advogado = {
      id: `adv_${Date.now()}`,
      nome: '',
      oab: '',
      representando: 'Defesa do Depoente',
    };
    setData((prev) => {
      const nextMeta: OitivaMetadata = {
        ...prev.metadata,
        advogados: [...(prev.metadata.advogados || []), newAdv],
        retificadoEm: new Date().toISOString(),
      };
      return {
        ...prev,
        metadata: nextMeta,
        textoRelatorio: isReportTextCustom
          ? prev.textoRelatorio
          : buildReportText(nextMeta, prev),
      };
    });
    setViewMode('edit');
  };

  const handleUpdateAdvogado = (id: string, updates: Partial<Advogado>) => {
    setData((prev) => {
      const nextMeta: OitivaMetadata = {
        ...prev.metadata,
        advogados: (prev.metadata.advogados || []).map((adv) =>
          adv.id === id ? { ...adv, ...updates } : adv
        ),
        retificadoEm: new Date().toISOString(),
      };
      return {
        ...prev,
        metadata: nextMeta,
        textoRelatorio: isReportTextCustom
          ? prev.textoRelatorio
          : buildReportText(nextMeta, prev),
      };
    });
  };

  const handleRemoveAdvogado = (id: string) => {
    setData((prev) => {
      const nextMeta: OitivaMetadata = {
        ...prev.metadata,
        advogados: (prev.metadata.advogados || []).filter((adv) => adv.id !== id),
        retificadoEm: new Date().toISOString(),
      };
      return {
        ...prev,
        metadata: nextMeta,
        textoRelatorio: isReportTextCustom
          ? prev.textoRelatorio
          : buildReportText(nextMeta, prev),
      };
    });
  };

  const handleResetToOriginal = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }

    const resetMeta: OitivaMetadata = {
      ...initialData.metadata,
      advogados: initialData.metadata.advogados || [],
    };
    setIsReportTextCustom(false);
    setConfirmReset(false);
    setData({
      ...initialData,
      metadata: resetMeta,
      textoRelatorio:
        initialData.textoRelatorio !== undefined
          ? initialData.textoRelatorio
          : buildReportText(resetMeta, initialData),
    });
  };

  const handleSave = () => {
    if (onSaveMetadata) {
      onSaveMetadata(data.metadata);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleCopyHash = () => {
    navigator.clipboard.writeText(data.sha256);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  // ── Salvar PDF com diálogo nativo do Windows ────────────────────────────
  const handleSavePdf = async () => {
    if (isSavingPdf) return;
    setIsSavingPdf(true);
    setActionError(null);
    try {
      const doc = generateExtratoPdf(data, effectiveSettings);
      const baseName = (data.filename || 'Relatorio_Oitiva').replace(/\.[^/.]+$/, '');
      const pdfFilename = `${baseName}_EXTRATO.pdf`;
      const pdfBlob = doc.output('blob');

      const savedPath = await saveFileWithNativeDialog(
        pdfBlob,
        pdfFilename,
        'Documento PDF',
        ['pdf']
      );

      if (savedPath) {
        setPdfSaved(true);
        setTimeout(() => setPdfSaved(false), 4000);
      }
    } catch (err) {
      console.error('Erro ao gerar/salvar PDF:', err);
      setActionError('Não foi possível gerar/salvar o arquivo PDF. Tente novamente.');
    } finally {
      setIsSavingPdf(false);
    }
  };

  const buildPrintableHtml = (): string => {
    const meta = data.metadata;
    const advs = meta.advogados || [];
    const hasObs = stripHtmlToText(meta.observacoes || '').length > 0;
    const reportHtml = sanitizeDisplayHtml(data.textoRelatorio || '');
    const obsHtml = sanitizeDisplayHtml(meta.observacoes || '');
    const emittedAt = new Date().toLocaleString('pt-BR');
    const authoritySig = resolveAuthorityDisplayParts(meta, effectiveSettings);
    const headerImgUri = effectiveSettings?.customHeader || HEADER_IMAGE_DATA_URI;

    const advSectionHtml =
      advs.length > 0
        ? `<div class="sub-block">
            <div class="label">DEFESA TÉCNICA / ADVOGADO(S) / DEFENSORIA PÚBLICA</div>
            ${advs
              .map(
                (adv) =>
                  `<div class="adv-item">• ${escapeHtml(adv.nome || 'Advogado não nominado')}${
                    adv.oab ? ` · ${escapeHtml(adv.oab)}` : ''
                  }${adv.representando ? ` (${escapeHtml(adv.representando)})` : ''}</div>`
              )
              .join('')}
          </div>`
        : '';

    const advSigHtml =
      advs.length > 0
        ? `<div class="sig-grid${advs.length === 1 ? ' sig-grid-single' : ''}">
            ${advs
              .map(
                (adv) => `<div class="sig-box">
                  <div class="sig-line"></div>
                  <div class="sig-name">${escapeHtml(adv.nome || 'Advogado / Defensor')}</div>
                  <div class="sig-role">${adv.oab ? `${escapeHtml(adv.oab)} · ` : ''}${escapeHtml(
                  adv.representando || 'Defesa Técnica'
                )}</div>
                </div>`
              )
              .join('')}
          </div>`
        : '';

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Extrato - ${escapeHtml(meta.nomePessoa || 'Oitiva')}</title>
  <style>
    @page { size: A4; margin: 16mm 18mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Times New Roman', Times, serif; color: #0f172a; margin: 0; padding: 0; font-size: 11.5px; line-height: 1.5; }
    .page-one { min-height: 256mm; display: flex; flex-direction: column; justify-content: space-between; }
    .page-one-body { margin: auto 0; padding: 14mm 0 8mm 0; }
    .page-break { page-break-before: always; break-before: page; }
    .header-img { width: 100%; max-height: 68px; object-fit: contain; display: block; margin-bottom: 10px; }
    .title { text-align: center; font-size: 13.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; margin: 0; }
    .subtitle { text-align: center; font-size: 10px; color: #64748b; margin: 3px 0 14px 0; }
    .rich-block { margin-bottom: 18px; font-size: 11.5px; color: #1e293b; }
    .rich-block p, .rich-block div { margin: 0 0 6px 0; text-indent: 1.25cm; }
    .rich-block [style*="center"], .rich-block [style*="right"], .rich-block li p, .rich-block li div { text-indent: 0; }
    .rich-block ul, .rich-block ol { margin: 4px 0 8px 22px; padding: 0; }
    .empty-obs { font-size: 10.5px; color: #64748b; font-style: italic; margin: 4px 0 12px 0; }
    h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 14px 0 8px 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
    .label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #475569; }
    .value { font-size: 11px; color: #0f172a; margin-top: 2px; overflow-wrap: anywhere; }
    .sub-block { margin-top: 10px; }
    .adv-item { font-size: 10.5px; margin-top: 3px; }
    .hash-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px 10px; margin-bottom: 8px; }
    .hash-val { font-family: monospace; font-size: 10px; word-break: break-all; margin-top: 4px; font-weight: 700; }
    .decl { font-size: 10px; color: #475569; margin: 0; text-indent: 1.25cm; text-align: justify; }
    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 44px; text-align: center; }
    .sig-grid-single { grid-template-columns: 1fr; max-width: 280px; margin-left: auto; margin-right: auto; }
    .sig-line { border-top: 1px solid #64748b; width: 82%; margin: 0 auto 4px auto; }
    .sig-name { font-weight: 700; font-size: 10.5px; }
    .sig-role { font-size: 9.5px; color: #64748b; }
    .footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 8.5px; color: #94a3b8; font-style: italic; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <!-- PÁGINA 1: TERMO DE OITIVA E ASSINATURAS -->
  <div class="page-one">
    <div>
      <img src="${headerImgUri}" class="header-img" alt="Cabeçalho" />
      <h1 class="title">TERMO DE OITIVA E REGISTRO AUDIOVISUAL</h1>
      <p class="subtitle">${escapeHtml(meta.orgaoInstituicao || 'Ministério Público')}</p>
    </div>

    <div class="page-one-body">
      ${stripHtmlToText(data.textoRelatorio || '').length > 0 ? `<div class="rich-block">${reportHtml}</div>` : ''}

      <div class="sig-grid">
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-name">${escapeHtml(authoritySig.nome)}</div>
          <div class="sig-role">${escapeHtml(authoritySig.titulo)}</div>
        </div>
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-name">${escapeHtml(meta.nomePessoa || 'Pessoa Ouvida')}</div>
          <div class="sig-role">${escapeHtml(meta.qualificacao || 'Depoente / Testemunha')}</div>
        </div>
      </div>
      ${advSigHtml}
    </div>

    <div class="footer">
      <span>Documento gerado eletronicamente pelo Clio em ${escapeHtml(emittedAt)}. Autenticidade verificável pelo Hash SHA-256.</span>
      <span>Página 1 · Termo de Oitiva</span>
    </div>
  </div>

  <!-- PÁGINA 2: RELATÓRIO TÉCNICO -->
  <div class="page-break">
    <img src="${headerImgUri}" class="header-img" alt="Cabeçalho" />
    <h1 class="title">EXTRATO E CERTIDÃO DE REGISTRO AUDIOVISUAL DE OITIVA</h1>
    <p class="subtitle">${escapeHtml(meta.orgaoInstituicao || 'Ministério Público')}</p>

    <h2>1. IDENTIFICAÇÃO DA OITIVA E DAS PARTES</h2>
    <div class="grid">
      <div><div class="label">Pessoa Ouvida (Depoente)</div><div class="value">${escapeHtml(meta.nomePessoa || '—')}</div></div>
      <div><div class="label">Qualificação / Condição</div><div class="value">${escapeHtml(meta.qualificacao || 'Testemunha')}</div></div>
      <div><div class="label">Documento (CPF / RG)</div><div class="value">${escapeHtml(meta.documento || 'Não informado')}</div></div>
      <div><div class="label">Nº dos Autos / Procedimento</div><div class="value">${escapeHtml(meta.numeroProcesso || 'Não informado')}</div></div>
      <div><div class="label">Autoridade Conducente</div><div class="value">${escapeHtml(meta.autoridadeResponsavel || 'Não informado')}</div></div>
      <div><div class="label">Operador / Responsável Técnico</div><div class="value">${escapeHtml(meta.responsavelGravacao || 'Não informado')}</div></div>
    </div>
    ${advSectionHtml}

    <h2>2. PARÂMETROS TÉCNICOS DO REGISTRO AUDIOVISUAL</h2>
    <div class="grid">
      <div><div class="label">Data</div><div class="value">${escapeHtml(data.startedAt.toLocaleDateString('pt-BR'))}</div></div>
      <div><div class="label">Horário</div><div class="value">${escapeHtml(data.startedAt.toLocaleTimeString('pt-BR'))} às ${escapeHtml(data.endedAt.toLocaleTimeString('pt-BR'))}</div></div>
      <div><div class="label">Duração</div><div class="value">${escapeHtml(formatDuration(data.durationSeconds))}</div></div>
      <div><div class="label">Tamanho</div><div class="value">${escapeHtml(formatBytes(data.totalBytes))}</div></div>
      <div><div class="label">Resolução</div><div class="value">${escapeHtml(data.resolution)} @ ${data.fps} FPS</div></div>
      <div><div class="label">Arquivo de Mídia</div><div class="value">${escapeHtml(data.filename)}</div></div>
    </div>

    <h2>3. CÓDIGO HASH DE INTEGRIDADE E AUTENTICIDADE (SHA-256)</h2>
    <div class="hash-box">
      <div class="label">ALGORITMO HASH CRIPTOGRÁFICO: SHA-256 (FIPS 180-4 / RFC 6234)</div>
      <div class="hash-val">${escapeHtml(formatSha256ForDisplay(data.sha256))}</div>
    </div>
    <p class="decl">Certifica-se, para os devidos fins legais, que o arquivo digital acima discriminado foi gerado de forma contínua durante o ato da oitiva. O valor hash SHA-256 atesta a integridade e autenticidade absoluta do conteúdo gravado.</p>

    <h2>4. OBSERVAÇÕES E OCORRÊNCIAS DA AUDIÊNCIA</h2>
    ${
      hasObs
        ? `<div class="rich-block">${obsHtml}</div>`
        : `<p class="empty-obs">Nenhuma ocorrência ou incidente registrado durante o ato.</p>`
    }

    <h2>5. TERMO DE VALIDAÇÃO E ASSINATURA DO OPERADOR</h2>
    <div class="sig-grid sig-grid-single" style="margin-top: 32px;">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-name">${escapeHtml(meta.responsavelGravacao || 'Operador / Responsável Técnico')}</div>
        <div class="sig-role">Responsável Técnico pela Gravação / Operador</div>
      </div>
    </div>

    <div class="footer">
      <span>Documento gerado eletronicamente pelo Clio em ${escapeHtml(emittedAt)}. Autenticidade verificável pelo Hash SHA-256.</span>
      <span>Página 2 · Extrato Técnico</span>
    </div>
  </div>
</body>
</html>`;
  };

  const handlePrint = () => {
    const html = buildPrintableHtml();
    const win = window.open('', '_blank', 'width=900,height=700');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 600);
    }
  };

  const handleZoomIn = () => setZoomLevel((z) => Math.min(200, z + 10));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(50, z - 10));

  const toggleFullscreen = () => setIsFullscreen((f) => !f);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="extrato-modal-title"
        tabIndex={-1}
        className={`flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900 shadow-2xl shadow-black/50 focus:outline-none ${
          isFullscreen ? 'fixed inset-2 sm:inset-4' : 'w-full max-w-5xl max-h-[94vh]'
        }`}
      >
        {/* Cabeçalho */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] bg-zinc-950 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <SealMark className="text-brass-500" size={18} />
            <div className="min-w-0">
              <h2
                id="extrato-modal-title"
                className="truncate text-base font-semibold leading-tight text-zinc-100"
              >
                Extrato e certidão de oitiva
              </h2>
              <p className="truncate font-mono text-xs leading-tight text-zinc-400">
                {data.filename}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar extrato"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
              title="Fechar extrato"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 2. Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Tab bar */}
          <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-4 pt-3 sm:px-5">
            <button
              type="button"
              onClick={() => setViewMode('edit')}
              aria-pressed={viewMode === 'edit'}
              className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-[13px] transition-colors ${
                viewMode === 'edit'
                  ? 'border-zinc-200 font-medium text-zinc-100'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Edit3 className="h-4 w-4" />
              Editar
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              aria-pressed={viewMode === 'preview'}
              className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-[13px] transition-colors ${
                viewMode === 'preview'
                  ? 'border-zinc-200 font-medium text-zinc-100'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Eye className="h-4 w-4" />
              Pré-visualizar
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="ml-auto flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:text-zinc-200"
              title="Imprimir termo de oitiva"
            >
              <Printer className="h-4 w-4" />
              Imprimir
            </button>
            <button
              type="button"
              onClick={() => setShowVideoDrawer((s) => !s)}
              aria-expanded={showVideoDrawer}
              aria-controls="video-preview-drawer"
              className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-[13px] transition-colors ${
                showVideoDrawer
                  ? 'border-zinc-500 text-zinc-200'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
              title="Abrir prévia do vídeo gravado"
            >
              <Video className="h-4 w-4" />
              Prévia
            </button>
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            {actionError && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-seal-500/25 bg-seal-600/[0.08] px-3 py-2.5 text-xs text-seal-200"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-seal-300" />
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  aria-label="Fechar mensagem de erro"
                  className="ml-auto rounded p-0.5 text-seal-300 transition-colors hover:text-seal-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Video preview drawer */}
            {showVideoDrawer && (
              <div
                id="video-preview-drawer"
                className="space-y-2.5 rounded-xl border border-white/[0.07] bg-zinc-950 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-200">
                    <Video className="h-4 w-4 text-zinc-400" />
                    Prévia da gravação
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowVideoDrawer(false)}
                    aria-label="Fechar prévia do vídeo"
                    className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Video player: preload="metadata" garante que a barra de progresso funcione corretamente.
                    A fonte é o arquivo em disco (protocolo asset) quando o salvamento deu certo. */}
                {videoError ? (
                  <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-4 text-center">
                    <p className="text-[13px] font-medium text-zinc-100">
                      Não foi possível pré-visualizar o vídeo
                    </p>
                    <p className="text-xs text-zinc-400">
                      O arquivo continua salvo.{' '}
                      {savedVideoPath
                        ? 'Use “Abrir pasta do vídeo” para reproduzi-lo no player do sistema.'
                        : 'Exporte pela recuperação para reproduzi-lo.'}
                    </p>
                  </div>
                ) : (
                  <div className="aspect-video overflow-hidden rounded-lg border border-white/[0.06] bg-black">
                    <video
                      key={videoSrc}
                      src={videoSrc}
                      controls
                      preload="metadata"
                      playsInline
                      onError={() => setVideoError(true)}
                      className="h-full w-full object-contain"
                      style={{ maxHeight: '400px' }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between font-mono text-xs text-zinc-400">
                  <span>{formatDuration(data.durationSeconds)}</span>
                  <span>{formatBytes(data.totalBytes)}</span>
                </div>
              </div>
            )}

            {viewMode === 'edit' ? (
              /* ── EDIT MODE ─────────────────────────────────────────────── */
              <div className="space-y-5">
                {/* Hash integrity badge */}
                <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-zinc-100">
                      Integridade verificada
                    </div>
                    <div className="mt-0.5 break-all font-mono text-xs text-zinc-300">
                      {formatSha256ForDisplay(data.sha256)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyHash}
                    className="shrink-0 p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                    title="Copiar hash"
                  >
                    {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Identification fields */}
                <section className="space-y-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
                    <Scale className="h-4 w-4 text-zinc-400" />
                    Identificação da oitiva
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      { label: 'Nome da pessoa ouvida', field: 'nomePessoa' as const, placeholder: 'Nome completo do depoente' },
                      { label: 'Nº do processo / autos', field: 'numeroProcesso' as const, placeholder: 'Ex.: IC nº 001/2026' },
                      { label: 'Documento (CPF / RG)', field: 'documento' as const, placeholder: 'CPF ou RG' },
                      { label: 'Autoridade conducente', field: 'autoridadeResponsavel' as const, placeholder: 'Ex.: Promotora de Justiça' },
                      { label: 'Órgão / instituição', field: 'orgaoInstituicao' as const, placeholder: 'Ex.: MPTO' },
                      { label: 'Responsável pela gravação', field: 'responsavelGravacao' as const, placeholder: 'Nome do operador técnico' },
                    ].map(({ label, field, placeholder }) => (
                      <label key={field} className="flex flex-col gap-1.5">
                        <span className="text-xs text-zinc-400">{label}</span>
                        <input
                          type="text"
                          value={(data.metadata[field] as string) || ''}
                          onChange={(e) => updateMetadataField(field, e.target.value)}
                          placeholder={placeholder}
                          className="h-9 rounded-lg border border-white/[0.08] bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
                        />
                      </label>
                    ))}
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs text-zinc-400">Qualificação</span>
                      <select
                        value={data.metadata.qualificacao || 'Testemunha'}
                        onChange={(e) => updateMetadataField('qualificacao', e.target.value)}
                        className="h-9 rounded-lg border border-white/[0.08] bg-zinc-950 px-3 text-[13px] text-zinc-100 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
                      >
                        {['Testemunha', 'Declarante', 'Vítima / Ofendido(a)', 'Investigado(a)', 'Indiciado(a)', 'Acusado(a) / Réu(ré)', 'Perito(a)'].map((q) => (
                          <option key={q} value={q}>{q}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>

                {/* Advogados */}
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-zinc-100">Defesa técnica</h3>
                    <button
                      type="button"
                      onClick={handleAddAdvogado}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-xs text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100"
                    >
                      <Plus className="h-4 w-4" />
                      Adicionar advogado
                    </button>
                  </div>
                  {(data.metadata.advogados || []).length === 0 ? (
                    <p className="text-xs text-zinc-400">Nenhum advogado ou defensor registrado.</p>
                  ) : (
                    <div className="space-y-2">
                      {(data.metadata.advogados || []).map((adv, idx) => (
                        <div key={adv.id} className="grid grid-cols-1 gap-3 rounded-lg border border-white/[0.06] bg-zinc-950/60 p-3 sm:grid-cols-3">
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs text-zinc-400">Advogado {idx + 1}</span>
                            <input
                              type="text"
                              value={adv.nome}
                              onChange={(e) => handleUpdateAdvogado(adv.id, { nome: e.target.value })}
                              placeholder="Nome completo"
                              aria-label={`Nome do advogado ${idx + 1}`}
                              className="h-8 rounded-md border border-white/[0.08] bg-zinc-900 px-2.5 text-xs text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs text-zinc-400">OAB</span>
                            <input
                              type="text"
                              value={adv.oab}
                              onChange={(e) => handleUpdateAdvogado(adv.id, { oab: e.target.value })}
                              placeholder="OAB/TO 00000"
                              aria-label={`OAB do advogado ${idx + 1}`}
                              className="h-8 rounded-md border border-white/[0.08] bg-zinc-900 px-2.5 text-xs text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
                            />
                          </label>
                          <div className="flex items-end gap-1">
                            <label className="flex flex-1 flex-col gap-1.5">
                              <span className="text-xs text-zinc-400">Representa</span>
                              <input
                                type="text"
                                value={adv.representando}
                                onChange={(e) => handleUpdateAdvogado(adv.id, { representando: e.target.value })}
                                placeholder="Defesa do depoente"
                                aria-label={`Representação do advogado ${idx + 1}`}
                                className="h-8 rounded-md border border-white/[0.08] bg-zinc-900 px-2.5 text-xs text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => handleRemoveAdvogado(adv.id)}
                              aria-label={`Remover advogado ${idx + 1}`}
                              title="Remover advogado"
                              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-seal-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Texto do Relatório */}
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-zinc-100">Texto do relatório</h3>
                    {isReportTextCustom && (
                      <button
                        type="button"
                        onClick={handleRegenerateReportText}
                        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Regenerar do modelo
                      </button>
                    )}
                  </div>
                  <RichTextEditor
                    value={data.textoRelatorio || ''}
                    onChange={handleUpdateReportText}
                    label="Texto do relatório / termo da oitiva"
                    placeholder="Texto do termo de oitiva (gerado automaticamente do modelo nas configurações)…"
                  />
                </section>

                {/* Observações */}
                <section className="space-y-2.5">
                  <h3 className="text-sm font-medium text-zinc-100">Observações e ocorrências</h3>
                  <RichTextEditor
                    value={data.metadata.observacoes || ''}
                    onChange={(v) => updateMetadataField('observacoes', v)}
                    label="Observações e ocorrências da oitiva"
                    placeholder="Registre aqui ocorrências, incidentes ou notas relevantes durante o ato…"
                  />
                </section>
              </div>
            ) : (
              /* ── PREVIEW MODE ──────────────────────────────────────────── */
              <div
                className="bg-white rounded-lg overflow-hidden shadow-lg mx-auto"
                style={{ width: `${zoomLevel}%`, maxWidth: '800px', transformOrigin: 'top center' }}
              >
                <iframe
                  srcDoc={buildPrintableHtml()}
                  title="Prévia do Extrato"
                  className="w-full border-0"
                  style={{ height: '70vh', minHeight: '500px' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* 3. Footer Action Bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-zinc-950 px-4 py-3 text-xs sm:px-5">
          {/* Left: meta + zoom */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-zinc-400">
            <span className="flex items-center gap-1.5 text-emerald-300">
              <ShieldCheck className="h-4 w-4" />
              SHA-256 verificado
            </span>
            <span className="hidden text-zinc-600 sm:inline">·</span>
            <span>{calculateWordCount()} palavras</span>

            <div className="hidden items-center gap-1 rounded-md border border-white/[0.07] px-1 py-0.5 sm:flex">
              <button
                type="button"
                onClick={handleZoomOut}
                aria-label="Diminuir zoom"
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
                title="Diminuir zoom"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="w-10 text-center font-mono text-xs tabular-nums text-zinc-300">
                {zoomLevel}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                aria-label="Aumentar zoom"
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
                title="Aumentar zoom"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleResetToOriginal}
              className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors ${
                confirmReset
                  ? 'font-medium text-amber-300 hover:text-amber-200'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
              }`}
              title="Restaurar dados originais da gravação"
            >
              <RotateCcw className="h-4 w-4" />
              <span>{confirmReset ? 'Confirmar restauração?' : 'Restaurar original'}</span>
            </button>
          </div>

          {/* Right: action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {savedVideoPath && (
              <button
                type="button"
                onClick={() => openPathNative(savedVideoPath)}
                className="flex h-9 max-w-[280px] items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
                title={`Vídeo salvo em ${savedVideoPath} — abrir pasta`}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate">Abrir pasta do vídeo</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSave}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 text-[13px] text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-zinc-100"
            >
              {savedSuccess ? <Check className="h-4 w-4 text-emerald-400" /> : <Save className="h-4 w-4" />}
              <span>{savedSuccess ? 'Salvo' : 'Salvar alterações'}</span>
            </button>

            <button
              type="button"
              onClick={handleSavePdf}
              disabled={isSavingPdf}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-100 px-4 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-white disabled:opacity-60"
              title="Escolher onde salvar o relatório oficial em PDF"
            >
              {pdfSaved ? (
                <Check className="h-4 w-4 text-emerald-700" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              <span>{isSavingPdf ? 'Gerando…' : pdfSaved ? 'PDF salvo' : 'Salvar relatório em PDF'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
