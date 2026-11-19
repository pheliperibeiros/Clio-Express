import { jsPDF } from 'jspdf';
import { OitivaMetadata } from '../types/oitiva';
import { formatSha256ForDisplay } from './cryptoHash';
import { HEADER_IMAGE_DATA_URI } from './headerImage';
import { AppSettings } from './settingsService';
import { resolveAuthorityDisplayParts } from './reportTemplate';

export interface ExtratoData {
  metadata: OitivaMetadata;
  filename: string;
  durationSeconds: number;
  totalBytes: number;
  sha256: string;
  startedAt: Date;
  endedAt: Date;
  resolution: string;
  fps: number;
  container: string;
  textoRelatorio?: string;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) {
    return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  }
  return `${pad(m)}m ${pad(s)}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

type TextAlign = 'left' | 'center' | 'right' | 'justify';

interface StyledRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

interface RichBlock {
  align: TextAlign;
  listPrefix?: string;
  runs: StyledRun[];
}

export function stripHtmlToText(htmlOrText: string): string {
  if (!htmlOrText) return '';
  return htmlOrText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function parseAlignFromElement(el: Element, inherited: TextAlign): TextAlign {
  const styleAlign = (el as HTMLElement).style?.textAlign?.toLowerCase();
  const attrAlign = el.getAttribute('align')?.toLowerCase();
  const val = styleAlign || attrAlign;
  if (val === 'center' || val === 'right' || val === 'justify' || val === 'left') {
    return val;
  }
  return inherited;
}

function parseHtmlToBlocks(htmlOrText: string): RichBlock[] {
  const trimmed = (htmlOrText || '').trim();
  if (!trimmed) return [];

  const hasHtml = /<\/?(p|div|br|b|strong|i|em|u|ul|ol|li|span|font)\b[^>]*>/i.test(trimmed);
  if (!hasHtml || typeof DOMParser === 'undefined') {
    return stripHtmlToText(trimmed)
      .split(/\r?\n/)
      .map((line) => ({
        align: 'left' as TextAlign,
        runs: line.trim() ? [{ text: line.trim(), bold: false, italic: false, underline: false }] : [],
      }));
  }

  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(`<div>${trimmed}</div>`, 'text/html');
  const root = parsedDoc.body.firstElementChild;
  if (!root) return [];

  const blocks: RichBlock[] = [];
  let currentInlineRuns: StyledRun[] = [];
  let currentInlineAlign: TextAlign = 'left';

  const flushInline = () => {
    if (currentInlineRuns.length > 0) {
      blocks.push({ align: currentInlineAlign, runs: currentInlineRuns });
      currentInlineRuns = [];
    }
  };

  const collectRuns = (
    node: Node,
    style: { bold: boolean; italic: boolean; underline: boolean },
    target: StyledRun[]
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').replace(/\u00a0/g, ' ');
      if (text) {
        target.push({ text, ...style });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      target.push({ text: '\n', ...style });
      return;
    }

    const nextStyle = {
      bold: style.bold || tag === 'b' || tag === 'strong' || (el as HTMLElement).style?.fontWeight === 'bold',
      italic: style.italic || tag === 'i' || tag === 'em' || (el as HTMLElement).style?.fontStyle === 'italic',
      underline:
        style.underline ||
        tag === 'u' ||
        ((el as HTMLElement).style?.textDecoration || '').includes('underline'),
    };

    Array.from(el.childNodes).forEach((child) => collectRuns(child, nextStyle, target));
  };

  const walkBlock = (node: Node, inheritedAlign: TextAlign) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').replace(/\u00a0/g, ' ');
      if (text.trim()) {
        currentInlineAlign = inheritedAlign;
        currentInlineRuns.push({ text, bold: false, italic: false, underline: false });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const align = parseAlignFromElement(el, inheritedAlign);

    if (tag === 'p' || tag === 'div') {
      flushInline();
      const hasBlockChildren = Array.from(el.children).some((c) =>
        ['p', 'div', 'ul', 'ol'].includes(c.tagName.toLowerCase())
      );
      if (hasBlockChildren) {
        Array.from(el.childNodes).forEach((child) => walkBlock(child, align));
      } else {
        const runs: StyledRun[] = [];
        Array.from(el.childNodes).forEach((child) =>
          collectRuns(child, { bold: false, italic: false, underline: false }, runs)
        );
        blocks.push({ align, runs });
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      flushInline();
      let idx = 1;
      Array.from(el.children).forEach((child) => {
        if (child.tagName.toLowerCase() === 'li') {
          const liAlign = parseAlignFromElement(child, align);
          const runs: StyledRun[] = [];
          Array.from(child.childNodes).forEach((grandChild) =>
            collectRuns(grandChild, { bold: false, italic: false, underline: false }, runs)
          );
          const prefix = tag === 'ol' ? `${idx++}. ` : '• ';
          blocks.push({ align: liAlign, listPrefix: prefix, runs });
        }
      });
      return;
    }

    if (tag === 'br') {
      flushInline();
      blocks.push({ align, runs: [] });
      return;
    }

    currentInlineAlign = align;
    collectRuns(el, { bold: false, italic: false, underline: false }, currentInlineRuns);
  };

  Array.from(root.childNodes).forEach((child) => walkBlock(child, 'left'));
  flushInline();
  return blocks;
}

function getFontStyle(bold: boolean, italic: boolean): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  if (bold && italic) return 'bolditalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

interface WordToken {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  isSpace: boolean;
  isNewline: boolean;
}

function drawRichTextBlocks(
  doc: jsPDF,
  htmlOrText: string,
  margin: number,
  startY: number,
  contentWidth: number,
  pageHeight: number,
  fontSize = 9.5,
  lineHeight = 4.4,
  textColor: [number, number, number] = [30, 41, 59]
): number {
  const blocks = parseHtmlToBlocks(htmlOrText);
  let y = startY;

  doc.setFontSize(fontSize);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  for (const block of blocks) {
    const indent = block.listPrefix ? 5 : 0;
    const availWidth = contentWidth - indent;
    const firstLineIndent =
      !block.listPrefix && (block.align === 'left' || block.align === 'justify') ? 12.5 : 0;

    // Flatten runs into word/space/newline tokens
    const tokens: WordToken[] = [];
    for (const run of block.runs) {
      const parts = run.text.split(/(\n|\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (part === '\n') {
          tokens.push({ text: '', bold: run.bold, italic: run.italic, underline: run.underline, isSpace: false, isNewline: true });
        } else if (/^\s+$/.test(part)) {
          tokens.push({ text: ' ', bold: run.bold, italic: run.italic, underline: run.underline, isSpace: true, isNewline: false });
        } else {
          tokens.push({ text: part, bold: run.bold, italic: run.italic, underline: run.underline, isSpace: false, isNewline: false });
        }
      }
    }

    if (tokens.length === 0 && !block.listPrefix) {
      y += 3;
      continue;
    }

    // Wrap tokens into visual lines (accounting for first-line indent on line 0)
    const lines: WordToken[][] = [];
    let currentLine: WordToken[] = [];
    let currentWidth = 0;

    const getTokenWidth = (t: WordToken) => {
      doc.setFont('times', getFontStyle(t.bold, t.italic));
      return doc.getTextWidth(t.text);
    };

    for (const token of tokens) {
      if (token.isNewline) {
        lines.push(currentLine);
        currentLine = [];
        currentWidth = 0;
        continue;
      }

      if (token.isSpace && currentLine.length === 0) {
        continue;
      }

      const lineMaxWidth = lines.length === 0 ? availWidth - firstLineIndent : availWidth;
      const w = getTokenWidth(token);
      if (currentLine.length > 0 && currentWidth + w > lineMaxWidth && !token.isSpace) {
        // Trim trailing space
        while (currentLine.length > 0 && currentLine[currentLine.length - 1].isSpace) {
          currentLine.pop();
        }
        lines.push(currentLine);
        currentLine = [token];
        currentWidth = w;
      } else {
        currentLine.push(token);
        currentWidth += w;
      }
    }

    while (currentLine.length > 0 && currentLine[currentLine.length - 1].isSpace) {
      currentLine.pop();
    }
    if (currentLine.length > 0 || lines.length === 0) {
      lines.push(currentLine);
    }

    // Render lines
    lines.forEach((lineTokens, lineIdx) => {
      if (y > pageHeight - 25) {
        doc.addPage();
        y = 25;
        doc.setFontSize(fontSize);
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      }

      const baseX = margin + indent;
      if (lineIdx === 0 && block.listPrefix) {
        doc.setFont('times', 'bold');
        doc.text(block.listPrefix, margin + 1, y);
      }

      const lineIndent = lineIdx === 0 ? firstLineIndent : 0;
      const lineStartX = baseX + lineIndent;
      const lineAvailWidth = availWidth - lineIndent;
      const lineTokensWidth = lineTokens.reduce((acc, t) => acc + getTokenWidth(t), 0);
      const isLastLine = lineIdx === lines.length - 1;
      const spaceCount = lineTokens.filter((t) => t.isSpace).length;

      let cursorX = lineStartX;
      let extraSpace = 0;

      if (block.align === 'center') {
        cursorX = baseX + Math.max(0, (availWidth - lineTokensWidth) / 2);
      } else if (block.align === 'right') {
        cursorX = baseX + Math.max(0, availWidth - lineTokensWidth);
      } else if (block.align === 'justify' && !isLastLine && spaceCount > 0) {
        extraSpace = Math.max(0, (lineAvailWidth - lineTokensWidth) / spaceCount);
      }

      for (const token of lineTokens) {
        doc.setFont('times', getFontStyle(token.bold, token.italic));
        const w = doc.getTextWidth(token.text);
        if (!token.isSpace) {
          doc.text(token.text, cursorX, y);
          if (token.underline) {
            doc.setDrawColor(textColor[0], textColor[1], textColor[2]);
            doc.setLineWidth(0.25);
            doc.line(cursorX, y + 0.8, cursorX + w, y + 0.8);
          }
          cursorX += w;
        } else {
          cursorX += w + extraSpace;
        }
      }

      y += lineHeight;
    });

    y += 1.8;
  }

  return y;
}

export function generateExtratoPdf(data: ExtratoData, settings?: Partial<AppSettings>): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  const headerHeight = pageWidth / (1651 / 280);
  const subOrgao = data.metadata.orgaoInstituicao
    ? data.metadata.orgaoInstituicao
    : 'Certidão de Autenticidade e Integridade Digital';

  const headerImageData = settings?.customHeader || HEADER_IMAGE_DATA_URI;
  const headerImageFormat = /^data:image\/jpe?g/i.test(headerImageData) ? 'JPEG' : 'PNG';

  const drawPageHeader = (title: string): number => {
    try {
      doc.addImage(headerImageData, headerImageFormat, 0, 0, pageWidth, headerHeight);
    } catch {
      // Fallback para header padrão se houver qualquer erro de formato
      doc.addImage(HEADER_IMAGE_DATA_URI, 'PNG', 0, 0, pageWidth, headerHeight);
    }
    let currentY = headerHeight + 5;
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(title, pageWidth / 2, currentY, { align: 'center' });
    currentY += 4.5;

    doc.setFont('times', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(subOrgao, pageWidth / 2, currentY, { align: 'center' });
    return currentY + 8;
  };

  // =========================================================================
  // PÁGINA 1: TERMO / TEXTO DO RELATÓRIO + ASSINATURAS (AUTORIDADE, DEPOENTE, ADVOGADOS)
  // =========================================================================
  let y = drawPageHeader('TERMO DE OITIVA E REGISTRO AUDIOVISUAL');

  // Posiciona o trecho mais abaixo e centralizado verticalmente na Página 1
  y = Math.max(y + 34, 96);

  if (data.textoRelatorio && stripHtmlToText(data.textoRelatorio).length > 0) {
    y = drawRichTextBlocks(
      doc,
      data.textoRelatorio,
      margin,
      y,
      contentWidth,
      pageHeight,
      10,
      4.6,
      [30, 41, 59]
    );
    y += 10;
  } else {
    y += 18;
  }

  // Signatures on Page 1: Autoridade, Depoente, Advogados
  const sigWidth = 72;
  const sig1X = margin + 5;
  const sig2X = pageWidth - margin - sigWidth - 5;

  if (y > pageHeight - 50) {
    doc.addPage();
    y = 30;
  } else {
    y = Math.max(y + 16, 175);
    if (y > pageHeight - 55) {
      y = pageHeight - 55;
    }
  }

  // Row 1: Autoridade & Depoente
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.4);
  doc.line(sig1X, y, sig1X + sigWidth, y);
  doc.line(sig2X, y, sig2X + sigWidth, y);

  // Autoridade (1ª linha: Nome, 2ª linha: Título)
  const authoritySig = resolveAuthorityDisplayParts(data.metadata, settings);
  doc.setFont('times', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(authoritySig.nome, sig1X + sigWidth / 2, y + 4.5, { align: 'center' });
  doc.setFont('times', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(authoritySig.titulo, sig1X + sigWidth / 2, y + 8, { align: 'center' });

  // Depoente
  doc.setFont('times', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(data.metadata.nomePessoa || 'Pessoa Ouvida', sig2X + sigWidth / 2, y + 4.5, { align: 'center' });
  doc.setFont('times', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(data.metadata.qualificacao || 'Depoente / Testemunha', sig2X + sigWidth / 2, y + 8, { align: 'center' });

  y += 20;

  // Row 2+: Advogados signatures (if any)
  if (data.metadata.advogados && data.metadata.advogados.length > 0) {
    const advs = data.metadata.advogados;
    for (let i = 0; i < advs.length; i += 2) {
      if (y > pageHeight - 30) {
        doc.addPage();
        y = 30;
      }

      const adv1 = advs[i];
      const adv2 = advs[i + 1];

      const targetX1 = adv2 ? sig1X : (pageWidth / 2) - (sigWidth / 2);
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.4);
      doc.line(targetX1, y, targetX1 + sigWidth, y);

      doc.setFont('times', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(adv1.nome || 'Advogado / Defensor', targetX1 + sigWidth / 2, y + 4.5, { align: 'center' });
      doc.setFont('times', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      const adv1Sub = `${adv1.oab ? adv1.oab + ' · ' : ''}${adv1.representando || 'Defesa Técnica'}`;
      doc.text(adv1Sub, targetX1 + sigWidth / 2, y + 8, { align: 'center' });

      if (adv2) {
        doc.line(sig2X, y, sig2X + sigWidth, y);
        doc.setFont('times', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);
        doc.text(adv2.nome || 'Advogado / Defensor', sig2X + sigWidth / 2, y + 4.5, { align: 'center' });
        doc.setFont('times', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        const adv2Sub = `${adv2.oab ? adv2.oab + ' · ' : ''}${adv2.representando || 'Defesa Técnica'}`;
        doc.text(adv2Sub, sig2X + sigWidth / 2, y + 8, { align: 'center' });
      }

      y += 18;
    }
  }

  // =========================================================================
  // PÁGINA 2+: RELATÓRIO TÉCNICO (ITENS 1, 2, 3, 4 E 5) + ASSINATURA DO OPERADOR
  // =========================================================================
  doc.addPage();
  y = drawPageHeader('EXTRATO E CERTIDÃO DE REGISTRO AUDIOVISUAL DE OITIVA');

  // SECTION 1: Identificação do Procedimento e Pessoa Ouvida
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('1. IDENTIFICAÇÃO DA OITIVA E DAS PARTES', margin, y);
  y += 2;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  const col1X = margin;
  const colGap = 6;
  const colWidth = (contentWidth - colGap) / 2;
  const col2X = margin + colWidth + colGap;

  /**
   * Desenha rótulo + valor dentro da largura da coluna, quebrando o texto
   * em múltiplas linhas para que valores longos (ex.: nome da autoridade)
   * nunca avancem sobre a coluna seguinte.
   * Retorna a altura total ocupada pelo campo.
   */
  const drawField = (label: string, value: string, x: number, currentY: number): number => {
    doc.setFont('times', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(label.toUpperCase(), x, currentY);

    doc.setFont('times', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(value || '—', colWidth);
    lines.forEach((line: string, idx: number) => {
      doc.text(line, x, currentY + 4.5 + idx * 4);
    });
    return 4.5 + Math.max(1, lines.length) * 4;
  };

  const drawFieldRow = (
    left: [label: string, value: string],
    right?: [label: string, value: string]
  ) => {
    const leftHeight = drawField(left[0], left[1], col1X, y);
    const rightHeight = right ? drawField(right[0], right[1], col2X, y) : 0;
    y += Math.max(leftHeight, rightHeight) + 3;
  };

  drawFieldRow(
    ['Pessoa Ouvida (Depoente)', data.metadata.nomePessoa],
    ['Qualificação / Condição', data.metadata.qualificacao || 'Testemunha']
  );

  drawFieldRow(
    ['Documento (CPF / RG)', data.metadata.documento || 'Não informado'],
    ['Nº dos Autos / Procedimento', data.metadata.numeroProcesso || 'Não informado']
  );

  drawFieldRow(
    ['Autoridade Conducente', data.metadata.autoridadeResponsavel || 'Não informado'],
    ['Operador / Responsável Técnico', data.metadata.responsavelGravacao || 'Não informado']
  );
  y += 1;

  if (data.metadata.advogados && data.metadata.advogados.length > 0) {
    doc.setFont('times', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text('DEFESA TÉCNICA / ADVOGADO(S) / DEFENSORIA PÚBLICA', col1X, y);
    y += 4.5;

    data.metadata.advogados.forEach((adv) => {
      doc.setFont('times', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      const repText = adv.representando ? ` (${adv.representando})` : '';
      const oabText = adv.oab ? ` · ${adv.oab}` : '';
      doc.text(`• ${adv.nome || 'Advogado não nominado'}${oabText}${repText}`, col1X + 2, y);
      y += 4.5;
    });
    y += 2;
  }

  y += 3;

  // SECTION 2: Dados Técnicos da Gravação
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('2. PARÂMETROS TÉCNICOS DO REGISTRO AUDIOVISUAL', margin, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  const dateStr = data.startedAt.toLocaleDateString('pt-BR');
  const startTimeStr = data.startedAt.toLocaleTimeString('pt-BR');
  const endTimeStr = data.endedAt.toLocaleTimeString('pt-BR');

  drawFieldRow(
    ['Data da Gravação', dateStr],
    ['Horário (Início - Término)', `${startTimeStr} às ${endTimeStr}`]
  );

  drawFieldRow(
    ['Duração Efetiva', formatDuration(data.durationSeconds)],
    ['Tamanho do Arquivo', formatBytes(data.totalBytes)]
  );

  drawFieldRow(
    ['Resolução & Framerate', `${data.resolution} @ ${data.fps} FPS`],
    ['Formato / Contêiner', data.container || 'WebM / Matroska (Fluxo Tolerante a Falhas)']
  );

  drawFieldRow(['Nome do Arquivo Gerado', data.filename]);
  y += 3;

  // SECTION 3: Hash Criptográfico de Integridade e Autenticidade (SHA-256)
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('3. CÓDIGO HASH DE INTEGRIDADE E AUTENTICIDADE (SHA-256)', margin, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentWidth, 22, 2, 2, 'FD');

  doc.setFont('times', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text('ALGORITMO HASH CRIPTOGRÁFICO: SHA-256 (FIPS 180-4 / RFC 6234)', margin + 4, y + 5);

  doc.setFont('courier', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  const formattedHash = formatSha256ForDisplay(data.sha256);
  doc.text(formattedHash.substring(0, 39), margin + 4, y + 11);
  doc.text(formattedHash.substring(40), margin + 4, y + 17);

  y += 26;

  let declaracao =
    'Certifica-se, para os devidos fins legais, que o arquivo digital acima discriminado foi gerado de forma contínua durante o ato da oitiva. O valor hash SHA-256 atesta a integridade e autenticidade absoluta do conteúdo gravado, inviabilizando qualquer adulteração física ou lógica posterior sem detecção matemática imediata.';
  if (data.metadata.retificadoEm) {
    declaracao += ` Informações complementares retificadas em ${new Date(data.metadata.retificadoEm).toLocaleString('pt-BR')}, preservando incólume a cadeia probatória do arquivo de mídia.`;
  }
  y = drawRichTextBlocks(
    doc,
    `<p style="text-align: justify">${declaracao}</p>`,
    margin,
    y,
    contentWidth,
    pageHeight,
    8.5,
    3.9,
    [71, 85, 105]
  );
  y += 3;

  // SECTION 4: Observações e Ocorrências
  if (y > pageHeight - 60) {
    doc.addPage();
    y = 25;
  }

  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('4. OBSERVAÇÕES E OCORRÊNCIAS DA AUDIÊNCIA', margin, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  const hasObservacoes = data.metadata.observacoes && stripHtmlToText(data.metadata.observacoes).length > 0;
  if (hasObservacoes) {
    y = drawRichTextBlocks(
      doc,
      data.metadata.observacoes,
      margin,
      y,
      contentWidth,
      pageHeight,
      8.5,
      4.0,
      [30, 41, 59]
    );
    y += 4;
  } else {
    doc.setFont('times', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Nenhuma ocorrência ou incidente registrado durante o ato.', margin, y);
    y += 8;
  }

  // SECTION 5: Termo de Validação e Assinatura do Operador
  if (y > pageHeight - 40) {
    doc.addPage();
    y = 25;
  }

  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('5. TERMO DE VALIDAÇÃO E ASSINATURA DO OPERADOR', margin, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  const opSigX = (pageWidth / 2) - (sigWidth / 2);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.4);
  doc.line(opSigX, y, opSigX + sigWidth, y);

  doc.setFont('times', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    data.metadata.responsavelGravacao || 'Operador / Responsável Técnico',
    opSigX + sigWidth / 2,
    y + 4.5,
    { align: 'center' }
  );
  doc.setFont('times', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Responsável Técnico pela Gravação / Operador', opSigX + sigWidth / 2, y + 8, { align: 'center' });

  // Footers for all pages
  const totalPages = doc.getNumberOfPages();
  const emittedAt = new Date().toLocaleString('pt-BR');

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('times', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Documento gerado eletronicamente pelo Clio em ${emittedAt}. Autenticidade verificável pelo Hash SHA-256.`,
      margin,
      pageHeight - 8
    );
    doc.text(`Página ${p} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  return doc;
}
