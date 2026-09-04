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
  private readonly audioSender: RTCRtpSender;
  private readonly videoSender: RTCRtpSender;

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
  }

  addLocalTracks(stream: MediaStream) {
    const audio = stream.getAudioTracks()[0];
    const video = stream.getVideoTracks()[0];
    if (audio) void this.audioSender.replaceTrack(audio);
    if (video) void this.videoSender.replaceTrack(video);
  }

  async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null) {
    const sender = kind === 'audio' ? this.audioSender : this.videoSender;
    await sender.replaceTrack(track);
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
