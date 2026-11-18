import React, { useState } from 'react';
import { Mic, MicOff, Volume2 } from 'lucide-react';

interface AudioVisualizerProps {
  currentLevel: number; // 0 to 1
  peakLevel: number;
  isMuted: boolean;
  gain: number;
  onToggleMute: () => void;
  onChangeGain: (gain: number) => void;
  micLabel?: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  currentLevel,
  peakLevel,
  isMuted,
  gain,
  onToggleMute,
  onChangeGain,
  micLabel,
}) => {
  const [showGainSlider, setShowGainSlider] = useState(false);

  const segmentCount = 20;
  const activeSegments = Math.round(currentLevel * segmentCount);
  const peakSegment = Math.round(peakLevel * segmentCount);
  const clipFrom = Math.floor(segmentCount * 0.85);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={isMuted ? 'Reativar microfone' : 'Silenciar microfone'}
        aria-pressed={isMuted}
        title={isMuted ? 'Reativar microfone' : 'Silenciar microfone'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
          isMuted
            ? 'bg-seal-600/15 text-seal-300'
            : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
        }`}
      >
        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>

      <div className="flex w-40 min-w-0 flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-zinc-400" title={micLabel || 'Microfone 1'}>
            {micLabel ? micLabel.replace(/\s*\(.*\)/, '') : 'Mic 1'}
          </span>
          <span className={`shrink-0 font-mono tabular-nums ${isMuted ? 'text-seal-300' : 'text-zinc-300'}`}>
            {isMuted ? 'Mudo' : `${Math.round(currentLevel * 100)}%`}
          </span>
        </div>

        <div className="flex h-2 items-center gap-[2px]" aria-hidden="true">
          {Array.from({ length: segmentCount }).map((_, idx) => {
            const isActive = !isMuted && idx <= activeSegments;
            const isPeak = !isMuted && idx === peakSegment;

            let barColor = 'bg-zinc-800';
            if (isActive || isPeak) {
              barColor = idx >= clipFrom ? 'bg-seal-500' : isPeak ? 'bg-zinc-100' : 'bg-zinc-300';
            }

            return (
              <div
                key={idx}
                className={`h-full flex-1 rounded-[1px] transition-colors ${barColor} ${
                  isPeak && !isActive ? 'opacity-70' : ''
                }`}
              />
            );
          })}
        </div>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowGainSlider(!showGainSlider)}
          aria-expanded={showGainSlider}
          aria-label={`Ganho de áudio: ${gain.toFixed(1)} vezes`}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
          title="Ganho de áudio"
        >
          <Volume2 className="h-4 w-4" />
          <span className="font-mono text-xs tabular-nums">{gain.toFixed(1)}x</span>
        </button>

        {showGainSlider && (
          <div className="absolute bottom-full right-0 z-50 mb-2 w-48 rounded-lg border border-white/[0.1] bg-zinc-900 p-3 shadow-xl shadow-black/40">
            <div className="mb-2 flex items-baseline justify-between text-xs text-zinc-300">
              <span>Ganho de áudio</span>
              <span className="font-mono tabular-nums text-zinc-100">{gain.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={gain}
              onChange={(e) => onChangeGain(parseFloat(e.target.value))}
              aria-label="Ganho de áudio"
              aria-valuetext={`${gain.toFixed(1)} vezes`}
              className="w-full cursor-pointer accent-zinc-300"
            />
            <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-zinc-400">
              <span>0.5x</span>
              <span>1.0x</span>
              <span>3.0x</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
