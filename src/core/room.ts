import { resolveRoomOptions } from '../options';
import type {
  BackgroundMode,
  KapiRoomOptions,
  RoomEvent,
  RoomEventMap,
  SignalMessage,
  SignalPeer,
} from '../types';
import { BackgroundProcessor } from '../effects/background';
import { getDisplayStream, getLocalStream } from './media';
import { KapiPeer } from './peer';

type Handler<E extends RoomEvent> = (payload: RoomEventMap[E]) => void;

export class KapiRoom {
  readonly options: ReturnType<typeof resolveRoomOptions>;
  private localStream: MediaStream | null = null;
  private rawCameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private readonly peers = new Map<string, KapiPeer>();
  private readonly peerMeta = new Map<string, SignalPeer>();
  private readonly listeners = new Map<RoomEvent, Set<Handler<RoomEvent>>>();
  private unsubSignal: (() => void) | null = null;
  private background: BackgroundProcessor | null = null;
  private currentBackground: BackgroundMode = 'none';
  /** Monotonic token so a slow background start can't clobber a newer one. */
  private backgroundSeq = 0;
  private closed = false;
  private micEnabled = true;
  private camEnabled = true;
  /** Serialize signal handling so ICE cannot race ahead of offer/answer. */
  private signalChain: Promise<void> = Promise.resolve();
  /** Negotiations skipped while a peer was mid-offer — flushed on `stable`. */
  private readonly pendingNegotiation = new Map<string, { iceRestart?: boolean }>();
  private readonly restartAttempts = new Map<string, number>();
  private readonly restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Bound once so start/hangup can add/remove the same unload listener. */
  private readonly onPageUnload = () => {
    // hangup()'s body is fully synchronous, so the `leave` message is queued
    // before the unload completes (fetch keepalive / BroadcastChannel /
    // WebSocket all flush from a pagehide handler).
    void this.hangup();
  };
  /** Transient drops (Wi-Fi roam, slow TURN) get this many ICE-restart tries
   *  before the link is torn down. */
  private static readonly MAX_ICE_RESTARTS = 3;

  private constructor(opts: KapiRoomOptions) {
    this.options = resolveRoomOptions(opts);
  }

  static async join(opts: KapiRoomOptions): Promise<KapiRoom> {
    const room = new KapiRoom(opts);
    await room.start();
    return room;
  }

  get peerId() {
    return this.options.peerId;
  }

  get localMedia(): MediaStream | null {
    return this.localStream;
  }

  get participants(): SignalPeer[] {
    return [
      { peerId: this.options.peerId, displayName: this.options.displayName },
      ...this.peerMeta.values(),
    ];
  }

  on<E extends RoomEvent>(event: E, handler: Handler<E>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler as Handler<RoomEvent>);
    return () => this.listeners.get(event)?.delete(handler as Handler<RoomEvent>);
  }

  private emit<E extends RoomEvent>(event: E, payload: RoomEventMap[E]) {
    // Snapshot: a handler that unsubscribes itself must not skip the next one.
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const fn of [...handlers]) {
      try {
        (fn as Handler<E>)(payload);
      } catch (err) {
        console.error('[kapi] listener error', err);
      }
    }
  }

  private async start() {
    // F5 / tab close / navigation: notify the room immediately instead of
    // leaving remote peers to discover the drop via slow ICE timeouts.
    // pagehide = modern + mobile-safe; beforeunload = legacy fallback
    // (hangup is idempotent, so firing both is harmless).
    if (this.options.leaveOnUnload && typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageUnload);
      window.addEventListener('beforeunload', this.onPageUnload);
    }

    this.unsubSignal = this.options.signal.onMessage((msg) => {
      this.signalChain = this.signalChain
        .then(() => this.onSignal(msg))
        .catch((err) => {
          this.emit('error', { error: err instanceof Error ? err : new Error(String(err)) });
        });
    });

    this.rawCameraStream = await getLocalStream(this.options.media!);
    this.localStream = this.rawCameraStream;
    this.applyCamState();

    const bg = this.options.effects?.background ?? 'none';
    this.currentBackground = bg === undefined ? 'none' : bg;
    if (bg !== 'none') await this.setBackground(bg);

    this.emit('local-stream', { stream: this.localStream });

    // Defer announce so callers can attach listeners after `await KapiRoom.join()`
    // (or mount's `.then`) before `peers` arrives — otherwise peer-joined is missed
    // when signaling delivers the roster synchronously.
    if (this.options.autoJoin) {
      setTimeout(() => {
        if (this.closed) return;
        this.announce();
      }, 0);
    }
  }

  /** Send room join (roster / presence). Safe to call once after wiring events. */
  announce() {
    if (this.closed) return;
    this.options.signal.send({
      type: 'join',
      peerId: this.options.peerId,
      displayName: this.options.displayName,
    });
  }

  private isPoliteToward(remoteId: string): boolean {
    if (!this.options.polite) return false;
    return this.options.peerId < remoteId;
  }

  private async ensurePeer(remoteId: string, displayName?: string): Promise<KapiPeer | null> {
    if (remoteId === this.options.peerId) return null;
    let peer = this.peers.get(remoteId);
    if (peer) {
      if (displayName) this.peerMeta.set(remoteId, { peerId: remoteId, displayName });
      return peer;
    }

    if (this.peers.size >= (this.options.maxPeers ?? 6)) {
      this.emit('error', {
        error: new Error(`maxPeers (${this.options.maxPeers}) reached`),
      });
      return null;
    }

    peer = new KapiPeer(remoteId, this.options.iceServers!, this.isPoliteToward(remoteId), {
      onIce: (candidate) =>
        this.options.signal.send({
          type: 'ice',
          candidate,
          to: remoteId,
          from: this.options.peerId,
        }),
      onTrack: (track, streams) =>
        this.emit('track', { peerId: remoteId, track, streams }),
      onConnectionState: (state) => {
        this.emit('peer-state', { peerId: remoteId, state });
        if (state === 'connected') {
          this.restartAttempts.delete(remoteId);
          this.clearRestartTimer(remoteId);
        } else if (state === 'disconnected') {
          // Often transient — wait briefly, restart ICE if it does not recover.
          this.clearRestartTimer(remoteId);
          const timer = setTimeout(() => {
            this.restartTimers.delete(remoteId);
            const cur = this.peers.get(remoteId);
            if (
              cur &&
              (cur.pc.connectionState === 'disconnected' ||
                cur.pc.connectionState === 'failed')
            ) {
              void this.restartIce(remoteId);
            }
          }, 2500);
          this.restartTimers.set(remoteId, timer);
        } else if (state === 'failed') {
          // Do not tear down on first failure — previously a single hiccup
          // permanently killed the link (remote kept a frozen tile, this side
          // lost the peer entirely). Try ICE restart first.
          void this.restartIce(remoteId);
        } else if (state === 'closed') {
          this.removePeer(remoteId);
        }
      },
      onStable: () => {
        const pending = this.pendingNegotiation.get(remoteId);
        if (!pending) return;
        this.pendingNegotiation.delete(remoteId);
        void this.negotiate(remoteId, pending.iceRestart);
      },
    }, {
      videoCodec: this.options.videoCodec,
      maxBitrate: this.options.maxBitrate,
    });

    if (this.localStream) await peer.addLocalTracks(this.localStream);
    this.peers.set(remoteId, peer);
    this.peerMeta.set(remoteId, { peerId: remoteId, displayName });
    this.emit('peer-joined', { peerId: remoteId, displayName });
    // Late joiners must learn about an in-progress screen share — they never
    // saw the original broadcast (targeted so relays route it to them only).
    if (this.screenStream) {
      this.options.signal.send({
        type: 'media-state',
        peerId: this.options.peerId,
        sharing: true,
        to: remoteId,
      });
    }
    return peer;
  }

  private removePeer(remoteId: string) {
    const peer = this.peers.get(remoteId);
    if (!peer) return;
    this.clearRestartTimer(remoteId);
    this.restartAttempts.delete(remoteId);
    this.pendingNegotiation.delete(remoteId);
    peer.close();
    this.peers.delete(remoteId);
    this.peerMeta.delete(remoteId);
    this.emit('peer-left', { peerId: remoteId });
  }

  private clearRestartTimer(remoteId: string) {
    const timer = this.restartTimers.get(remoteId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.restartTimers.delete(remoteId);
    }
  }

  /**
   * Offer to a peer. Pass iceRestart to recover a broken link.
   * If the peer is mid-offer, the negotiation is queued and flushed when
   * signaling returns to `stable` (previously such offers were silently
   * dropped, which lost screen-share / ICE-restart renegotiations).
   */
  private async negotiate(remoteId: string, iceRestart = false) {
    const peer = this.peers.get(remoteId);
    if (!peer || this.closed) return;
    if (peer.makingOffer || peer.pc.signalingState !== 'stable') {
      const prev = this.pendingNegotiation.get(remoteId);
      this.pendingNegotiation.set(remoteId, { iceRestart: prev?.iceRestart || iceRestart });
      return;
    }
    try {
      const sdp = await peer.createAndSetOffer(iceRestart);
      if (this.closed || !this.peers.has(remoteId)) return;
      this.options.signal.send({
        type: 'offer',
        sdp,
        to: remoteId,
        from: this.options.peerId,
      });
    } catch (err) {
      this.emit('error', { error: err instanceof Error ? err : new Error(String(err)) });
    }
  }

  private async restartIce(remoteId: string) {
    const peer = this.peers.get(remoteId);
    if (!peer || this.closed) return;
    const attempts = (this.restartAttempts.get(remoteId) ?? 0) + 1;
    if (attempts > KapiRoom.MAX_ICE_RESTARTS) {
      this.emit('error', {
        error: new Error(
          `Connection to ${remoteId} failed — often NAT/firewall; configure a TURN server in iceServers`,
        ),
      });
      this.removePeer(remoteId);
      return;
    }
    this.restartAttempts.set(remoteId, attempts);
    // Both sides may restart at once — perfect negotiation resolves the glare.
    await this.negotiate(remoteId, true);
  }

  private async onSignal(msg: SignalMessage) {
    if (this.closed) return;
    try {
      switch (msg.type) {
        case 'join':
          if (msg.peerId === this.options.peerId) return;
          // A join from an id we already have means the remote instance
          // restarted (F5/crash) and its `leave` never reached us — tear down
          // the stale link first so the fresh offer lands on a clean
          // RTCPeerConnection instead of a zombie one (which could also be
          // mid-ICE-restart with a pending local offer → glare / ignored offer).
          if (this.peers.has(msg.peerId)) this.removePeer(msg.peerId);
          // Presence only — the joiner receives `peers` and offers to us (avoids
          // glare when 3+ peers join a mesh). Host relay must send `peers`.
          await this.ensurePeer(msg.peerId, msg.displayName);
          break;
        case 'leave':
          this.removePeer(msg.peerId);
          break;
        case 'peers':
          for (const p of msg.peers) {
            if (p.peerId === this.options.peerId) continue;
            await this.ensurePeer(p.peerId, p.displayName);
            await this.negotiate(p.peerId);
          }
          break;
        case 'offer': {
          const from = msg.from;
          if (!from || msg.to !== this.options.peerId) return;
          const peer = await this.ensurePeer(from);
          if (!peer) return;
          const answer = await peer.handleOffer(msg.sdp);
          if (answer) {
            this.options.signal.send({
              type: 'answer',
              sdp: answer,
              to: from,
              from: this.options.peerId,
            });
          }
          break;
        }
        case 'answer': {
          const from = msg.from;
          if (!from || msg.to !== this.options.peerId) return;
          const peer = this.peers.get(from);
          if (peer) await peer.handleAnswer(msg.sdp);
          break;
        }
        case 'ice': {
          const from = msg.from;
          if (!from || msg.to !== this.options.peerId) return;
          const peer = this.peers.get(from);
          if (peer) await peer.handleIce(msg.candidate);
          break;
        }
        case 'reaction': {
          // Cosmetic broadcast — never let a malformed one throw into the
          // signaling chain.
          const emoji = typeof msg.emoji === 'string' ? msg.emoji.trim() : '';
          if (!emoji || emoji.length > 24) return;
          this.emit('reaction', { peerId: msg.from ?? '', emoji });
          break;
        }
        case 'media-state': {
          // Cosmetic hint for remote UIs (stage layout for the sharer) —
          // malformed ones are ignored like reactions.
          if (typeof msg.peerId !== 'string' || typeof msg.sharing !== 'boolean') return;
          if (msg.peerId === this.options.peerId) return;
          this.emit('media-state', { peerId: msg.peerId, sharing: msg.sharing });
          break;
        }
      }
    } catch (err) {
      this.emit('error', { error: err instanceof Error ? err : new Error(String(err)) });
    }
  }

  setMic(enabled: boolean) {
    this.micEnabled = enabled;
    for (const t of this.localStream?.getAudioTracks() ?? []) t.enabled = enabled;
    for (const t of this.rawCameraStream?.getAudioTracks() ?? []) t.enabled = enabled;
  }

  setCam(enabled: boolean) {
    this.camEnabled = enabled;
    this.applyCamState();
  }

  /**
   * Toggle camera-origin video tracks only. While screen sharing the sent
   * video is the screen track and must NOT be touched — previously toggling
   * the camera also froze the shared screen because localStream carried it.
   */
  private applyCamState() {
    if (this.screenStream) return;
    const seen = new Set<MediaStreamTrack>();
    for (const t of this.localStream?.getVideoTracks() ?? []) {
      t.enabled = this.camEnabled;
      seen.add(t);
    }
    for (const t of this.rawCameraStream?.getVideoTracks() ?? []) {
      if (!seen.has(t)) t.enabled = this.camEnabled;
    }
  }

  get micOn() {
    return this.micEnabled;
  }

  get camOn() {
    return this.camEnabled;
  }

  get sharing() {
    return !!this.screenStream;
  }

  async shareScreen(enabled: boolean) {
    if (this.closed) return;
    if (enabled) {
      const stream = await getDisplayStream();
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('getDisplayMedia returned no video track');
      }
      // Prefer quality for text/UI on shared screens
      if ('contentHint' in track) track.contentHint = 'detail';
      this.screenStream = stream;
      track.onended = () => void this.shareScreen(false);
      try {
        await this.replaceVideoTrack(track);
      } catch (err) {
        // Never straddle "sharing in state, camera on the wire" — roll back.
        track.onended = null;
        this.screenStream = null;
        stream.getTracks().forEach((t) => t.stop());
        await this.restoreCameraTrack();
        throw err;
      }
      // Announce only after the swap actually succeeded — remote tiles should
      // promote to stage view exactly when the screen track starts flowing.
      this.broadcastMediaState(true);
      return;
    }

    const stream = this.screenStream;
    if (!stream) return;
    this.screenStream = null;
    for (const t of stream.getTracks()) {
      t.onended = null;
      t.stop();
    }
    await this.restoreCameraTrack();
    this.broadcastMediaState(false);
  }

  /** Broadcast screen-share state (and fire `media-state` locally) so remote
   *  UIs can give the sharer's tile stage placement / uncropped fit. Cosmetic:
   *  relays that drop unknown message types only lose the layout hint. */
  private broadcastMediaState(sharing: boolean) {
    if (this.closed) return;
    this.options.signal.send({
      type: 'media-state',
      peerId: this.options.peerId,
      sharing,
    });
    this.emit('media-state', { peerId: this.options.peerId, sharing });
  }

  private async restoreCameraTrack() {
    if (this.closed) return;
    if (this.currentBackground !== 'none') {
      await this.setBackground(this.currentBackground);
    } else {
      const cam = this.rawCameraStream?.getVideoTracks()[0] ?? null;
      await this.replaceVideoTrack(cam);
      // camera reacquisition ends the share path; cam toggle applies again
      this.applyCamState();
    }
  }

  private async replaceVideoTrack(track: MediaStreamTrack | null) {
    for (const [id, peer] of this.peers) {
      // Renegotiate when the transceiver direction/m-line changed (e.g. a
      // peer that had no outbound video starts screen sharing).
      if (await peer.replaceTrack('video', track)) await this.negotiate(id);
    }
    // Keep local preview on a dedicated stream so we never mutate the camera /
    // canvas stream that peers may still reference after stopping share.
    if (track) {
      const preview = new MediaStream([
        track,
        ...(this.localStream?.getAudioTracks() ??
          this.rawCameraStream?.getAudioTracks() ??
          []),
      ]);
      this.localStream = preview;
      this.emit('local-stream', { stream: preview });
    } else {
      this.localStream = this.rawCameraStream;
      if (this.rawCameraStream) this.emit('local-stream', { stream: this.rawCameraStream });
    }
  }

  async setBackground(mode: BackgroundMode) {
    if (!this.rawCameraStream || this.closed) return;
    const seq = ++this.backgroundSeq;
    this.currentBackground = mode;

    if (mode === 'none') {
      this.background?.stop();
      this.background = null;
      this.localStream = this.rawCameraStream;
      const v = this.rawCameraStream.getVideoTracks()[0] ?? null;
      if (!this.screenStream) await this.replaceVideoTrack(v);
      this.applyCamState();
      this.emit('local-stream', { stream: this.localStream });
      return;
    }

    // ponytail: single main-thread segmenter; upgrade to worker if CPU-bound
    if (!this.background) {
      this.background = new BackgroundProcessor({
        modelUrl: this.options.effects?.modelUrl,
        blurAmount: this.options.effects?.blurAmount,
      });
    }
    const processed = await this.background.start(this.rawCameraStream, mode);
    // A newer setBackground/hangup superseded this start — drop its output.
    if (seq !== this.backgroundSeq || this.closed) {
      processed.getTracks().forEach((t) => {
        if (t.kind === 'video') t.stop();
      });
      return;
    }
    this.localStream = processed;
    if (!this.screenStream) {
      const v = processed.getVideoTracks()[0] ?? null;
      await this.replaceVideoTrack(v);
    }
    this.applyCamState();
    this.emit('local-stream', { stream: this.localStream });
  }

  /**
   * Broadcast an emoji reaction (Jitsi-style floating emojis). Also fires the
   * `reaction` event locally with this room's peerId, so consumers render
   * local + remote reactions from a single event stream. Invalid input is
   * ignored rather than thrown — reactions are cosmetic.
   */
  sendReaction(emoji: string) {
    if (this.closed) return;
    const clean = typeof emoji === 'string' ? emoji.trim() : '';
    if (!clean || clean.length > 24) return;
    this.options.signal.send({
      type: 'reaction',
      emoji: clean,
      from: this.options.peerId,
    });
    this.emit('reaction', { peerId: this.options.peerId, emoji: clean });
  }

  async switchDevice(kind: 'audioinput' | 'videoinput', deviceId: string) {
    if (this.closed) return;
    if (kind === 'audioinput') {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (!track) return;
      for (const [id, peer] of this.peers) {
        if (await peer.replaceTrack('audio', track)) await this.negotiate(id);
      }
      // Swap the mic track in every stream that exposes it — raw camera plus
      // the current localStream, which may be the background-processed canvas
      // stream or the screen-share preview (both carry audio tracks of their
      // own; the old track was previously left in them, stopped).
      const targets = new Set<MediaStream>(
        [this.rawCameraStream, this.localStream].filter((s): s is MediaStream => !!s),
      );
      for (const target of targets) {
        for (const old of target.getAudioTracks()) {
          if (old === track) continue;
          target.removeTrack(old);
          old.stop();
        }
        if (!target.getAudioTracks().includes(track)) target.addTrack(track);
      }
      track.enabled = this.micEnabled;
      if (this.localStream) this.emit('local-stream', { stream: this.localStream });
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    // Respect the camera toggle — a fresh track defaults to enabled=true and
    // would silently turn the camera back on while the UI shows it off.
    track.enabled = this.camEnabled;
    if (this.rawCameraStream) {
      const old = this.rawCameraStream.getVideoTracks()[0];
      if (old) {
        this.rawCameraStream.removeTrack(old);
        old.stop();
      }
      this.rawCameraStream.addTrack(track);
    }
    if (this.currentBackground !== 'none') {
      await this.setBackground(this.currentBackground);
    } else if (!this.screenStream) {
      this.localStream = this.rawCameraStream;
      await this.replaceVideoTrack(track);
      this.applyCamState();
    }
  }

  async hangup() {
    if (this.closed) return;
    this.closed = true;
    this.backgroundSeq++;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageUnload);
      window.removeEventListener('beforeunload', this.onPageUnload);
    }
    this.options.signal.send({ type: 'leave', peerId: this.options.peerId });
    this.unsubSignal?.();
    this.unsubSignal = null;
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
    this.pendingNegotiation.clear();
    this.restartAttempts.clear();
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.background?.stop();
    this.background = null;
    // Detach onended before stopping: otherwise stopping the screen track
    // fires shareScreen(false) re-entry on an already-closing room.
    if (this.screenStream) {
      for (const t of this.screenStream.getTracks()) {
        t.onended = null;
        t.stop();
      }
      this.screenStream = null;
    }
    this.rawCameraStream?.getTracks().forEach((t) => t.stop());
    if (this.localStream && this.localStream !== this.rawCameraStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    this.localStream = null;
    this.rawCameraStream = null;
    this.emit('hangup', undefined);
  }
}
