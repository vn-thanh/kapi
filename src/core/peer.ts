import { applyMaxBitrate, applyVideoCodecPreference } from './media';

export type PeerCallbacks = {
  onIce: (candidate: RTCIceCandidateInit) => void;
  onTrack: (track: MediaStreamTrack, streams: readonly MediaStream[]) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
};

export class KapiPeer {
  readonly peerId: string;
  readonly pc: RTCPeerConnection;
  makingOffer = false;
  ignoreOffer = false;
  private readonly polite: boolean;

  constructor(
    peerId: string,
    iceServers: RTCIceServer[],
    polite: boolean,
    private readonly cb: PeerCallbacks,
  ) {
    this.peerId = peerId;
    this.polite = polite;
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.cb.onIce(e.candidate.toJSON());
    };
    this.pc.ontrack = (e) => this.cb.onTrack(e.track, e.streams);
    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState?.(this.pc.connectionState);
    };
  }

  addLocalTracks(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      const existing = this.pc.getSenders().find((s) => s.track?.kind === track.kind);
      if (existing) void existing.replaceTrack(track);
      else this.pc.addTrack(track, stream);
    }
  }

  async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null) {
    let sender = this.pc.getSenders().find((s) => s.track?.kind === kind);
    if (!sender) sender = this.pc.getSenders().find((s) => !s.track);
    if (sender) await sender.replaceTrack(track);
    else if (track) this.pc.addTrack(track);
  }

  async createAndSetOffer(videoCodec?: string, maxBitrate?: number): Promise<string> {
    this.makingOffer = true;
    try {
      if (videoCodec) await applyVideoCodecPreference(this.pc, videoCodec);
      const offer = await this.pc.createOffer();
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

    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    if (videoCodec) await applyVideoCodecPreference(this.pc, videoCodec);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    if (maxBitrate) await applyMaxBitrate(this.pc, maxBitrate);
    return this.pc.localDescription!.sdp;
  }

  async handleAnswer(sdp: string) {
    if (this.ignoreOffer) return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  async handleIce(candidate: RTCIceCandidateInit) {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!this.ignoreOffer) throw err;
    }
  }

  close() {
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.close();
  }
}
