/**
 * MediaPipe selfie segmentation + compositing off the main thread.
 * Speaks a small message protocol with BackgroundProcessor (see background.ts).
 */

type Mode = 'blur' | 'remove' | 'image';

type InMsg =
  | { type: 'init'; modelUrl: string; blurAmount: number }
  | { type: 'set-blur'; blurAmount: number }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; mode: Mode; ts: number }
  | { type: 'setBgImage'; bitmap: ImageBitmap | null }
  | { type: 'close' };

type ImageSegmenter = import('@mediapipe/tasks-vision').ImageSegmenter;
type ImageSegmenterResult = import('@mediapipe/tasks-vision').ImageSegmenterResult;

let segmenter: ImageSegmenter | null = null;
let blurAmount = 12;
let bgImage: ImageBitmap | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let maskCanvas: OffscreenCanvas | null = null;
let maskCtx: OffscreenCanvasRenderingContext2D | null = null;
let maskImageData: ImageData | null = null;
let personCanvas: OffscreenCanvas | null = null;
let personCtx: OffscreenCanvasRenderingContext2D | null = null;
let busy = false;

self.postMessage({ type: 'ready' });

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  void handle(msg).catch((err) => {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  });
};

async function handle(msg: InMsg) {
  switch (msg.type) {
    case 'init':
      blurAmount = msg.blurAmount;
      await ensureSegmenter(msg.modelUrl);
      self.postMessage({ type: 'model-ready' });
      break;
    case 'set-blur':
      blurAmount = msg.blurAmount;
      break;
    case 'setBgImage':
      bgImage?.close();
      bgImage = msg.bitmap;
      break;
    case 'frame':
      if (busy || !segmenter) {
        msg.bitmap.close();
        // Always ack so the main thread clears pendingFrame.
        self.postMessage({ type: 'frame-skip', id: msg.id });
        return;
      }
      busy = true;
      try {
        const out = await processFrame(msg.bitmap, msg.mode, msg.ts);
        msg.bitmap.close();
        if (out) {
          self.postMessage({ type: 'frame', id: msg.id, bitmap: out }, { transfer: [out] });
        } else {
          self.postMessage({ type: 'frame-skip', id: msg.id });
        }
      } finally {
        busy = false;
      }
      break;
    case 'close':
      teardown();
      break;
  }
}

async function ensureSegmenter(modelUrl: string) {
  if (segmenter) return;
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
  );
  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelUrl,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
}

function teardown() {
  segmenter?.close();
  segmenter = null;
  bgImage?.close();
  bgImage = null;
  canvas = null;
  ctx = null;
  maskCanvas = null;
  maskCtx = null;
  maskImageData = null;
  personCanvas = null;
  personCtx = null;
}

function processFrame(
  bitmap: ImageBitmap,
  mode: Mode,
  ts: number,
): Promise<ImageBitmap | null> {
  const w = bitmap.width;
  const h = bitmap.height;
  if (!w || !h || !segmenter) return Promise.resolve(null);

  if (!canvas) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext('2d', { willReadFrequently: false });
  }
  if (!ctx) return Promise.resolve(null);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  return new Promise((resolve) => {
    try {
      segmenter!.segmentForVideo(bitmap, ts, (result) => {
        try {
          paint(result, bitmap, mode, w, h);
          resolve(canvas!.transferToImageBitmap());
        } catch {
          ctx!.drawImage(bitmap, 0, 0, w, h);
          resolve(canvas!.transferToImageBitmap());
        }
      });
    } catch {
      ctx!.drawImage(bitmap, 0, 0, w, h);
      resolve(canvas!.transferToImageBitmap());
    }
  });
}

function paint(
  result: ImageSegmenterResult,
  bitmap: ImageBitmap,
  mode: Mode,
  w: number,
  h: number,
) {
  if (!ctx || !canvas) return;
  const masks = result.confidenceMasks;
  if (!masks || !masks.length) {
    ctx.drawImage(bitmap, 0, 0, w, h);
    return;
  }

  if (mode === 'blur') {
    ctx.save();
    ctx.filter = `blur(${blurAmount}px)`;
    ctx.drawImage(bitmap, 0, 0, w, h);
    ctx.restore();
  } else if (mode === 'image' && bgImage) {
    ctx.drawImage(bgImage, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#101010';
    ctx.fillRect(0, 0, w, h);
  }

  if (!maskCanvas) {
    maskCanvas = new OffscreenCanvas(1, 1);
    maskCtx = maskCanvas.getContext('2d');
  }
  const primary = masks[0]!;
  const mw = primary.width;
  const mh = primary.height;
  if (maskCanvas!.width !== mw) maskCanvas!.width = mw;
  if (maskCanvas!.height !== mh) maskCanvas!.height = mh;
  const maskRgba =
    maskImageData && maskImageData.width === mw && maskImageData.height === mh
      ? maskImageData
      : (maskImageData = maskCtx!.createImageData(mw, mh));
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
  maskCtx!.putImageData(maskRgba, 0, 0);

  if (!personCanvas) {
    personCanvas = new OffscreenCanvas(w, h);
    personCtx = personCanvas.getContext('2d');
  }
  if (personCanvas!.width !== w) personCanvas!.width = w;
  if (personCanvas!.height !== h) personCanvas!.height = h;
  const pctx = personCtx!;
  pctx.globalCompositeOperation = 'source-over';
  pctx.drawImage(bitmap, 0, 0, w, h);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(maskCanvas!, 0, 0, w, h);
  pctx.globalCompositeOperation = 'source-over';

  ctx.drawImage(personCanvas!, 0, 0);
  for (const m of masks) m.close();
}
