import type {
  ConnectionQuality,
  KapiConnectionQualityThresholds,
  SfuAdapter,
  SfuSource,
  SfuTrackInfo,
  SfuTrackObject,
  SfuTracksResponse,
} from '../types';
import { readQualitySample, scoreConnectionQuality } from './quality';

/**
 * Camera simulcast layers, high → low. RIDs sort asciibetically in that
 * order (f < h < q), so `priorityOrdering: 'asciibetical'` falls back from
 * the preferred layer to the next best. Same sizes as the mesh rungs.
 */
const CAMERA_LAYERS: RTCRtpEncodingParameters[] = [
  { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: 1_500_000, maxFramerate: 30 },
  { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 600_000, maxFramerate: 24 },
  { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 250_000, maxFramerate: 15 },
];
/** Screen share: one full-resolution, low-fps layer (text stays readable). */
const SHARE_LAYER = { maxBitrate: 3_000_000, maxFramerate: 10 };

const SOURCES: SfuSource[] = ['audio', 'video', 'share-audio'];

/** Simulcast layer for a tile rendered at `width` × `height` device px. */
export function ridForSize(width: number, height: number): 'f' | 'h' | 'q' {
  const longest = Math.max(width, height);
  if (longest >= 640) return 'f';
  if (longest >= 320) return 'h';
  return 'q';
}

type Pulled = { peerId: string; source: SfuSource; sessionId: string; trackName: string; rid?: string };

export type SfuTransportCallbacks = {
  onTrack: (peerId: string, track: MediaStreamTrack, source: SfuSource) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onError?: (error: Error) => void;
};

/**
 * One RTCPeerConnection to the SFU, shared by every remote peer: publish the
 * three local slots once (mic, camera/screen, share audio), then pull each
 * peer's tracks. Mutations are serialized — the SFU requires each SDP
 * exchange to finish before the next one starts.
 */
export class SfuTransport {
  readonly pc: RTCPeerConnection;
  sessionId = '';
  private chain: Promise<unknown> = Promise.resolve();
  private readonly senders = new Map<SfuSource, RTCRtpTransceiver>();
  /** Latest wanted outbound track per slot — applied once the slot exists. */
  private readonly desired = new Map<SfuSource, MediaStreamTrack | null>();
  private readonly pulled = new Map<string, Pulled>();
  private sharing = false;
  private simulcast = true;
  private closed = false;

  constructor(
    private readonly adapter: SfuAdapter,
    iceServers: RTCIceServer[],
    private readonly cb: SfuTransportCallbacks,
  ) {
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    this.pc.ontrack = (e) => {
      const mid = e.transceiver?.mid;
      const owner = mid ? this.pulled.get(mid) : undefined;
      if (owner) this.cb.onTrack(owner.peerId, e.track, owner.source);
    };
    this.pc.onconnectionstatechange = () => this.cb.onConnectionState?.(this.pc.connectionState);
  }

  /** Serialize one SFU mutation; failures are reported and resolve to undefined. */
  private run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const next = this.chain
      .then(() => (this.closed ? undefined : fn()))
      .catch((err) => {
        if (!this.closed) this.cb.onError?.(err instanceof Error ? err : new Error(String(err)));
        return undefined;
      });
    this.chain = next;
    return next;
  }

  /** Publish the local slots; null tracks are fine (they start sending on `setTrack`). */
  start(
    tracks: Partial<Record<SfuSource, MediaStreamTrack | null>>,
    sharing: boolean,
  ): Promise<SfuTrackInfo[] | undefined> {
    for (const source of SOURCES) {
      if (!this.desired.has(source)) this.desired.set(source, tracks[source] ?? null);
    }
    this.sharing = sharing;
    return this.run(async () => {
      const { sessionId } = await this.adapter.newSession();
      this.sessionId = sessionId;
      for (const source of SOURCES) {
        const track = this.desired.get(source) ?? null;
        const kind = source === 'video' ? 'video' : 'audio';
        let t: RTCRtpTransceiver;
        if (source === 'video') {
          try {
            t = this.pc.addTransceiver(track ?? kind, {
              direction: 'sendonly',
              sendEncodings: CAMERA_LAYERS.map((e) => ({ ...e })),
            });
          } catch {
            // No simulcast on this stack: one layer, the SFU forwards it as is.
            this.simulcast = false;
            t = this.pc.addTransceiver(track ?? kind, { direction: 'sendonly' });
          }
        } else {
          t = this.pc.addTransceiver(track ?? kind, { direction: 'sendonly' });
        }
        this.senders.set(source, t);
      }
      await this.pc.setLocalDescription(await this.pc.createOffer());
      const res = await this.adapter.newTracks(sessionId, {
        sessionDescription: { type: 'offer', sdp: this.pc.localDescription!.sdp },
        tracks: SOURCES.map((source) => ({
          location: 'local',
          mid: this.senders.get(source)!.mid ?? undefined,
          trackName: source,
        })),
      });
      if (res.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription);
      // A slot swapped while the publish was in flight.
      for (const source of SOURCES) {
        const t = this.senders.get(source)!;
        const want = this.desired.get(source) ?? null;
        if (t.sender.track !== want) await t.sender.replaceTrack(want);
      }
      await this.applyVideoLayers();
      return SOURCES.map((source) => ({
        trackName: source,
        kind: source === 'video' ? ('video' as const) : ('audio' as const),
        source,
      }));
    });
  }

  /** Swap an outbound slot (no renegotiation: the slots are pre-published). */
  async setTrack(source: SfuSource, track: MediaStreamTrack | null): Promise<void> {
    this.desired.set(source, track);
    const t = this.senders.get(source);
    if (t && t.sender.track !== track) await t.sender.replaceTrack(track);
  }

  /** Screen share: one sharp low-fps layer instead of camera simulcast. */
  async setSharing(sharing: boolean): Promise<void> {
    if (this.sharing === sharing) return;
    this.sharing = sharing;
    await this.applyVideoLayers();
  }

  private async applyVideoLayers() {
    const sender = this.senders.get('video')?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings = params.encodings.map((enc, i) => {
      if (!this.simulcast) {
        return { ...enc, ...(this.sharing ? SHARE_LAYER : { maxBitrate: CAMERA_LAYERS[1].maxBitrate }) };
      }
      if (this.sharing) {
        return i === 0
          ? { ...enc, active: true, scaleResolutionDownBy: 1, ...SHARE_LAYER }
          : { ...enc, active: false };
      }
      return { ...enc, ...CAMERA_LAYERS[i], active: true };
    });
    try {
      await sender.setParameters(params);
    } catch {
      // Older stacks reject some fields; the default layers still work.
    }
  }

  /** Subscribe to one peer's published tracks (skips ones already pulled). */
  pull(
    peerId: string,
    publication: { sessionId: string; tracks: SfuTrackInfo[] },
  ): Promise<void | undefined> {
    return this.run(async () => {
      if (!this.sessionId) return; // publish failed — nothing to pull into
      const have = new Set(
        [...this.pulled.values()]
          .filter((p) => p.sessionId === publication.sessionId)
          .map((p) => p.trackName),
      );
      const wanted = publication.tracks.filter((t) => !have.has(t.trackName)).slice(0, 64);
      if (wanted.length === 0) return;
      const res = await this.adapter.newTracks(this.sessionId, {
        tracks: wanted.map(
          (t): SfuTrackObject => ({
            location: 'remote',
            sessionId: publication.sessionId,
            trackName: t.trackName,
            ...(t.kind === 'video'
              ? {
                  simulcast: {
                    preferredRid: 'h',
                    priorityOrdering: 'asciibetical',
                    ridNotAvailable: 'asciibetical',
                  },
                }
              : {}),
          }),
        ),
      });
      for (const t of res.tracks ?? []) {
        const info = wanted.find((w) => w.trackName === t.trackName);
        if (t.errorCode || !t.mid || !info) continue;
        this.pulled.set(t.mid, {
          peerId,
          source: info.source,
          sessionId: publication.sessionId,
          trackName: info.trackName,
          rid: info.kind === 'video' ? 'h' : undefined,
        });
      }
      await this.answerIfNeeded(res);
    });
  }

  private async answerIfNeeded(res: SfuTracksResponse) {
    if (!res.requiresImmediateRenegotiation || !res.sessionDescription) return;
    await this.pc.setRemoteDescription(res.sessionDescription);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.adapter.renegotiate(this.sessionId, {
      sessionDescription: { type: 'answer', sdp: this.pc.localDescription!.sdp },
    });
  }

  /** Receiver-driven quality: pick the layer that fits the peer's tile. */
  setPreferredRid(peerId: string, rid: 'f' | 'h' | 'q'): Promise<void | undefined> {
    return this.run(async () => {
      if (!this.sessionId) return;
      const entry = [...this.pulled].find(([, p]) => p.peerId === peerId && p.source === 'video');
      if (!entry || entry[1].rid === rid) return;
      const [mid, p] = entry;
      p.rid = rid;
      const res = await this.adapter.updateTracks(this.sessionId, {
        tracks: [
          {
            location: 'remote',
            mid,
            sessionId: p.sessionId,
            trackName: p.trackName,
            simulcast: { preferredRid: rid, priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' },
          },
        ],
      });
      await this.answerIfNeeded(res);
    });
  }

  /** Stop forwarding a departed peer's tracks (saves egress). */
  dropPeer(peerId: string): Promise<void | undefined> {
    const mids = [...this.pulled].filter(([, p]) => p.peerId === peerId).map(([mid]) => mid);
    if (mids.length === 0) return Promise.resolve();
    for (const mid of mids) this.pulled.delete(mid);
    return this.run(async () => {
      if (!this.sessionId) return;
      await this.adapter.closeTracks(this.sessionId, { tracks: mids.map((mid) => ({ mid })), force: true });
    });
  }

  hasPeer(peerId: string): boolean {
    return [...this.pulled.values()].some((p) => p.peerId === peerId);
  }

  async sampleConnectionQuality(
    peerId: string,
    thresholds?: Required<KapiConnectionQualityThresholds>,
  ): Promise<ConnectionQuality> {
    const mids = new Set([...this.pulled].filter(([, p]) => p.peerId === peerId).map(([mid]) => mid));
    return scoreConnectionQuality(await readQualitySample(this.pc, mids), thresholds);
  }

  close() {
    if (this.closed) return;
    const local = [...this.senders.values()].map((t) => t.mid).filter((m): m is string => !!m);
    // Best-effort: subscribers stop receiving now instead of on ICE timeout.
    if (this.sessionId && local.length > 0) {
      void this.adapter
        .closeTracks(this.sessionId, { tracks: local.map((mid) => ({ mid })), force: true })
        .catch(() => undefined);
    }
    this.closed = true;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }
}
