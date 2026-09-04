import { FilesetResolver, ImageSegmenter, type ImageSegmenterResult } from '@mediapipe/tasks-vision';
import { DEFAULT_MODEL_URL } from '../options';
import type { BackgroundMode } from '../types';

export type BackgroundProcessorOptions = {
  modelUrl?: string;
  blurAmount?: number;
};

/**
 * Camera → MediaPipe selfie mask → canvas composite → captureStream.
 * ponytail: one segmenter on the main thread; move to Worker if FPS drops.
 */
export class BackgroundProcessor {
  private segmenter: ImageSegmenter | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private mode: BackgroundMode = 'none';
  private bgImage: HTMLImageElement | null = null;
  private running = false;
  private readonly blurAmount: number;
  private readonly modelUrl: string;
  private lastTs = -1;

  constructor(opts: BackgroundProcessorOptions = {}) {
    this.modelUrl = opts.modelUrl ?? DEFAULT_MODEL_URL;
    this.blurAmount = opts.blurAmount ?? 12;
  }

  async start(source: MediaStream, mode: BackgroundMode): Promise<MediaStream> {
    this.mode = mode;
    if (typeof mode === 'object' && mode.image) {
      this.bgImage = await loadImage(mode.image);
    } else {
      this.bgImage = null;
    }

    if (!this.segmenter) {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
      );
      this.segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: this.modelUrl,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    }

    if (!this.video) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
    }
    this.video.srcObject = source;
    await this.video.play();

    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    this.canvas.width = w;
    this.canvas.height = h;

    this.running = true;
    this.loop();

    const fps = 30;
    const out = this.canvas.captureStream(fps);
    const audio = source.getAudioTracks();
    for (const t of audio) out.addTrack(t);
    return out;
  }

  async setMode(mode: BackgroundMode) {
    this.mode = mode;
    if (typeof mode === 'object' && mode.image) {
      this.bgImage = await loadImage(mode.image);
    } else {
      this.bgImage = null;
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.segmenter?.close();
    this.segmenter = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.bgImage = null;
  }

  private loop = () => {
    if (!this.running || !this.video || !this.canvas || !this.ctx || !this.segmenter) return;
    const now = performance.now();
    if (this.video.readyState >= 2 && now !== this.lastTs) {
      this.lastTs = now;
      try {
        this.segmenter.segmentForVideo(this.video, now, (result) => this.paint(result));
      } catch {
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private paint(result: ImageSegmenterResult) {
    if (!this.video || !this.canvas || !this.ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const mask = result.categoryMask;
    if (!mask) {
      this.ctx.drawImage(this.video, 0, 0, w, h);
      return;
    }

    this.ctx.drawImage(this.video, 0, 0, w, h);
    const frame = this.ctx.getImageData(0, 0, w, h);
    const data = frame.data;
    const maskData = mask.getAsUint8Array();

    // Prepare background layer
    const bg = this.ctx.createImageData(w, h);
    if (this.mode === 'blur') {
      this.ctx.filter = `blur(${this.blurAmount}px)`;
      this.ctx.drawImage(this.video, 0, 0, w, h);
      this.ctx.filter = 'none';
      const blurred = this.ctx.getImageData(0, 0, w, h);
      bg.data.set(blurred.data);
      this.ctx.putImageData(frame, 0, 0);
    } else if (typeof this.mode === 'object' && this.bgImage) {
      this.ctx.drawImage(this.bgImage, 0, 0, w, h);
      const img = this.ctx.getImageData(0, 0, w, h);
      bg.data.set(img.data);
      this.ctx.putImageData(frame, 0, 0);
    } else {
      // remove → solid dark green-screen-ish neutral
      for (let i = 0; i < bg.data.length; i += 4) {
        bg.data[i] = 16;
        bg.data[i + 1] = 16;
        bg.data[i + 2] = 16;
        bg.data[i + 3] = 255;
      }
    }

    const out = this.ctx.createImageData(w, h);
    const mw = mask.width;
    const mh = mask.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const mx = Math.min(mw - 1, Math.floor((x / w) * mw));
        const my = Math.min(mh - 1, Math.floor((y / h) * mh));
        // selfie_segmenter: 0 = person (category) in some builds; confidence-like in others
        const m = maskData[my * mw + mx] ?? 0;
        const person = m > 0;
        if (person) {
          out.data[i] = data[i]!;
          out.data[i + 1] = data[i + 1]!;
          out.data[i + 2] = data[i + 2]!;
          out.data[i + 3] = 255;
        } else {
          out.data[i] = bg.data[i]!;
          out.data[i + 1] = bg.data[i + 1]!;
          out.data[i + 2] = bg.data[i + 2]!;
          out.data[i + 3] = 255;
        }
      }
    }
    this.ctx.putImageData(out, 0, 0);
    mask.close();
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load background image: ${url}`));
    img.src = url;
  });
}
