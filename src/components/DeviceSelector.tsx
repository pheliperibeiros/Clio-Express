import React from 'react';
import { RefreshCw, Columns2, PictureInPicture, PictureInPicture2, Camera } from 'lucide-react';
import { DetectedDevice } from '../services/deviceManager';
import { LayoutMode } from '../types/oitiva';

interface DeviceSelectorProps {
  cameras: DetectedDevice[];
  microphones: DetectedDevice[];
  selectedCamera1Id: string | null;
  selectedCamera2Id: string | null;
  selectedMicrophoneId: string | null;
  selectedMicrophone2Id?: string | null;
  layoutMode: LayoutMode;
  onSelectCamera1: (id: string) => void;
  onSelectCamera2: (id: string) => void;
  onSelectMicrophone: (id: string) => void;
  onSelectMicrophone2?: (id: string | null) => void;
  onChangeLayout: (mode: LayoutMode) => void;
  onRefreshDevices: () => void;
  isDetecting: boolean;
}

const fieldClass =
  'h-9 w-full rounded-lg border border-white/[0.08] bg-zinc-950 px-3 text-[13px] text-zinc-100 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400/30';

const labelClass = 'flex items-baseline justify-between gap-2 text-xs';

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  cameras,
  microphones,
  selectedCamera1Id,
  selectedCamera2Id,
  selectedMicrophoneId,
  selectedMicrophone2Id,
  layoutMode,
  onSelectCamera1,
  onSelectCamera2,
  onSelectMicrophone,
  onSelectMicrophone2,
  onChangeLayout,
  onRefreshDevices,
  isDetecting,
}) => {
  const cameraCount =
    cameras.length === 0
      ? 'Nenhuma câmera'
      : `${cameras.length} ${cameras.length === 1 ? 'câmera' : 'câmeras'}`;
  const micCount =
    microphones.length === 0
      ? 'nenhum microfone'
      : `${microphones.length} ${microphones.length === 1 ? 'microfone' : 'microfones'}`;

  const layouts = [
    { mode: 'split', label: 'Lado a lado', title: 'Lado a lado — divisão 50/50 entre as duas câmeras', Icon: Columns2 },
    { mode: 'pip-camera1', label: 'PiP depoente', title: 'Picture-in-picture — câmera 1 (depoente) em destaque', Icon: PictureInPicture },
    { mode: 'pip-camera2', label: 'PiP mesa', title: 'Picture-in-picture — câmera 2 (mesa) em destaque', Icon: PictureInPicture2 },
    { mode: 'single-camera1', label: 'Câmera 1', title: 'Somente câmera 1 (depoente)', Icon: Camera },
    { mode: 'single-camera2', label: 'Câmera 2', title: 'Somente câmera 2 (mesa)', Icon: Camera },
  ] as const;

  return (
    <section
      aria-labelledby="devices-title"
      className="flex flex-col gap-4 rounded-xl border border-white/[0.07] bg-zinc-900 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="devices-title" className="text-sm font-medium text-zinc-100">
            Fontes de captura audiovisual
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            {cameraCount} · {micCount}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefreshDevices}
          disabled={isDetecting}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 text-xs text-zinc-300 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-zinc-100 disabled:opacity-50"
          title="Redetectar dispositivos USB conectados"
        >
          <RefreshCw className={`h-4 w-4 text-zinc-400 ${isDetecting ? 'animate-spin' : ''}`} />
          <span>Redetectar</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Câmera 1 */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="device-camera-1" className={labelClass}>
            <span className="text-zinc-300">Câmera 1</span>
            <span className="text-zinc-400">Depoente</span>
          </label>
          <select
            id="device-camera-1"
            value={selectedCamera1Id || ''}
            onChange={(e) => onSelectCamera1(e.target.value)}
            className={fieldClass}
          >
            {cameras.length === 0 ? (
              <option value="">Nenhuma câmera detectada</option>
            ) : (
              cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || 'Câmera primária'}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Câmera 2 */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="device-camera-2" className={labelClass}>
            <span className="text-zinc-300">Câmera 2</span>
            <span className="text-zinc-400">Mesa</span>
          </label>
          <select
            id="device-camera-2"
            value={selectedCamera2Id || ''}
            onChange={(e) => onSelectCamera2(e.target.value)}
            className={fieldClass}
          >
            {cameras.length <= 1 ? (
              <option value="">Não conectada</option>
            ) : (
              <>
                <option value="">Desativada</option>
                {cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || 'Câmera secundária'}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        {/* Microfone 1 */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="device-mic-1" className={labelClass}>
            <span className="text-zinc-300">Mic 1</span>
            <span className="text-zinc-400">Principal</span>
          </label>
          <select
            id="device-mic-1"
            value={selectedMicrophoneId || ''}
            onChange={(e) => onSelectMicrophone(e.target.value)}
            className={fieldClass}
          >
            {microphones.length === 0 ? (
              <option value="">Nenhum microfone detectado</option>
            ) : (
              microphones.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label || 'Microfone padrão'}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Microfone 2 */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="device-mic-2" className={labelClass}>
            <span className="text-zinc-300">Mic 2</span>
            <span className="text-zinc-400">Auxiliar</span>
          </label>
          <select
            id="device-mic-2"
            value={selectedMicrophone2Id || ''}
            onChange={(e) => onSelectMicrophone2 && onSelectMicrophone2(e.target.value || null)}
            className={fieldClass}
          >
            <option value="">Desativado</option>
            {microphones.map((m) => (
              <option key={`mic2-${m.deviceId}`} value={m.deviceId}>
                {m.label || 'Microfone 2'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Composição de cena */}
      <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-xs text-zinc-400">Composição de cena</span>
        <div
          role="group"
          aria-label="Composição de cena"
          className="grid grid-cols-2 gap-1.5 rounded-lg border border-white/[0.06] bg-zinc-950 p-1.5"
        >
          {layouts.map(({ mode, label, title, Icon }, index) => {
            const active = layoutMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onChangeLayout(mode as LayoutMode)}
                title={title}
                aria-pressed={active}
                className={`flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-xs transition-colors ${
                  index === layouts.length - 1 ? 'col-span-2' : ''
                } ${
                  active
                    ? 'bg-zinc-800 text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-zinc-200' : 'text-zinc-500'}`} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
