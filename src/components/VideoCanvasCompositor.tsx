import React, { useEffect, useRef } from 'react';
import { LayoutMode, OitivaMetadata } from '../types/oitiva';
import { FaceTracker } from '../services/faceTracker';
import logoUrl from '../imgs/logo.png';

interface VideoCanvasCompositorProps {
  camera1Stream: MediaStream | null;
  camera2Stream: MediaStream | null;
  layoutMode: LayoutMode;
  metadata: OitivaMetadata;
  autoFramingEnabled: boolean;
  customLogo?: string;
  onCanvasStreamReady?: (stream: MediaStream) => void;
}

export const VideoCanvasCompositor: React.FC<VideoCanvasCompositorProps> = ({
  camera1Stream,
  camera2Stream,
  layoutMode,
  metadata,
  autoFramingEnabled,
  customLogo,
  onCanvasStreamReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const video1Ref = useRef<HTMLVideoElement | null>(null);
  const video2Ref = useRef<HTMLVideoElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);

  // Dedicated Auto-Framing / Face Trackers for each video input
  const tracker1Ref = useRef<FaceTracker>(new FaceTracker());
  const tracker2Ref = useRef<FaceTracker>(new FaceTracker());

  // Institutional Logo Image Ref
  const logoImageRef = useRef<HTMLImageElement | null>(null);

  // ── Refs that mirror props so the render loop never captures stale closures ──
  const layoutModeRef = useRef<LayoutMode>(layoutMode);
  const metadataRef = useRef<OitivaMetadata>(metadata);
  const autoFramingRef = useRef<boolean>(autoFramingEnabled);

  useEffect(() => { layoutModeRef.current = layoutMode; }, [layoutMode]);
  useEffect(() => { metadataRef.current = metadata; }, [metadata]);
  useEffect(() => { autoFramingRef.current = autoFramingEnabled; }, [autoFramingEnabled]);

  // ── Logo loader ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const img = new Image();
    img.src = customLogo || logoUrl;
    img.onload = () => { logoImageRef.current = img; };
    logoImageRef.current = img;
  }, [customLogo]);

  // ── Sync Video 1 Stream ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = video1Ref.current;
    if (!el) return;
    if (camera1Stream) {
      el.srcObject = camera1Stream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [camera1Stream]);

  // ── Sync Video 2 Stream ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = video2Ref.current;
    if (!el) return;
    if (camera2Stream) {
      el.srcObject = camera2Stream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [camera2Stream]);

  // ── Setup Canvas Stream (once) ───────────────────────────────────────────────
  useEffect(() => {
    if (canvasRef.current && !compositeStreamRef.current) {
      const stream = canvasRef.current.captureStream(30);
      compositeStreamRef.current = stream;
      onCanvasStreamReady?.(stream);
    }
  }, [onCanvasStreamReady]);

  // ── Main Render Loop (mounts once, never restarts) ───────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // `desynchronized` faz o canvas ignorar a sincronização com o compositor,
    // o que provoca cintilação/tearing (especialmente visível na tarja, PiP,
    // logo e textos estáticos). Mantemos apenas `alpha: false`.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const WIDTH = 1920;
    const HEIGHT = 1080;
    const BAR_HEIGHT = 104;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    const INK = '#0a0908';
    const PAPER = '#f6f2e9';
    const MUTED = '#a8a196';

    // Pre-compute logo dimensions cache (recalculated only when logo changes)
    let logoDrawW = 60;
    let logoDrawH = 60;
    const updateLogoDimensions = (img: HTMLImageElement) => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        const aspect = img.naturalWidth / img.naturalHeight;
        const maxLogoH = 64;
        const maxLogoW = 160;
        logoDrawH = maxLogoH;
        logoDrawW = Math.round(maxLogoH * aspect);
        if (logoDrawW > maxLogoW) {
          logoDrawW = maxLogoW;
          logoDrawH = Math.round(maxLogoW / aspect);
        }
      }
    };

    // ── Timestamp cache: update once per second, not every frame ──────────────
    let cachedDateStr = '';
    let cachedTimeStr = '';
    let lastTimestampUpdate = 0;
    // IMPORTANTE: usa o relógio do sistema (Date.now), nunca o timestamp do
    // requestAnimationFrame. O argumento do rAF é o tempo desde o carregamento
    // da página, então `new Date(nowMs)` gravava 31/12/1969 no carimbo
    // probatório em vez da data e hora reais da oitiva.
    const updateTimestamp = () => {
      const nowMs = Date.now();
      if (nowMs - lastTimestampUpdate >= 1000) {
        const d = new Date(nowMs);
        cachedDateStr = d.toLocaleDateString('pt-BR');
        cachedTimeStr = d.toLocaleTimeString('pt-BR');
        lastTimestampUpdate = nowMs;
      }
    };

    // ── Lacre: fio de latão que termina no selo ───────────────────────────────
    const drawLacre = (x: number, y: number) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 84, y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(201, 162, 39, 0.85)';
      ctx.beginPath();
      ctx.arc(x + 96, y, 5.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(201, 162, 39, 0.9)';
      ctx.beginPath();
      ctx.arc(x + 96, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // ── Placeholder renderer: lâmina institucional, não grade de debug ────────
    const drawPlaceholder = (x: number, y: number, w: number, h: number, title: string, subtitle: string) => {
      ctx.fillStyle = INK;
      ctx.fillRect(x, y, w, h);

      // Marca do brasão como marca d'água discreta
      const sealR = Math.min(w, h) * 0.14;
      const cx = x + w / 2;
      const cy = y + h / 2 - Math.min(w, h) * 0.06;
      ctx.save();
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, sealR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, sealR * 0.82, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(201, 162, 39, 0.2)';
      ctx.beginPath();
      ctx.arc(cx, cy, sealR * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#8f8a82';
      ctx.font = '500 26px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(title, cx, cy + sealR + 46);

      ctx.fillStyle = '#6b665f';
      ctx.font = '400 17px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(subtitle, cx, cy + sealR + 76);
    };

    // ── Legenda discreta da câmera, acima da tarja ────────────────────────────
    const drawSceneCaption = (x: number, yTop: number, label: string) => {
      ctx.save();
      ctx.font = '500 19px "Plus Jakarta Sans", sans-serif';
      const paddingX = 14;
      const width = ctx.measureText(label).width + paddingX * 2;
      const height = 38;

      ctx.fillStyle = 'rgba(10, 9, 8, 0.62)';
      ctx.beginPath();
      ctx.roundRect(x, yTop, width, height, 6);
      ctx.fill();

      ctx.fillStyle = '#e6e0d4';
      ctx.textAlign = 'left';
      ctx.fillText(label, x + paddingX, yTop + 25);
      ctx.restore();
    };

    // ── Video renderer ────────────────────────────────────────────────────────
    const drawFittedVideo = (
      video: HTMLVideoElement | null,
      tracker: FaceTracker,
      dx: number, dy: number, dw: number, dh: number,
      placeholderTitle: string, placeholderSub: string
    ) => {
      const framing = autoFramingRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const crop = tracker.computeCrop(video.videoWidth, video.videoHeight, dw / dh, framing);
        ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, dx, dy, dw, dh);

        if (framing && crop.isTracking) {
          ctx.save();
          ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
          const label = 'Foco ativo';
          const chipW = ctx.measureText(label).width + 28;
          ctx.fillStyle = 'rgba(10, 9, 8, 0.62)';
          ctx.beginPath();
          ctx.roundRect(dx + dw - chipW - 24, dy + 24, chipW, 34, 6);
          ctx.fill();
          ctx.fillStyle = '#e6e0d4';
          ctx.textAlign = 'left';
          ctx.fillText(label, dx + dw - chipW - 10, dy + 46);
          ctx.restore();
        }
      } else {
        drawPlaceholder(dx, dy, dw, dh, placeholderTitle, placeholderSub);
      }
    };

    // ── Face tracking: runs on a separate slower interval (10fps) ────────────
    const trackingIntervalId = setInterval(() => {
      const framing = autoFramingRef.current;
      tracker1Ref.current.update(video1Ref.current, framing);
      tracker2Ref.current.update(video2Ref.current, framing);
    }, 100);

    // ── Main render function ──────────────────────────────────────────────────
    const render = () => {
      const v1 = video1Ref.current;
      const v2 = video2Ref.current;
      const layout = layoutModeRef.current;
      const meta = metadataRef.current;
      const barY = HEIGHT - BAR_HEIGHT;

      updateTimestamp();

      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // 1. Cena
      if (layout === 'split') {
        const halfW = WIDTH / 2;
        drawFittedVideo(v1, tracker1Ref.current, 0, 0, halfW - 1, HEIGHT, 'Câmera 1 · depoente', 'Aguardando sinal de entrada');
        drawFittedVideo(v2, tracker2Ref.current, halfW + 1, 0, halfW - 1, HEIGHT, 'Câmera 2 · autoridade e mesa', 'Aguardando sinal de entrada');

        ctx.fillStyle = '#24211d';
        ctx.fillRect(halfW - 1, 0, 2, HEIGHT);

        drawSceneCaption(32, barY - 62, 'Depoente');
        drawSceneCaption(halfW + 32, barY - 62, 'Autoridade e mesa');
      } else if (layout === 'pip-camera1') {
        drawFittedVideo(v1, tracker1Ref.current, 0, 0, WIDTH, HEIGHT, 'Câmera 1 · depoente', 'Sinal primário');
        const pipW = 480, pipH = 270, pipX = WIDTH - pipW - 32, pipY = barY - pipH - 32;
        ctx.fillStyle = INK;
        ctx.fillRect(pipX - 2, pipY - 2, pipW + 4, pipH + 4);
        drawFittedVideo(v2, tracker2Ref.current, pipX, pipY, pipW, pipH, 'Câmera 2', 'Secundária');
        ctx.strokeStyle = '#3a3733'; ctx.lineWidth = 1.5;
        ctx.strokeRect(pipX, pipY, pipW, pipH);
        drawSceneCaption(32, barY - 62, 'Depoente');
      } else if (layout === 'pip-camera2') {
        drawFittedVideo(v2, tracker2Ref.current, 0, 0, WIDTH, HEIGHT, 'Câmera 2 · autoridade', 'Sinal secundário');
        const pipW = 480, pipH = 270, pipX = WIDTH - pipW - 32, pipY = barY - pipH - 32;
        ctx.fillStyle = INK;
        ctx.fillRect(pipX - 2, pipY - 2, pipW + 4, pipH + 4);
        drawFittedVideo(v1, tracker1Ref.current, pipX, pipY, pipW, pipH, 'Câmera 1', 'Depoente');
        ctx.strokeStyle = '#3a3733'; ctx.lineWidth = 1.5;
        ctx.strokeRect(pipX, pipY, pipW, pipH);
        drawSceneCaption(32, barY - 62, 'Autoridade e mesa');
      } else if (layout === 'single-camera1') {
        drawFittedVideo(v1, tracker1Ref.current, 0, 0, WIDTH, HEIGHT, 'Câmera 1 · depoente', 'Modo câmera única');
        drawSceneCaption(32, barY - 62, 'Depoente');
      } else {
        drawFittedVideo(v2, tracker2Ref.current, 0, 0, WIDTH, HEIGHT, 'Câmera 2 · autoridade e mesa', 'Modo câmera única');
        drawSceneCaption(32, barY - 62, 'Autoridade e mesa');
      }

      // 2. Tarja probatória
      ctx.fillStyle = 'rgba(10, 9, 8, 0.8)';
      ctx.fillRect(0, barY, WIDTH, BAR_HEIGHT);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(0, barY, WIDTH, 1);

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 4;

      // Lacre
      drawLacre(32, barY + 20);

      // Nome e qualificação
      const nomeExibicao = meta.nomePessoa || 'Depoente não informado';
      ctx.textAlign = 'left';
      ctx.font = '600 30px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = PAPER;
      ctx.fillText(nomeExibicao, 32, barY + 58);
      const nomeWidth = ctx.measureText(nomeExibicao).width;

      if (meta.qualificacao) {
        ctx.font = '400 20px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = MUTED;
        ctx.fillText(`· ${meta.qualificacao}`, 32 + nomeWidth + 14, barY + 58);
      }

      // Autos e órgão
      const autosText = meta.numeroProcesso ? `Autos ${meta.numeroProcesso}` : 'Autos não informados';
      const orgaoText = meta.orgaoInstituicao || 'Sistema de justiça';
      ctx.font = '500 17px "JetBrains Mono", monospace';
      ctx.fillStyle = '#cfc8ba';
      ctx.fillText(autosText, 32, barY + 84);
      const autosWidth = ctx.measureText(autosText).width;

      ctx.font = '400 18px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#8f8a82';
      ctx.fillText(`  ·  ${orgaoText}`, 32 + autosWidth, barY + 84);

      // Logo
      const logoImg = logoImageRef.current;
      const hasLogo = !!logoImg && (logoImg.complete || logoImg.naturalWidth > 0);
      if (hasLogo && logoImg && logoImg.naturalWidth > 0) updateLogoDimensions(logoImg);

      const logoMarginRight = 32;
      const logoX = WIDTH - logoMarginRight - logoDrawW;
      const logoY = barY + Math.round((BAR_HEIGHT - logoDrawH) / 2);
      const textRightX = logoX - 28;

      // Data, hora e assinatura do sistema
      ctx.textAlign = 'right';
      ctx.font = '500 24px "JetBrains Mono", monospace';
      ctx.fillStyle = PAPER;
      ctx.fillText(`${cachedDateStr}  ${cachedTimeStr}`, textRightX, barY + 56);

      ctx.font = '400 14px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#8f8a82';
      ctx.fillText('Clio · registro audiovisual', textRightX, barY + 82);
      ctx.restore();

      if (hasLogo && logoImg) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(logoImg, logoX, logoY, logoDrawW, logoDrawH);
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      clearInterval(trackingIntervalId);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
    // Deps: empty — loop runs once and reads all state from refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <video ref={video1Ref} playsInline muted className="hidden" />
      <video ref={video2Ref} playsInline muted className="hidden" />
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Prévia da composição do vídeo${
          metadata.nomePessoa.trim() ? ` — ${metadata.nomePessoa.trim()}` : ''
        }. O carimbo probatório com data, hora e autos é estampado na gravação.`}
        className="h-full w-full object-contain"
      />
    </div>
  );
};
