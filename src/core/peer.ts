import { applyMaxBitrate, applyVideoCodecPreference } from './media';

/**
 * Camera quality rungs, high → low (all relative to capture size via
 * scaleResolutionDownBy). Rung 0 ≈ 720p-ish, 1 ≈ 360p, 2 ≈ 180p — the tier
 * sizes Zoom/Jitsi use. The effective rung per connection is the DEEPER of
 * what the link can take (stats-driven) and what the receiver's rendered
 * tile needs (video-hint) — a filmstrip thumbnail never justifies 720p.
 */
const VIDEO_RUNGS = [
  { scale: 1, bitrate: 1_500_000, framerate: 30 },
  { scale: 2, bitrate: 600_000, framerate: 24 },
  { scale: 4, bitrate: 250_000, framerate: 15 },
] as const;

/** Screen shares invert the tradeoff: full resolution for text readability,
 *  low fps because desktop content barely moves (Jitsi lowfps = 5). */
const SHARE_ENCODING = { scale: 1, bitrate: 3_000_000, framerate: 10 } as const;

/** Consecutive limited samples before stepping down a rung (~6s at 3s tick)
 *  — one bad tick must not blur the call (Zoom-grade hysteresis). */
const DOWN_TICKS = 2;
/** Consecutive clean samples before stepping back up (~24s — slower than
 *  down: quality oscillation is worse than a few seconds of softness). */
const UP_TICKS = 8;

export type PeerCallbacks = {
  onIce: (candidate: RTCIceCandidateInit) => void;
  onTrack: (track: MediaStreamTrack, streams: readonly MediaStream[]) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  /** Fired whenever signaling returns to `stable` — lets the room flush
   *  negotiations that were skipped while an offer/answer round was in flight. */
  onStable?: () => void;
};

/**
 * Why tracks are attached with `addTrack` instead of pre-created
 * `addTransceiver(..., { direction: 'sendrecv' })` + `replaceTrack`:
 *
 * The WebRTC recycling rule (and Chromium's implementation of it) only reuses
 * an existing transceiver for an m-line of an incoming OFFER when that
 * transceiver was created by `addTrack`, or by `addTransceiver` with direction
 * `recvonly`. A pre-created *sendrecv* transceiver is NOT recycled: answering
 * an offer then spawns fresh `recvonly` transceivers and the tracked senders
 * stay orphaned forever — the answer says recvonly and that side NEVER sends
 * media, even though its local tracks are attached. Symptom: whoever joined
 * first was heard by no one who joined after them (one-way media).
 *
 * Design here:
 *  - Local tracks attach via `pc.addTrack(track)` → recyclable sendrecv
 *    transceivers, correct in both offerer and answerer roles.
 *  - Kinds without a track are created lazily at OFFER time as `recvonly`
 *    (`ensureOfferKinds`) so the offer still requests remote media; the
 *    answerer gets auto-created recvonly transceivers from
 *    setRemoteDescription — both are recycled per spec.
 *  - When a track arrives later on a recvonly/inactive transceiver
 *    (screen share, device switch after joining without the device),
 *    `direction` is upgraded to `sendrecv` — a change that requires
 *    renegotiation, which callers must trigger (`replaceTrack` returns true).
 */
export class KapiPeer {
  readonly peerId: string;
  readonly pc: RTCPeerConnection;
  makingOffer = false;
  ignoreOffer = false;
  private readonly polite: boolean;
  private readonly videoCodec?: string;
  private readonly maxBitrate?: number;
  private readonly adaptive: boolean;
  /** Auto quality state: current rung (stats-driven), hysteresis counters. */
  private rungIndex = 0;
  private downTicks = 0;
  private upTicks = 0;
  /** How big our video renders on THIS receiver's screen (device px). */
  private hint: { width: number; height: number } | null = null;
  /** While screen sharing the outbound video is the screen track. */
  private sharingScreen = false;
  /** Kind → transceiver we are responsible for. Filled on track attach,
   *  offer-time creation, and whenever setRemoteDescription spawns
   *  transceivers for kinds we have no local track for. */
  private audioTransceiver: RTCRtpTransceiver | null = null;
  private videoTransceiver: RTCRtpTransceiver | null = null;
  /** ICE may arrive before setRemoteDescription — queue until ready. */
  private readonly pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    peerId: string,
    iceServers: RTCIceServer[],
    polite: boolean,
    private readonly cb: PeerCallbacks,
    opts: { videoCodec?: string; maxBitrate?: number; adaptive?: boolean } = {},
  ) {
    this.peerId = peerId;
    this.polite = polite;
    this.videoCodec = opts.videoCodec;
    this.maxBitrate = opts.maxBitrate;
    this.adaptive = opts.adaptive ?? true;
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.cb.onIce(e.candidate.toJSON());
    };
    this.pc.ontrack = (e) => this.cb.onTrack(e.track, e.streams);
    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState?.(this.pc.connectionState);
    };
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === 'stable') this.cb.onStable?.();
    };
  }

  private transceiverFor(kind: 'audio' | 'video'): RTCRtpTransceiver | null {
    return kind === 'audio' ? this.audioTransceiver : this.videoTransceiver;
  }

  private setTransceiverFor(kind: 'audio' | 'video', t: RTCRtpTransceiver) {
    if (kind === 'audio') this.audioTransceiver = t;
    else this.videoTransceiver = t;
  }

  /**
   * Attach local tracks. New transceivers are created via addTrack (recyclable
   * for a later offer/answer); existing transceivers reuse replaceTrack +
   * direction upgrade.
   * @returns true when a renegotiation is required (new m-line/direction change)
   */
  async addLocalTracks(stream: MediaStream): Promise<boolean> {
    const audio = stream.getAudioTracks()[0] ?? null;
    const video = stream.getVideoTracks()[0] ?? null;
    const [a, v] = await Promise.all([this.setTrack('audio', audio), this.setTrack('video', video)]);
    return a || v;
  }

  /**
   * Set/replace the outgoing track of a kind. Upgrades a recvonly/inactive
   * transceiver to sendrecv when a track appears.
   * @returns true when the change requires renegotiation
   */
  async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<boolean> {
    return this.setTrack(kind, track);
  }

  private async setTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<boolean> {
    let t = this.transceiverFor(kind);
    if (!t) {
      if (!track) return false;
      const sender = this.pc.addTrack(track);
      t = this.pc.getTransceivers().find((x) => x.sender === sender) ?? null;
      if (!t) return true; // very old stacks without transceiver access — renegotiate to be safe
      this.setTransceiverFor(kind, t);
      if (kind === 'video' && this.videoCodec) applyVideoCodecPreference(t, this.videoCodec);
      return true; // new m-line — must renegotiate
    }
    await t.sender.replaceTrack(track);
    if (track && (t.direction === 'recvonly' || t.direction === 'inactive')) {
      // Content swap alone (replaceTrack) needs no renogotiation, but a
      // direction change does — otherwise the new track never goes out.
      t.direction = 'sendrecv';
      return true;
    }
    return false;
  }

  /**
   * Offers must still request media for kinds we cannot send (joiner without
   * camera/mic still wants to see/hear others). Only valid on the offerer —
   * as an answerer these pre-created transceivers would not be recycled and
   * would force a recvonly answer (the one-way-media bug).
   */
  private ensureOfferKinds() {
    if (!this.audioTransceiver) {
      this.audioTransceiver = this.pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    if (!this.videoTransceiver) {
      this.videoTransceiver = this.pc.addTransceiver('video', { direction: 'recvonly' });
      if (this.videoCodec) applyVideoCodecPreference(this.videoTransceiver, this.videoCodec);
    }
  }

  /** Adopt transceivers setRemoteDescription created for kinds lacking a local
   *  track, so later replaceTrack upgrades them instead of adding m-lines. */
  private indexTransceivers() {
    for (const t of this.pc.getTransceivers()) {
      const kind = (t.receiver.track?.kind ?? t.sender.track?.kind) as 'audio' | 'video' | undefined;
      if (!kind) continue;
      if (!this.transceiverFor(kind)) this.setTransceiverFor(kind, t);
    }
  }

  // ---------- adaptive send quality ----------

  private captureWidth(): number {
    const w = this.videoTransceiver?.sender.track?.getSettings().width;
    return typeof w === 'number' && w > 0 ? w : 1280;
  }

  /** Deepest rung still sharp enough for the receiver's tile (1.5× headroom
   *  for retina and layout jitter; portrait sources keyed off width are a
   *  ponytail simplification — revisit if vertical video matters). */
  private hintRungIndex(): number {
    if (!this.hint) return 0;
    const target = Math.max(this.hint.width, this.hint.height) * 1.5;
    const w = this.captureWidth();
    for (let i = 0; i < VIDEO_RUNGS.length; i++) {
      if (w / VIDEO_RUNGS[i]!.scale <= target) return i;
    }
    return VIDEO_RUNGS.length - 1;
  }

  /**
   * Apply the effective encoding (scale / bitrate / fps) to this
   * connection's video sender. Idempotent: compares against the live
   * parameters and no-ops when nothing changed. No-op entirely when not
   * adaptive, when there is no outbound video, and (for camera rungs) while
   * screen sharing — share keeps its own full-res/low-fps profile.
   */
  async syncVideoParams(): Promise<void> {
    if (!this.adaptive) return;
    const t = this.videoTransceiver;
    if (!t?.sender.track) return;
    const base = this.sharingScreen
      ? SHARE_ENCODING
      : VIDEO_RUNGS[Math.max(this.rungIndex, this.hintRungIndex())]!;
    const maxBitrate =
      this.maxBitrate && this.maxBitrate < base.bitrate ? this.maxBitrate : base.bitrate;
    const params = t.sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const enc = params.encodings[0]!;
    if (
      enc.scaleResolutionDownBy === base.scale &&
      enc.maxBitrate === maxBitrate &&
      enc.maxFramerate === base.framerate
    ) {
      return;
    }
    enc.scaleResolutionDownBy = base.scale;
    enc.maxBitrate = maxBitrate;
    enc.maxFramerate = base.framerate;
    try {
      await t.sender.setParameters(params);
    } catch {
      /* older stack — leave browser defaults */
    }
  }

  /** Record this receiver's rendered tile size (device px) and resync. */
  setVideoHint(width: number, height: number) {
    if (!this.adaptive) return;
    const clamp = (n: number) =>
      Number.isFinite(n) ? Math.min(7680, Math.max(64, Math.round(n))) : 64;
    this.hint = { width: clamp(width), height: clamp(height) };
    void this.syncVideoParams();
  }

  /** Called by the room when a screen share starts/stops on this link. */
  setScreenSharing(on: boolean) {
    if (this.sharingScreen === on) return;
    this.sharingScreen = on;
    if (!on) {
      // Fresh start after a share: re-measure pressure instead of resuming
      // rungs earned while the screen was up.
      this.downTicks = 0;
      this.upTicks = 0;
    }
    void this.syncVideoParams();
  }

  /**
   * One quality sample (room calls on a 3s cadence): read the outbound-rtp
   * limitation reason and step the auto rung with hysteresis. Stats-less
   * and sharing links are skipped; anything the browser doesn't report
   * counts as clean, which is the pre-feature behavior.
   */
  async sampleVideoQuality(): Promise<void> {
    if (!this.adaptive || this.sharingScreen) return;
    const sender = this.videoTransceiver?.sender;
    if (!sender?.track) return;
    let limited = false;
    try {
      (await sender.getStats()).forEach((r) => {
        const rep = r as {
          type?: string;
          kind?: string;
          mediaType?: string;
          qualityLimitationReason?: string;
        };
        if (
          rep.type === 'outbound-rtp' &&
          (rep.kind === 'video' || rep.mediaType === 'video') &&
          (rep.qualityLimitationReason === 'bandwidth' ||
            rep.qualityLimitationReason === 'cpu')
        ) {
          limited = true;
        }
      });
    } catch {
      return;
    }
    if (limited) {
      this.downTicks++;
      this.upTicks = 0;
      if (this.downTicks >= DOWN_TICKS && this.rungIndex < VIDEO_RUNGS.length - 1) {
        this.rungIndex++;
        this.downTicks = 0;
      }
    } else {
      this.upTicks++;
      this.downTicks = 0;
      if (this.upTicks >= UP_TICKS && this.rungIndex > 0) {
        this.rungIndex--;
        this.upTicks = 0;
      }
    }
    await this.syncVideoParams();
  }

  async createAndSetOffer(iceRestart = false): Promise<string> {
    this.makingOffer = true;
    try {
      this.ensureOfferKinds();
      const offer = await this.pc.createOffer({ iceRestart });
      await this.pc.setLocalDescription(offer);
      if (this.adaptive) await this.syncVideoParams();
      else if (this.maxBitrate) await applyMaxBitrate(this.pc, this.maxBitrate);
      return this.pc.localDescription!.sdp;
    } finally {
      this.makingOffer = false;
    }
  }

  async handleOffer(sdp: string): Promise<string | null> {
    const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return null;

    if (offerCollision && this.pc.signalingState === 'have-local-offer') {
      // Perfect negotiation: the polite side must roll back its pending offer
      // before accepting the remote one. Without this, setRemoteDescription
      // throws InvalidStateError on browsers without implicit rollback and the
      // link silently never connects (one-way / missing media).
      try {
        await this.pc.setLocalDescription({ type: 'rollback' });
      } catch {
        // Older browsers without rollback support — continue and let
        // setRemoteDescription either implicitly roll back or throw.
      }
    }

    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    this.indexTransceivers();
    if (this.videoCodec && this.videoTransceiver) {
      applyVideoCodecPreference(this.videoTransceiver, this.videoCodec);
    }
    await this.flushIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    if (this.adaptive) await this.syncVideoParams();
    else if (this.maxBitrate) await applyMaxBitrate(this.pc, this.maxBitrate);
    return this.pc.localDescription!.sdp;
  }

  async handleAnswer(sdp: string) {
    // Never skip answers — ignoreOffer only applies to colliding *offers*.
    // Skipping the answer after glare left the impolite peer without a remote
    // description (media never connected). That regressed vs BroadcastChannel
    // demos where only one side offered.
    this.ignoreOffer = false;
    if (this.pc.signalingState === 'stable') {
      // Already settled (e.g. duplicate answer) — ignore.
      return;
    }
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    this.indexTransceivers();
    await this.flushIce();
  }

  async handleIce(candidate: RTCIceCandidateInit) {
    if (!this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!this.ignoreOffer) throw err;
    }
  }

  private async flushIce() {
    const pending = this.pendingIce.splice(0);
    for (const candidate of pending) {
      await this.handleIce(candidate);
    }
  }

  close() {
    this.pendingIce.length = 0;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.onsignalingstatechange = null;
    this.pc.close();
  }
}
