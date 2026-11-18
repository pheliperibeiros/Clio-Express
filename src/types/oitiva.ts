export type LayoutMode = 'split' | 'pip-camera1' | 'pip-camera2' | 'single-camera1' | 'single-camera2';

export interface Advogado {
  id: string;
  nome: string;
  oab: string;
  representando: string;
}

export interface OitivaMetadata {
  nomePessoa: string;
  qualificacao: string; // Testemunha, Declarante, Vítima / Ofendido(a), Investigado(a), Indiciado(a), Acusado(a) / Réu(ré), Perito(a)
  documento: string; // CPF ou RG
  numeroProcesso: string; // Ex: Inquérito Civil nº 001/2026
  orgaoInstituicao: string; // Ex: Ministério Público do Estado do Tocantins
  autoridadeResponsavel: string; // Ex: Promotor(a) de Justiça
  responsavelGravacao: string; // Ex: Oficial de Promotoria / Secretário
  observacoes: string;
  advogados?: Advogado[];
  retificadoEm?: string; // Data da retificação se alterado após gravação
}

export interface AudioLevels {
  currentLevel: number; // 0 to 1
  peakLevel: number;
  isClipping: boolean;
}

export interface RecordingSession {
  id: string;
  metadata: OitivaMetadata;
  startedAt: string; // ISO
  endedAt?: string; // ISO
  durationSeconds: number;
  totalBytes: number;
  sha256?: string;
  mimeType: string;
  status: 'idle' | 'recording' | 'paused' | 'completed' | 'crashed';
}

export interface StoredRecoveryChunk {
  sessionId: string;
  chunkIndex: number;
  data: Blob;
  timestamp: number;
}
