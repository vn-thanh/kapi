/**
 * "Who is talking" from the local microphone + remote audio streams: one
 * shared AudioContext, one AnalyserNode per peer, RMS polled on an interval.
 * ponytail: 300ms RMS with a 2-tick confirmation — fine for spotlighting;
 * a real level-meter/ASR pipeline only if this misfires in practice.
 */
export type SpeakerWatcher = {
  /** Start (or re-bind) level watching for a peer's stream. No audio track
   *  → same as forget(). Call again when the stream object is replaced. */
  watch(peerId: string, stream: MediaStream | null): void;
  forget(peerId: string): void;
  /** Resume the AudioContext after a user gesture (autoplay policy keeps it
   *  suspended — and silent — until then). */
  wake(): void;
  /** Dominant speaker changed (peerId) or no one is audible (null → keep
   *  last dominant; null is only emitted when that peer leaves). */
  onspeaking(fn: (peerId: string | null) => void): () => void;
  dispose(): void;
};

const TICK_MS = 300;
/** RMS above this counts as speaking (16-bit-ish mic RMS rarely dips below
 *  0.01 when someone actually talks into a live mic). */
const THRESHOLD = 0.02;
/** A challenger must lead this many consecutive ticks before it steals the
 *  spotlight — one cough must not flip the stage. */
const CONFIRM_TICKS = 2;

type Entry = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
};

export function createSpeakerWatcher(): SpeakerWatcher {
  let ctx: AudioContext | null = null;
  const entries = new Map<string, Entry>();
  let dominant: string | null = null;
  let candidate: string | null = null;
  let candidateTicks = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<(peerId: string | null) => void>();

  function ctxOnce(): AudioContext | null {
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch {
        return null; // no WebAudio — watcher becomes a silent no-op
      }
    }
    return ctx;
  }

  function start() {
    if (timer === null) timer = setInterval(tick, TICK_MS);
  }

  function watch(peerId: string, stream: MediaStream | null) {
    if (!stream || !stream.getAudioTracks().length) {
      forget(peerId);
      return;
    }
    const c = ctxOnce();
    if (!c) return;
    const prev = entries.get(peerId);
    if (prev && prev.stream === stream) return;
    // AudioContext suspended (no gesture yet) still accepts nodes — data
    // starts flowing after wake().
    const source = c.createMediaStreamSource(stream);
    const analyser = prev?.analyser ?? c.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    prev?.source.disconnect();
    entries.set(peerId, { stream, source, analyser, buf: new Float32Array(analyser.fftSize) });
    start();
  }

  function forget(peerId: string) {
    const prev = entries.get(peerId);
    if (!prev) return;
    prev.source.disconnect();
    entries.delete(peerId);
    if (dominant === peerId) {
      dominant = null;
      emit();
    }
    if (candidate === peerId) {
      candidate = null;
      candidateTicks = 0;
    }
  }

  function emit() {
    for (const fn of listeners) fn(dominant);
  }

  function tick() {
    if (ctx?.state !== 'running') return;
    let best: string | null = null;
    let bestRms = 0;
    for (const [id, e] of entries) {
      e.analyser.getFloatTimeDomainData(e.buf);
      let sum = 0;
      for (let i = 0; i < e.buf.length; i++) sum += e.buf[i]! * e.buf[i]!;
      const rms = Math.sqrt(sum / e.buf.length);
      if (rms > bestRms) {
        best = id;
        bestRms = rms;
      }
    }
    if (!best || bestRms < THRESHOLD) {
      // Silence: keep `dominant`, but drop a pending candidate — otherwise two
      // noise bursts separated by silence confirm like continuous speech.
      candidate = null;
      candidateTicks = 0;
      return;
    }
    if (best === dominant) {
      candidate = null;
      candidateTicks = 0;
    } else if (best === candidate) {
      if (++candidateTicks >= CONFIRM_TICKS) {
        dominant = best;
        candidate = null;
        candidateTicks = 0;
        emit();
      }
    } else {
      candidate = best;
      candidateTicks = 1;
    }
  }

  return {
    watch,
    forget,
    wake: () => {
      if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
    },
    onspeaking(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      for (const e of entries.values()) e.source.disconnect();
      entries.clear();
      listeners.clear();
      if (ctx) void ctx.close().catch(() => undefined);
      ctx = null;
    },
  };
}