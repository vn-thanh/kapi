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
  private closed = false;
  private micEnabled = true;
  private camEnabled = true;

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
    this.listeners.get(event)?.forEach((fn) => {
      try {
        (fn as Handler<E>)(payload);
      } catch (err) {
        console.error('[kapi] listener error', err);
      }
    });
  }

  private async start() {
    this.unsubSignal = this.options.signal.onMessage((msg) => void this.onSignal(msg));

    this.rawCameraStream = await getLocalStream(this.options.media!);
    this.localStream = this.rawCameraStream;

    const bg = this.options.effects?.background ?? 'none';
    this.currentBackground = bg === undefined ? 'none' : bg;
    if (bg !== 'none') await this.setBackground(bg);

    this.emit('local-stream', { stream: this.localStream });

    if (this.options.autoJoin) {
      this.options.signal.send({
        type: 'join',
        peerId: this.options.peerId,
        displayName: this.options.displayName,
      });
    }
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
        if (state === 'failed' || state === 'closed') this.removePeer(remoteId);
      },
    });

    if (this.localStream) peer.addLocalTracks(this.localStream);
    this.peers.set(remoteId, peer);
    this.peerMeta.set(remoteId, { peerId: remoteId, displayName });
    this.emit('peer-joined', { peerId: remoteId, displayName });
    return peer;
  }

  private removePeer(remoteId: string) {
    const peer = this.peers.get(remoteId);
    if (!peer) return;
    peer.close();
    this.peers.delete(remoteId);
    this.peerMeta.delete(remoteId);
    this.emit('peer-left', { peerId: remoteId });
  }

  private async negotiate(remoteId: string) {
    const peer = await this.ensurePeer(remoteId);
    if (!peer) return;
    try {
      const sdp = await peer.createAndSetOffer(this.options.videoCodec, this.options.maxBitrate);
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

  private async onSignal(msg: SignalMessage) {
    if (this.closed) return;
    try {
      switch (msg.type) {
        case 'join':
          if (msg.peerId === this.options.peerId) return;
          await this.ensurePeer(msg.peerId, msg.displayName);
          // Both sides may offer; polite perfect-negotiation resolves glare.
          await this.negotiate(msg.peerId);
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
          const answer = await peer.handleOffer(
            msg.sdp,
            this.options.videoCodec,
            this.options.maxBitrate,
          );
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
    for (const t of this.localStream?.getVideoTracks() ?? []) t.enabled = enabled;
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
    if (enabled) {
      this.screenStream = await getDisplayStream();
      const track = this.screenStream.getVideoTracks()[0];
      if (!track) throw new Error('getDisplayMedia returned no video track');
      // Prefer quality for text/UI on shared screens
      if ('contentHint' in track) track.contentHint = 'detail';
      track.onended = () => void this.shareScreen(false);
      await this.replaceVideoTrack(track);
      // Some browsers need a re-offer after display-capture replace (esp. if
      // the peer originally had no outbound video).
      await this.renegotiateAll();
    } else {
      this.screenStream?.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      if (this.currentBackground !== 'none') {
        await this.setBackground(this.currentBackground);
      } else {
        const cam = this.rawCameraStream?.getVideoTracks()[0] ?? null;
        await this.replaceVideoTrack(cam);
      }
      await this.renegotiateAll();
    }
  }

  private async renegotiateAll() {
    for (const id of [...this.peers.keys()]) {
      await this.negotiate(id);
    }
  }

  private async replaceVideoTrack(track: MediaStreamTrack | null) {
    for (const peer of this.peers.values()) {
      await peer.replaceTrack('video', track);
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
    if (!this.rawCameraStream) return;
    this.currentBackground = mode;

    if (mode === 'none') {
      this.background?.stop();
      this.background = null;
      this.localStream = this.rawCameraStream;
      const v = this.rawCameraStream.getVideoTracks()[0] ?? null;
      if (!this.screenStream) await this.replaceVideoTrack(v);
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
    this.localStream = processed;
    if (!this.screenStream) {
      const v = processed.getVideoTracks()[0] ?? null;
      await this.replaceVideoTrack(v);
    }
    this.emit('local-stream', { stream: this.localStream });
  }

  async switchDevice(kind: 'audioinput' | 'videoinput', deviceId: string) {
    if (kind === 'audioinput') {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (!track) return;
      for (const peer of this.peers.values()) await peer.replaceTrack('audio', track);
      const target = this.rawCameraStream ?? this.localStream;
      if (target) {
        const old = target.getAudioTracks()[0];
        if (old) {
          target.removeTrack(old);
          old.stop();
        }
        target.addTrack(track);
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
    }
  }

  async hangup() {
    if (this.closed) return;
    this.closed = true;
    this.options.signal.send({ type: 'leave', peerId: this.options.peerId });
    this.unsubSignal?.();
    this.unsubSignal = null;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.background?.stop();
    this.background = null;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.rawCameraStream?.getTracks().forEach((t) => t.stop());
    if (this.localStream && this.localStream !== this.rawCameraStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    this.localStream = null;
    this.rawCameraStream = null;
    this.emit('hangup', undefined);
  }
}
