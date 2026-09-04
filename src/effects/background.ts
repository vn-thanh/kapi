import { DEFAULT_MODEL_URL } from '../options';
import type { BackgroundMode } from '../types';

export type BackgroundProcessorOptions = {
  modelUrl?: string;
  blurAmount?: number;
};

type ImageSegmenter = import('@mediapipe/tasks-vision').ImageSegmenter;
type ImageSegmenterResult = import('@mediapipe/tasks-vision').ImageSegmenterResult;

/**
 * Camera → MediaPipe selfie mask → canvas composite → captureStream.
 * ponytail: one segmenter on the main thread; move to Worker if FPS drops.
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
  private segmenter: ImageSegmenter | null = null;
  private segmenterReady: Promise<ImageSegmenter> | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** Scratch compositing layers — the mask arrives small (e.g. 256×256) and is
   *  scaled by drawImage, so per-pixel JS compositing is unnecessary. */
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private personCanvas: HTMLCanvasElement | null = null;
  private personCtx: CanvasRenderingContext2D | null = null;
  private outStream: MediaStream | null = null;
  private raf = 0;
  private mode: BackgroundMode = 'none';
  private bgImage: HTMLImageElement | null = null;
  private running = false;
  private readonly blurAmount: number;
  private readonly modelUrl: string;
  private lastTs = -1;
  /** Bumped by stop() so a model load it interrupted can be detected. */
  private generation = 0;

  constructor(opts: BackgroundProcessorOptions = {}) {
    this.modelUrl = opts.modelUrl ?? DEFAULT_MODEL_URL;
    this.blurAmount = opts.blurAmount ?? 12;
  }

  private async ensureSegmenter(): Promise<ImageSegmenter | null> {
    if (this.segmenter) return this.segmenter;
    const gen = this.generation;
    // Dedupe concurrent starts so the wasm/model loads exactly once.
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
        // Confidence masks, not the category mask: for single-channel selfie
        // models MediaPipe emits the FOREGROUND (person) probability in
        // confidence channel 0, while the *category* mask is the inverted one
        // (person = 0, background = 255 — MediaPipe's own postprocessor maps
        // `0.5 as the cutoff, assigning 0 (foreground) or 255 (background)`,
        // segmentation_postprocessor_gl.cc / tensors_to_segmentation_calculator.cc).
        // Basing the composite on the category mask blurred the person
        // instead of the background.
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })();
    const pending = this.segmenterReady;
    let seg: ImageSegmenter;
    try {
      seg = await pending;
    } catch (err) {
      // A failed load must not poison the dedupe slot — retry next time.
      if (this.segmenterReady === pending) this.segmenterReady = null;
      throw err;
    }
    if (this.segmenterReady === pending) this.segmenterReady = null;
    if (this.segmenter) return this.segmenter; // a concurrent call adopted it
    if (gen !== this.generation) {
      // stop() ran while the model was loading — without closing here the
      // segmenter is unreachable and leaks (GPU wasm instance).
      seg.close();
      return null;
    }
    this.segmenter = seg;
    return this.segmenter;
  }

  async start(source: MediaStream, mode: BackgroundMode): Promise<MediaStream> {
    this.mode = mode;
    if (typeof mode === 'object' && mode.image) {
      this.bgImage = await loadImage(mode.image);
    } else {
      this.bgImage = null;
    }

    const seg = await this.ensureSegmenter();
    // stop() interrupted the model load — bail with audio-only.
    if (!seg) return new MediaStream(source.getAudioTracks());

    if (!this.video) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
    }
    this.video.srcObject = source;
    await this.video.play();
    await waitForVideoDimensions(this.video);

    // stop() (mode reset to 'none', hangup) can null the element while the
    // awaits above were pending — bail with audio-only instead of reading
    // videoWidth off null; the room's seq token discards the stale output.
    if (!this.video) return new MediaStream(source.getAudioTracks());

    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    }
    this.canvas.width = w;
    this.canvas.height = h;

    // Retire the previous output — its capture track would keep encoding an
    // abandoned canvas otherwise.
    if (this.outStream) {
      for (const t of this.outStream.getVideoTracks()) t.stop();
      this.outStream = null;
    }

    this.lastTs = -1;
    this.startLoop();

    const fps = 30;
    const out = this.canvas.captureStream(fps);
    for (const t of source.getAudioTracks()) out.addTrack(t);
    this.outStream = out;
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
    this.personCanvas = null;
    this.personCtx = null;
    this.bgImage = null;
  }

  private loop = () => {
    const { video, canvas, segmenter } = this;
    if (!this.running || !video || !canvas || !this.ctx || !segmenter) return;
    const now = performance.now();
    // Skip until the element has a real frame — MediaPipe GPU path throws
    // "texImage2D: no video" when width/height are still 0.
    if (
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      now !== this.lastTs
    ) {
      this.lastTs = now;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      try {
        segmenter.segmentForVideo(video, now, (result) => this.paint(result));
      } catch {
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

    // 1. Paint the replacement background.
    if (this.mode === 'blur') {
      ctx.save();
      ctx.filter = `blur(${this.blurAmount}px)`;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    } else if (typeof this.mode === 'object' && this.bgImage) {
      ctx.drawImage(this.bgImage, 0, 0, w, h);
    } else {
      // remove → neutral dark backdrop
      ctx.fillStyle = '#101010';
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Rasterize the person's confidence into an alpha channel. Channel 0
    //    holds the FOREGROUND (person) probability for single-channel selfie
    //    models; multi-channel models (multiclass selfie, deeplab) list
    //    background first, so the person is the max of the remaining
    //    channels. The float confidence doubles as soft alpha — smoother
    //    person edges than the binary category mask.
    if (!this.maskCanvas) {
      this.maskCanvas = document.createElement('canvas');
      this.maskCtx = this.maskCanvas.getContext('2d');
    }
    const primary = masks[0]!;
    const mw = primary.width;
    const mh = primary.height;
    if (this.maskCanvas.width !== mw) this.maskCanvas.width = mw;
    if (this.maskCanvas.height !== mh) this.maskCanvas.height = mh;
    const maskRgba = this.maskCtx!.createImageData(mw, mh);
    const channels = masks.map((m) => m.getAsFloat32Array());
    const singleChannel = channels.length === 1;
    for (let i = 0; i < channels[0]!.length; i++) {
      let person: number;
      if (singleChannel) {
        // Channel 0 = person (foreground) probability.
        person = channels[0]![i]!;
      } else {
        // Multiclass: background is channel 0; person = any other class.
        person = 0;
        for (let c = 1; c < channels.length; c++) {
          const v = channels[c]![i]!;
          if (v > person) person = v;
        }
      }
      maskRgba.data[i * 4 + 3] = Math.min(1, Math.max(0, person)) * 255;
    }
    this.maskCtx!.putImageData(maskRgba, 0, 0);

    // 3. Composite the person over the background via GPU-accelerated
    //    drawImage + destination-in (replaces the old full-resolution
    //    per-pixel JS merge).
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
