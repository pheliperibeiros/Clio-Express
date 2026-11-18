import { OitivaMetadata } from '../types/oitiva';
import { AppSettings } from './settingsService';

const MONTHS_PT_BR = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export interface ReportTemplateContext {
  metadata: OitivaMetadata;
  settings: AppSettings;
  startedAt: Date;
  endedAt?: Date;
  durationSeconds?: number;
  filename?: string;
  sha256?: string;
}

function normalizeTokenKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function formatDurationCompact(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) {
    return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  }
  return `${pad(m)}m ${pad(s)}s`;
}

function resolveAuthorityName(metadata: OitivaMetadata, settings: AppSettings): string {
  if (settings.authorityName && settings.authorityName.trim()) {
    return settings.authorityName.trim();
  }
  const resp = (metadata.autoridadeResponsavel || '').trim();
  const title = (settings.authorityTitle || '').trim();
  if (resp) {
    if (title && resp.toLowerCase().startsWith(title.toLowerCase())) {
      const stripped = resp.slice(title.length).replace(/^[\s\-–—:]+/, '').trim();
      if (stripped) return stripped;
    } else {
      return resp;
    }
  }
  return 'Autoridade não nominada';
}

export function resolveAuthorityDisplayParts(
  metadata: OitivaMetadata,
  settings?: Partial<AppSettings>
): { nome: string; titulo: string } {
  const raw = (metadata.autoridadeResponsavel || '').trim();
  const cfgTitle = (settings?.authorityTitle || '').trim();
  const cfgName = (settings?.authorityName || '').trim();

  if (raw) {
    const sepMatch = raw.match(/^(.*?)\s+[-–—]\s+(.*)$/);
    if (sepMatch) {
      if (cfgTitle && raw.toLowerCase().startsWith(cfgTitle.toLowerCase())) {
        const rest = raw.slice(cfgTitle.length).replace(/^[\s\-–—:]+/, '').trim();
        return {
          nome: rest || cfgName || 'Autoridade Conducente',
          titulo: cfgTitle,
        };
      }
      if (cfgName && raw.toLowerCase().startsWith(cfgName.toLowerCase())) {
        const rest = raw.slice(cfgName.length).replace(/^[\s\-–—:]+/, '').trim();
        return {
          nome: cfgName,
          titulo: rest || cfgTitle || 'Autoridade Conducente',
        };
      }

      const left = sepMatch[1].trim();
      const right = sepMatch[2].trim();
      const titleRegex = /\b(promotor|juiz|juíza|procurador|delegado|autoridade|defensor|desembargador|ministro)\b/i;
      if (titleRegex.test(right) && !titleRegex.test(left)) {
        return { nome: left, titulo: right };
      }
      return { nome: right, titulo: left };
    }

    if (cfgTitle && raw.toLowerCase() === cfgTitle.toLowerCase()) {
      return {
        nome: cfgName || 'Autoridade Conducente',
        titulo: raw,
      };
    }

    return {
      nome: raw,
      titulo: cfgTitle || 'Autoridade Conducente',
    };
  }

  return {
    nome: cfgName || 'Autoridade Conducente',
    titulo: cfgTitle || 'Autoridade Conducente',
  };
}

export function renderReportTemplate(
  template: string,
  context: ReportTemplateContext
): string {
  if (!template) return '';

  const { metadata, settings, startedAt, endedAt, durationSeconds = 0, filename = '', sha256 = '' } = context;

  const day = String(startedAt.getDate()).padStart(2, '0');
  const month = MONTHS_PT_BR[startedAt.getMonth()] || '';
  const year = String(startedAt.getFullYear());
  const dateStr = startedAt.toLocaleDateString('pt-BR');
  const startTime = startedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const startFullTime = startedAt.toLocaleTimeString('pt-BR');
  const endDate = endedAt || startedAt;
  const endFullTime = endDate.toLocaleTimeString('pt-BR');

  const localValue = (metadata.orgaoInstituicao || settings.defaultOrgao || 'Não informado').trim();
  const authorityTitleValue = (settings.authorityTitle || 'Autoridade Conducente').trim();
  const authorityNameValue = resolveAuthorityName(metadata, settings);
  const authorityFullValue = (
    metadata.autoridadeResponsavel ||
    (settings.authorityName ? `${authorityTitleValue} - ${settings.authorityName}` : authorityTitleValue)
  ).trim();

  const formatDefender = (index: number): string => {
    const adv = metadata.advogados?.[index];
    if (!adv || (!adv.nome?.trim() && !adv.oab?.trim())) {
      return 'Não informado';
    }
    const name = (adv.nome || '').trim() || 'Advogado não nominado';
    const oab = (adv.oab || '').trim();
    return oab ? `${name} (${oab})` : name;
  };

  const formatOab = (index: number): string => {
    const adv = metadata.advogados?.[index];
    const oab = (adv?.oab || '').trim();
    return oab || 'Não informado';
  };

  const defensor1Value = formatDefender(0);
  const defensor2Value = formatDefender(1);
  const defensor3Value = formatDefender(2);
  const oab1Value = formatOab(0);
  const oab2Value = formatOab(1);
  const oab3Value = formatOab(2);

  const tokenValues: Record<string, string> = {
    dia: day,
    mes: month,
    ano: year,
    data: dateStr,
    hora: startTime,
    horario: startTime,
    inicio: startFullTime,
    comeco: startFullTime,
    'inicio da gravacao': startFullTime,
    'comeco da gravacao': startFullTime,
    'hora de inicio': startFullTime,
    'hora inicio': startFullTime,
    'horario de inicio': startFullTime,
    'horario inicio': startFullTime,
    'hora inicial': startFullTime,
    fim: endFullTime,
    final: endFullTime,
    'fim da gravacao': endFullTime,
    'final da gravacao': endFullTime,
    'hora de fim': endFullTime,
    'hora fim': endFullTime,
    'hora de termino': endFullTime,
    'hora termino': endFullTime,
    'horario de termino': endFullTime,
    'horario fim': endFullTime,
    'hora final': endFullTime,
    termino: endFullTime,
    local: localValue,
    orgao: localValue,
    instituicao: localValue,
    'orgao instituicao': localValue,
    'titulo da autoridade': authorityTitleValue,
    'titulo autoridade': authorityTitleValue,
    cargo: authorityTitleValue,
    'nome da autoridade': authorityNameValue,
    'nome autoridade': authorityNameValue,
    autoridade: authorityFullValue,
    'autoridade responsavel': authorityFullValue,
    'autoridade conducente': authorityFullValue,
    'nome da pessoa': (metadata.nomePessoa || 'Não informado').trim(),
    'nome pessoa': (metadata.nomePessoa || 'Não informado').trim(),
    pessoa: (metadata.nomePessoa || 'Não informado').trim(),
    'pessoa ouvida': (metadata.nomePessoa || 'Não informado').trim(),
    depoente: (metadata.nomePessoa || 'Não informado').trim(),
    qualificacao: (metadata.qualificacao || 'Testemunha').trim(),
    condicao: (metadata.qualificacao || 'Testemunha').trim(),
    documento: (metadata.documento || 'Não informado').trim(),
    cpf: (metadata.documento || 'Não informado').trim(),
    rg: (metadata.documento || 'Não informado').trim(),
    'numero do processo': (metadata.numeroProcesso || 'Não informado').trim(),
    'numero processo': (metadata.numeroProcesso || 'Não informado').trim(),
    processo: (metadata.numeroProcesso || 'Não informado').trim(),
    autos: (metadata.numeroProcesso || 'Não informado').trim(),
    procedimento: (metadata.numeroProcesso || 'Não informado').trim(),
    operador: (metadata.responsavelGravacao || settings.defaultOfficer || 'Não informado').trim(),
    'responsavel gravacao': (metadata.responsavelGravacao || settings.defaultOfficer || 'Não informado').trim(),
    'responsavel pela gravacao': (metadata.responsavelGravacao || settings.defaultOfficer || 'Não informado').trim(),
    secretario: (metadata.responsavelGravacao || settings.defaultOfficer || 'Não informado').trim(),
    'defensor 1': defensor1Value,
    defensor1: defensor1Value,
    'advogado 1': defensor1Value,
    advogado1: defensor1Value,
    'defensor 2': defensor2Value,
    defensor2: defensor2Value,
    'advogado 2': defensor2Value,
    advogado2: defensor2Value,
    'defensor 3': defensor3Value,
    defensor3: defensor3Value,
    'advogado 3': defensor3Value,
    advogado3: defensor3Value,
    'oab 1': oab1Value,
    oab1: oab1Value,
    'oab 2': oab2Value,
    oab2: oab2Value,
    'oab 3': oab3Value,
    oab3: oab3Value,
    duracao: formatDurationCompact(durationSeconds),
    arquivo: filename || 'gravacao.webm',
    'nome do arquivo': filename || 'gravacao.webm',
    hash: sha256 || '—',
    sha256: sha256 || '—',
    'hash sha256': sha256 || '—',
  };

  return template.replace(/\[([^\]]+)\]/g, (fullMatch, innerKey: string) => {
    const normalized = normalizeTokenKey(innerKey);
    if (normalized in tokenValues) {
      return tokenValues[normalized];
    }
    const defMatch = normalized.match(/^(?:defensor|advogado)\s*(\d+)$/);
    if (defMatch) {
      const idx = Number.parseInt(defMatch[1], 10) - 1;
      if (idx >= 0) return formatDefender(idx);
    }
    const oabMatch = normalized.match(/^oab\s*(\d+)$/);
    if (oabMatch) {
      const idx = Number.parseInt(oabMatch[1], 10) - 1;
      if (idx >= 0) return formatOab(idx);
    }
    return fullMatch;
  });
}
