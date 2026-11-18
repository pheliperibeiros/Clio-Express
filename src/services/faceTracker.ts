/**
 * FaceTracker: Lightweight, real-time automated PTZ face tracking engine (similar to Zoom Center Stage).
 * Works offline with zero heavy model downloads using native FaceDetector where available,
 * and high-speed downsampled facial centroid tracking as a universal fallback.
 */

export interface TrackedCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  isTracking: boolean;
}

export class FaceTracker {
  private analysisCanvas: HTMLCanvasElement;
  private analysisCtx: CanvasRenderingContext2D | null;
  private nativeDetector: any = null;
  private lastDetectTime: number = 0;
  private detectionIntervalMs: number = 100; // detect 10 times/sec, interpolate at 60fps

  // Current interpolated crop state (normalized 0 to 1)
  private currentCenterX: number = 0.5;
  private currentCenterY: number = 0.45;
  private currentZoom: number = 1.0;

  // Target crop state
  private targetCenterX: number = 0.5;
  private targetCenterY: number = 0.45;
  private targetZoom: number = 1.0;

  private isFaceDetected: boolean = false;
  private noFaceCounter: number = 0;

  constructor() {
    this.analysisCanvas = document.createElement('canvas');
    this.analysisCanvas.width = 64;
    this.analysisCanvas.height = 36;
    this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });

    // Try initializing native FaceDetector API if available in Chromium
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        const FaceDetectorClass = (window as any).FaceDetector;
        this.nativeDetector = new FaceDetectorClass({ fastMode: true, maxDetectedFaces: 1 });
      } catch {
        this.nativeDetector = null;
      }
    }
  }

  /**
   * Updates tracking targets based on current video frame
   */
  async update(video: HTMLVideoElement | null, isEnabled: boolean): Promise<void> {
    if (!isEnabled || !video || video.readyState < 2 || video.videoWidth === 0) {
      this.targetCenterX = 0.5;
      this.targetCenterY = 0.5;
      this.targetZoom = 1.0;
      this.isFaceDetected = false;
      return;
    }

    const now = performance.now();
    if (now - this.lastDetectTime < this.detectionIntervalMs) {
      return;
    }
    this.lastDetectTime = now;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // 1. Try Native FaceDetector API
    if (this.nativeDetector) {
      try {
        const faces = await this.nativeDetector.detect(video);
        if (faces && faces.length > 0) {
          const box = faces[0].boundingBox;
          const faceCenterX = (box.x + box.width / 2) / vw;
          const faceCenterY = (box.y + box.height / 2) / vh;

          // Desired face height proportion in frame (~28% of frame for comfortable judicial portrait)
          const faceHeightRatio = box.height / vh;
          const desiredZoom = Math.min(1.7, Math.max(1.15, 0.32 / Math.max(0.12, faceHeightRatio)));

          this.targetCenterX = faceCenterX;
          // Place face slightly above vertical center (headroom rule)
          this.targetCenterY = Math.max(0.25, Math.min(0.75, faceCenterY));
          this.targetZoom = desiredZoom;
          this.isFaceDetected = true;
          this.noFaceCounter = 0;
          return;
        }
      } catch {
        // Fallback to fast pixel centroid analysis
      }
    }

    // 2. High-speed Fallback: Facial color & luminance centroid analysis
    if (!this.analysisCtx) return;

    const aw = 64;
    const ah = 36;
    try {
      this.analysisCtx.drawImage(video, 0, 0, aw, ah);
      const imgData = this.analysisCtx.getImageData(0, 0, aw, ah);
      const data = imgData.data;

      let sumX = 0;
      let sumY = 0;
      let totalSkinPixels = 0;

      // Analyze top 75% of frame (human head zone in seated deposition)
      const maxRow = Math.floor(ah * 0.75);

      for (let y = 3; y < maxRow; y++) {
        for (let x = 4; x < aw - 4; x++) {
          const idx = (y * aw + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // Normalized skin tone cluster check in RGB space
          const isSkin =
            r > 65 &&
            g > 40 &&
            b > 20 &&
            r > g &&
            r > b &&
            r - g > 12 &&
            Math.abs(r - g) > 10 &&
            r - b > 15;

          if (isSkin) {
            // Weight upper middle pixels higher
            const weight = 1 + (1 - Math.abs(x - aw / 2) / (aw / 2)) * 0.5;
            sumX += x * weight;
            sumY += y * weight;
            totalSkinPixels += weight;
          }
        }
      }

      if (totalSkinPixels > 25) {
        const centroidX = sumX / totalSkinPixels / aw;
        const centroidY = sumY / totalSkinPixels / ah;

        this.targetCenterX = Math.max(0.25, Math.min(0.75, centroidX));
        this.targetCenterY = Math.max(0.25, Math.min(0.65, centroidY));
        this.targetZoom = 1.38; // Smooth 1.38x judicial focus on speaker
        this.isFaceDetected = true;
        this.noFaceCounter = 0;
      } else {
        this.noFaceCounter++;
        // If no face detected for ~1.5s, smoothly zoom back out
        if (this.noFaceCounter > 15) {
          this.targetCenterX = 0.5;
          this.targetCenterY = 0.5;
          this.targetZoom = 1.0;
          this.isFaceDetected = false;
        }
      }
    } catch {
      // Ignored
    }
  }

  /**
   * Calculates smooth interpolated source crop rectangle for canvas drawImage
   */
  computeCrop(
    vw: number,
    vh: number,
    targetAspect: number,
    isEnabled: boolean
  ): TrackedCrop {
    if (!isEnabled) {
      // Standard static fit without zoom
      let sw = vw;
      let sh = vh;
      let sx = 0;
      let sy = 0;
      const vAspect = vw / vh;
      if (vAspect > targetAspect) {
        sw = vh * targetAspect;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / targetAspect;
        sy = (vh - sh) / 2;
      }
      return { sx, sy, sw, sh, isTracking: false };
    }

    // Smooth exponential easing (Lerp) towards target
    const lerpFactor = 0.06; // broadcast smooth pan/zoom
    this.currentCenterX += (this.targetCenterX - this.currentCenterX) * lerpFactor;
    this.currentCenterY += (this.targetCenterY - this.currentCenterY) * lerpFactor;
    this.currentZoom += (this.targetZoom - this.currentZoom) * lerpFactor;

    // Calculate crop window size based on zoom
    const zoom = Math.max(1.0, this.currentZoom);
    let baseW = vw;
    let baseH = vh;
    const vAspect = vw / vh;

    if (vAspect > targetAspect) {
      baseW = vh * targetAspect;
    } else {
      baseH = vw / targetAspect;
    }

    const sw = baseW / zoom;
    const sh = baseH / zoom;

    // Center on tracked coordinates
    const desiredPxX = this.currentCenterX * vw;
    const desiredPxY = this.currentCenterY * vh;

    // Adjust crop origin and clamp within valid bounds
    let sx = desiredPxX - sw / 2;
    let sy = desiredPxY - sh / 2;

    sx = Math.max(0, Math.min(vw - sw, sx));
    sy = Math.max(0, Math.min(vh - sh, sy));

    return {
      sx,
      sy,
      sw,
      sh,
      isTracking: this.isFaceDetected && zoom > 1.08,
    };
  }

  reset(): void {
    this.currentCenterX = 0.5;
    this.currentCenterY = 0.5;
    this.currentZoom = 1.0;
    this.targetCenterX = 0.5;
    this.targetCenterY = 0.5;
    this.targetZoom = 1.0;
    this.isFaceDetected = false;
  }
}
