import { applyMaxBitrate, applyVideoCodecPreference } from './media';

export type PeerCallbacks = {
  onIce: (candidate: RTCIceCandidateInit) => void;
  onTrack: (track: MediaStreamTrack, streams: readonly MediaStream[]) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  /** Fired whenever signaling returns to `stable` — lets the room flush
   *  negotiations that were skipped while an offer/answer round was in flight. */
  onStable?: () => void;
};

export class KapiPeer {
  readonly peerId: string;
  readonly pc: RTCPeerConnection;
  makingOffer = false;
  ignoreOffer = false;
  private readonly polite: boolean;
  private readonly audioSender: RTCRtpSender;
  private readonly videoSender: RTCRtpSender;
  /** ICE may arrive before setRemoteDescription — queue until ready. */
  private readonly pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    peerId: string,
    iceServers: RTCIceServer[],
    polite: boolean,
    private readonly cb: PeerCallbacks,
  ) {
    this.peerId = peerId;
    this.polite = polite;
    this.pc = new RTCPeerConnection({ iceServers });
    // Stable m-lines so replaceTrack (screen share / device switch) works even when
    // the peer joined without a camera or mic track.
    this.audioSender = this.pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    this.videoSender = this.pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
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

  async addLocalTracks(stream: MediaStream) {
    const audio = stream.getAudioTracks()[0];
    const video = stream.getVideoTracks()[0];
    await Promise.all([
      audio ? this.audioSender.replaceTrack(audio) : Promise.resolve(),
      video ? this.videoSender.replaceTrack(video) : Promise.resolve(),
    ]);
  }

  async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null) {
    const sender = kind === 'audio' ? this.audioSender : this.videoSender;
    await sender.replaceTrack(track);
  }

  async createAndSetOffer(
    videoCodec?: string,
    maxBitrate?: number,
    iceRestart = false,
  ): Promise<string> {
    this.makingOffer = true;
    try {
      if (videoCodec) await applyVideoCodecPreference(this.pc, videoCodec);
      const offer = await this.pc.createOffer({ iceRestart });
      await this.pc.setLocalDescription(offer);
      if (maxBitrate) await applyMaxBitrate(this.pc, maxBitrate);
      return this.pc.localDescription!.sdp;
    } finally {
      this.makingOffer = false;
    }
  }

  async handleOffer(
    sdp: string,
    videoCodec?: string,
    maxBitrate?: number,
  ): Promise<string | null> {
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
    await this.flushIce();
    if (videoCodec) await applyVideoCodecPreference(this.pc, videoCodec);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    if (maxBitrate) await applyMaxBitrate(this.pc, maxBitrate);
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
