import { DEFAULT_MODEL_URL } from '../options';
import type { BackgroundMode } from '../types';

export type BackgroundProcessorOptions = {
  modelUrl?: string;
  blurAmount?: number;
  /** Inference + captureStream fps (device-tier; default 30). */
  targetFps?: number;
};

type ImageSegmenter = import('@mediapipe/tasks-vision').ImageSegmenter;
type ImageSegmenterResult = import('@mediapipe/tasks-vision').ImageSegmenterResult;

type WorkerMode = 'blur' | 'remove' | 'image';

/**
 * Camera → MediaPipe selfie mask → canvas composite → captureStream.
 * Prefers a module Worker (OffscreenCanvas) when available; falls back to the
 * main-thread segmenter so older browsers and failed worker loads still work.
 *
 * MediaPipe is loaded lazily on first background effect so bare-module demos
 * can join a call without an import map until blur/remove is used.
 *
 * Re-entrancy: `start()` may be called while already running (device switch,
 * mode change). It always cancels the previous rAF loop and stops the old
 * captureStream video track first — previously each start spawned another
 * loop, so repeated calls stacked loops, fired duplicate MediaPipe
 * inferences with colliding timestamps, and leaked encoder tracks.
 */
export class BackgroundProcessor {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private outStream: MediaStream | null = null;
  private raf = 0;
  private mode: BackgroundMode = 'none';
  private bgImage: HTMLImageElement | null = null;
  private running = false;
  private blurAmount: number;
  private readonly modelUrl: string;
  private lastTs = -1;
  /** Min ms between MediaPipe frames (device-tier fps). */
  private readonly minFrameMs: number;
  private readonly targetFps: number;
  /** Bumped by stop() so a model load it interrupted can be detected. */
  private generation = 0;

  /** Main-thread MediaPipe (fallback). */
  private segmenter: ImageSegmenter | null = null;
  private segmenterReady: Promise<ImageSegmenter> | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private maskImageData: ImageData | null = null;
  private personCanvas: HTMLCanvasElement | null = null;
  private personCtx: CanvasRenderingContext2D | null = null;

  /** Worker path. */
  private worker: Worker | null = null;
  private workerReady: Promise<boolean> | null = null;
  private useWorker = false;
  private frameId = 0;
  private pendingFrame = false;

  constructor(opts: BackgroundProcessorOptions = {}) {
    this.modelUrl = opts.modelUrl ?? DEFAULT_MODEL_URL;
    this.blurAmount = opts.blurAmount ?? 12;
    const fps =
      typeof opts.targetFps === 'number' && opts.targetFps > 0
        ? Math.min(30, Math.max(5, Math.round(opts.targetFps)))
        : 30;
    this.targetFps = fps;
    this.minFrameMs = 1000 / fps;
  }

  /** Live-update blur strength (main thread + worker). */
  setBlurAmount(amount: number) {
    this.blurAmount = Math.max(1, Math.min(40, Math.round(amount)));
    this.worker?.postMessage({ type: 'set-blur', blurAmount: this.blurAmount });
  }

  private spawnWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    const name = 'background.worker.js';
    // Core bundle lives at dist/; UI bundle at dist/ui/ — try both relatives.
    const bases = [import.meta.url];
    for (const base of bases) {
      for (const rel of [`./${name}`, `../${name}`]) {
        try {
          return new Worker(new URL(rel, base), { type: 'module' });
        } catch {
          // try next candidate
        }
      }
    }
    return null;
  }

  private async ensureWorker(): Promise<boolean> {
    if (this.useWorker && this.worker) return true;
    if (this.workerReady) return this.workerReady;
    const gen = this.generation;
    this.workerReady = (async () => {
      const worker = this.spawnWorker();
      if (!worker) return false;
      const ok = await new Promise<boolean>((resolve) => {
        // Model CDN fetch can exceed a few seconds on slow links.
        const timer = setTimeout(() => resolve(false), 15_000);
        worker.onmessage = (ev: MessageEvent<{ type?: string; message?: string }>) => {
          if (ev.data?.type === 'ready') {
            // Script loaded — kick off model init; model-ready confirms it.
            worker.postMessage({
              type: 'init',
              modelUrl: this.modelUrl,
              blurAmount: this.blurAmount,
            });
          } else if (ev.data?.type === 'model-ready') {
            clearTimeout(timer);
            resolve(true);
          } else if (ev.data?.type === 'error') {
            clearTimeout(timer);
            resolve(false);
          }
        };
        worker.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
      });
      // stop()/hangup raced ahead — never adopt this worker.
      if (gen !== this.generation) {
        try {
          worker.postMessage({ type: 'close' });
        } catch {
          // ignore
        }
        worker.terminate();
        return false;
      }
      if (!ok) {
        worker.terminate();
        return false;
      }
      this.worker = worker;
      this.useWorker = true;
      worker.onmessage = (ev: MessageEvent<{ type?: string; id?: number; bitmap?: ImageBitmap }>) => {
        if (ev.data?.type === 'frame' && ev.data.bitmap && this.ctx && this.canvas) {
          this.ctx.drawImage(ev.data.bitmap, 0, 0);
          ev.data.bitmap.close();
          this.pendingFrame = false;
        } else if (
          ev.data?.type === 'frame-skip' ||
          ev.data?.type === 'error' ||
          (ev.data?.type === 'frame' && !ev.data.bitmap)
        ) {
          // Worker dropped/failed a frame — unblock the in-flight gate.
          this.pendingFrame = false;
        }
      };
      return true;
    })();
    const result = await this.workerReady;
    if (!result) this.workerReady = null;
    if (gen !== this.generation) return false;
    return result;
  }

  private async ensureSegmenter(): Promise<ImageSegmenter | null> {
    if (this.segmenter) return this.segmenter;
    const gen = this.generation;
    this.segmenterReady ??= (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
      );
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: this.modelUrl,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })();
    const pending = this.segmenterReady;
    let seg: ImageSegmenter;
    try {
      seg = await pending;
    } catch (err) {
      if (this.segmenterReady === pending) this.segmenterReady = null;
      throw err;
    }
    if (this.segmenterReady === pending) this.segmenterReady = null;
    if (this.segmenter) return this.segmenter;
    if (gen !== this.generation) {
      seg.close();
      return null;
    }
    this.segmenter = seg;
    return this.segmenter;
  }

  private workerMode(mode: BackgroundMode): WorkerMode {
    if (mode === 'blur') return 'blur';
    if (typeof mode === 'object') return 'image';
    return 'remove';
  }

  async start(source: MediaStream, mode: BackgroundMode): Promise<MediaStream> {
    const gen = this.generation;
    this.mode = mode;
    if (typeof mode === 'object' && mode.image) {
      this.bgImage = await loadImage(mode.image);
    } else {
      this.bgImage = null;
    }
    if (gen !== this.generation) {
      return new MediaStream(source.getAudioTracks());
    }

    const workerOk = await this.ensureWorker();
    if (gen !== this.generation) {
      return new MediaStream(source.getAudioTracks());
    }
    if (!workerOk) {
      const seg = await this.ensureSegmenter();
      if (gen !== this.generation || !seg) {
        return new MediaStream(source.getAudioTracks());
      }
    } else if (this.worker && this.bgImage) {
      const bmp = await createImageBitmap(this.bgImage);
      if (gen !== this.generation) {
        bmp.close();
        return new MediaStream(source.getAudioTracks());
      }
      this.worker.postMessage({ type: 'setBgImage', bitmap: bmp }, { transfer: [bmp] });
    } else if (this.worker) {
      this.worker.postMessage({ type: 'setBgImage', bitmap: null });
    }

    if (!this.video) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
    }
    this.video.srcObject = source;
    await this.video.play();
    if (gen !== this.generation) {
      return new MediaStream(source.getAudioTracks());
    }
    await waitForVideoDimensions(this.video);
    if (gen !== this.generation || !this.video) {
      return new MediaStream(source.getAudioTracks());
    }

    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    }
    this.canvas.width = w;
    this.canvas.height = h;

    if (this.outStream) {
      for (const t of this.outStream.getVideoTracks()) t.stop();
      this.outStream = null;
    }

    this.lastTs = -1;
    this.pendingFrame = false;
    this.startLoop();

    const fps = this.targetFps;
    const out = this.canvas.captureStream(fps);
    for (const t of source.getAudioTracks()) out.addTrack(t);
    this.outStream = out;
    return out;
  }

  async setMode(mode: BackgroundMode) {
    this.mode = mode;
    if (typeof mode === 'object' && mode.image) {
      this.bgImage = await loadImage(mode.image);
      if (this.worker && this.useWorker) {
        const bmp = await createImageBitmap(this.bgImage);
        this.worker.postMessage({ type: 'setBgImage', bitmap: bmp }, { transfer: [bmp] });
      }
    } else {
      this.bgImage = null;
      if (this.worker && this.useWorker) {
        this.worker.postMessage({ type: 'setBgImage', bitmap: null });
      }
    }
  }

  private startLoop() {
    this.stopLoop();
    this.running = true;
    this.raf = requestAnimationFrame(this.loop);
  }

  private stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  stop() {
    this.generation++;
    this.stopLoop();
    this.outStream?.getTracks().forEach((t) => {
      if (t.kind === 'video') t.stop();
    });
    this.outStream = null;
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'close' });
      } catch {
        // ignore
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = null;
    this.useWorker = false;
    this.segmenter?.close();
    this.segmenter = null;
    this.segmenterReady = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.maskCanvas = null;
    this.maskCtx = null;
    this.maskImageData = null;
    this.personCanvas = null;
    this.personCtx = null;
    this.bgImage = null;
  }

  private loop = () => {
    const { video, canvas } = this;
    if (!this.running || !video || !canvas || !this.ctx) return;
    const now = performance.now();
    if (now - this.lastTs < this.minFrameMs) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    if (
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0
    ) {
      this.lastTs = now;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      if (this.useWorker && this.worker) {
        if (!this.pendingFrame && this.mode !== 'none') {
          this.pendingFrame = true;
          const id = ++this.frameId;
          void createImageBitmap(video)
            .then((bitmap) => {
              if (!this.running || !this.worker || !this.useWorker) {
                bitmap.close();
                this.pendingFrame = false;
                return;
              }
              this.worker.postMessage(
                {
                  type: 'frame',
                  id,
                  bitmap,
                  mode: this.workerMode(this.mode),
                  ts: now,
                },
                { transfer: [bitmap] },
              );
            })
            .catch(() => {
              this.pendingFrame = false;
              this.ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
            });
        }
      } else if (this.segmenter) {
        try {
          this.segmenter.segmentForVideo(video, now, (result) => this.paint(result));
        } catch {
          this.ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
      } else {
        this.ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private paint(result: ImageSegmenterResult) {
    const { video, canvas, ctx } = this;
    if (!video || !canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const masks = result.confidenceMasks;
    if (!masks || !masks.length) {
      ctx.drawImage(video, 0, 0, w, h);
      return;
    }

    if (this.mode === 'blur') {
      ctx.save();
      ctx.filter = `blur(${this.blurAmount}px)`;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    } else if (typeof this.mode === 'object' && this.bgImage) {
      ctx.drawImage(this.bgImage, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#101010';
      ctx.fillRect(0, 0, w, h);
    }

    if (!this.maskCanvas) {
      this.maskCanvas = document.createElement('canvas');
      this.maskCtx = this.maskCanvas.getContext('2d');
    }
    const primary = masks[0]!;
    const mw = primary.width;
    const mh = primary.height;
    if (this.maskCanvas.width !== mw) this.maskCanvas.width = mw;
    if (this.maskCanvas.height !== mh) this.maskCanvas.height = mh;
    const maskRgba =
      this.maskImageData && this.maskImageData.width === mw && this.maskImageData.height === mh
        ? this.maskImageData
        : (this.maskImageData = this.maskCtx!.createImageData(mw, mh));
    if (masks.length === 1) {
      const ch = masks[0]!.getAsFloat32Array();
      for (let i = 0; i < ch.length; i++) {
        maskRgba.data[i * 4 + 3] = Math.min(1, Math.max(0, ch[i]!)) * 255;
      }
    } else {
      const channels = masks.map((m) => m.getAsFloat32Array());
      for (let i = 0; i < channels[0]!.length; i++) {
        let person = 0;
        for (let c = 1; c < channels.length; c++) {
          const v = channels[c]![i]!;
          if (v > person) person = v;
        }
        maskRgba.data[i * 4 + 3] = Math.min(1, Math.max(0, person)) * 255;
      }
    }
    this.maskCtx!.putImageData(maskRgba, 0, 0);

    if (!this.personCanvas) {
      this.personCanvas = document.createElement('canvas');
      this.personCtx = this.personCanvas.getContext('2d');
    }
    if (this.personCanvas.width !== w) this.personCanvas.width = w;
    if (this.personCanvas.height !== h) this.personCanvas.height = h;
    const pctx = this.personCtx!;
    pctx.globalCompositeOperation = 'source-over';
    pctx.drawImage(video, 0, 0, w, h);
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(this.maskCanvas, 0, 0, w, h);
    pctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(this.personCanvas, 0, 0);
    for (const m of masks) m.close();
  }
}

function waitForVideoDimensions(video: HTMLVideoElement, timeoutMs = 3000): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('resize', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    video.addEventListener('loadeddata', done);
    video.addEventListener('resize', done);
  });
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
