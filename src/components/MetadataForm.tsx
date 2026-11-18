import React from 'react';
import { Plus, X } from 'lucide-react';
import { OitivaMetadata } from '../types/oitiva';
import { generateRecordingFilename } from '../services/cryptoHash';
import { SealMark } from './SealMark';

interface MetadataFormProps {
  metadata: OitivaMetadata;
  onChange: (updated: Partial<OitivaMetadata>) => void;
  isRecording: boolean;
}

const labelClass = 'text-xs text-zinc-400';
const fieldClass =
  'h-9 w-full rounded-lg border border-white/[0.08] bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30 disabled:opacity-50';

export const MetadataForm: React.FC<MetadataFormProps> = ({
  metadata,
  onChange,
  isRecording,
}) => {
  const filenamePreview = generateRecordingFilename(
    metadata.nomePessoa,
    metadata.numeroProcesso,
    new Date(),
    'webm'
  );

  return (
    <section
      aria-labelledby="metadata-title"
      className="flex flex-col gap-4 rounded-xl border border-white/[0.07] bg-zinc-900 p-4"
    >
      <h2 id="metadata-title" className="text-sm font-medium text-zinc-100">
        Identificação
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Nome do depoente */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="meta-nome-pessoa" className={labelClass}>
            Nome do depoente <span aria-hidden="true">*</span>
          </label>
          <input
            id="meta-nome-pessoa"
            type="text"
            required
            aria-required="true"
            disabled={isRecording}
            value={metadata.nomePessoa}
            onChange={(e) => onChange({ nomePessoa: e.target.value })}
            placeholder="Nome completo"
            aria-describedby="meta-nome-pessoa-hint"
            className={fieldClass}
          />
          <span id="meta-nome-pessoa-hint" className="text-xs text-zinc-400">
            {metadata.nomePessoa.trim()
              ? 'Este nome é estampado no vídeo e no extrato.'
              : 'Obrigatório para iniciar a gravação.'}
          </span>
        </div>

        {/* Qualificação */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="meta-qualificacao" className={labelClass}>
            Qualificação
          </label>
          <select
            id="meta-qualificacao"
            disabled={isRecording}
            value={metadata.qualificacao}
            onChange={(e) => onChange({ qualificacao: e.target.value })}
            className={fieldClass}
          >
            <option value="Testemunha">Testemunha</option>
            <option value="Declarante / Informante">Declarante / informante</option>
            <option value="Vítima / Ofendido(a)">Vítima / ofendido(a)</option>
            <option value="Investigado(a)">Investigado(a)</option>
            <option value="Indiciado(a)">Indiciado(a)</option>
            <option value="Acusado(a) / Réu(ré)">Acusado(a) / réu(ré)</option>
            <option value="Notificado(a)">Notificado(a)</option>
            <option value="Perito(a) / Assistente Técnico(a)">Perito(a) / assistente técnico(a)</option>
            {/* Compatibilidade transparente com registros legados */}
            {metadata.qualificacao === 'Investigado' && <option value="Investigado">Investigado(a)</option>}
            {metadata.qualificacao === 'Réu' && <option value="Réu">Acusado(a) / réu(ré)</option>}
            {metadata.qualificacao === 'Perito' && <option value="Perito">Perito(a) / assistente técnico(a)</option>}
            {metadata.qualificacao === 'Declarante' && <option value="Declarante">Declarante / informante</option>}
            {metadata.qualificacao === 'Vítima' && <option value="Vítima">Vítima / ofendido(a)</option>}
          </select>
        </div>

        {/* Processo */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="meta-numero-processo" className={labelClass}>
            Nº do processo
          </label>
          <input
            id="meta-numero-processo"
            type="text"
            disabled={isRecording}
            value={metadata.numeroProcesso}
            onChange={(e) => onChange({ numeroProcesso: e.target.value })}
            placeholder="2026.0019284 / MPTO"
            className={fieldClass}
          />
        </div>

        {/* Órgão */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="meta-orgao" className={labelClass}>
            Órgão
          </label>
          <input
            id="meta-orgao"
            type="text"
            disabled={isRecording}
            value={metadata.orgaoInstituicao}
            onChange={(e) => onChange({ orgaoInstituicao: e.target.value })}
            placeholder="Ministério Público do Estado do Tocantins"
            className={fieldClass}
          />
        </div>

        {/* Documento */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="meta-documento" className={labelClass}>
            Documento
          </label>
          <input
            id="meta-documento"
            type="text"
            disabled={isRecording}
            value={metadata.documento}
            onChange={(e) => onChange({ documento: e.target.value })}
            placeholder="000.000.000-00"
            className={fieldClass}
          />
        </div>

        {/* Autoridade */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="meta-autoridade" className={labelClass}>
            Autoridade
          </label>
          <input
            id="meta-autoridade"
            type="text"
            disabled={isRecording}
            value={metadata.autoridadeResponsavel}
            onChange={(e) => onChange({ autoridadeResponsavel: e.target.value })}
            placeholder="Promotor de Justiça"
            className={fieldClass}
          />
        </div>
      </div>

      {/* Defesa técnica */}
      <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-400">
            Defesa técnica
            {metadata.advogados && metadata.advogados.length > 0 && ` · ${metadata.advogados.length}`}
          </span>
          <button
            type="button"
            disabled={isRecording}
            onClick={() => {
              const current = metadata.advogados || [];
              const novo = {
                id: `adv_${Date.now()}`,
                nome: '',
                oab: '',
                representando: 'Defesa do depoente',
              };
              onChange({ advogados: [...current, novo] });
            }}
            className="flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Adicionar advogado
          </button>
        </div>

        {metadata.advogados && metadata.advogados.length > 0 && (
          <div className="flex flex-col gap-2">
            {metadata.advogados.map((adv, idx) => (
              <div
                key={adv.id}
                className="relative flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-zinc-950/60 p-2.5"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`adv-nome-${adv.id}`} className="text-xs text-zinc-400">
                    Advogado {idx + 1}
                  </label>
                  <input
                    id={`adv-nome-${adv.id}`}
                    type="text"
                    disabled={isRecording}
                    value={adv.nome}
                    onChange={(e) => {
                      const next = [...(metadata.advogados || [])];
                      next[idx] = { ...next[idx], nome: e.target.value };
                      onChange({ advogados: next });
                    }}
                    placeholder="Nome completo"
                    className="h-8 w-full rounded-md border border-white/[0.08] bg-zinc-900 px-2.5 pr-9 text-xs text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30 disabled:opacity-50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`adv-oab-${adv.id}`} className="text-xs text-zinc-400">
                      OAB
                    </label>
                    <input
                      id={`adv-oab-${adv.id}`}
                      type="text"
                      disabled={isRecording}
                      value={adv.oab}
                      onChange={(e) => {
                        const next = [...(metadata.advogados || [])];
                        next[idx] = { ...next[idx], oab: e.target.value };
                        onChange({ advogados: next });
                      }}
                      placeholder="OAB/TO 00000"
                      className="h-8 w-full rounded-md border border-white/[0.08] bg-zinc-900 px-2.5 text-xs text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30 disabled:opacity-50"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`adv-rep-${adv.id}`} className="text-xs text-zinc-400">
                      Representação
                    </label>
                    <input
                      id={`adv-rep-${adv.id}`}
                      type="text"
                      disabled={isRecording}
                      value={adv.representando}
                      onChange={(e) => {
                        const next = [...(metadata.advogados || [])];
                        next[idx] = { ...next[idx], representando: e.target.value };
                        onChange({ advogados: next });
                      }}
                      placeholder="Defesa do depoente"
                      className="h-8 w-full rounded-md border border-white/[0.08] bg-zinc-900 px-2.5 text-xs text-zinc-100 placeholder:text-zinc-400 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30 disabled:opacity-50"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={() => {
                    const next = (metadata.advogados || []).filter((_, i) => i !== idx);
                    onChange({ advogados: next });
                  }}
                  className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-seal-300 disabled:opacity-50"
                  title="Remover advogado"
                  aria-label={`Remover advogado ${idx + 1}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Arquivo de destino — onde o lacre aparece na tela */}
      <div className="flex min-w-0 items-center gap-2 border-t border-white/[0.06] pt-3">
        <SealMark className="text-brass-500" />
        <span className="shrink-0 text-xs text-zinc-400">Arquivo de destino</span>
        <span className="truncate font-mono text-xs text-zinc-300" title={filenamePreview}>
          {filenamePreview}
        </span>
      </div>
    </section>
  );
};
