export type BackgroundMode = 'none' | 'blur' | 'remove' | { image: string };

export type SignalPeer = { peerId: string; displayName?: string };

export type SignalMessage =
  | { type: 'join'; peerId: string; displayName?: string }
  | { type: 'leave'; peerId: string }
  | { type: 'offer'; sdp: string; to: string; from?: string }
  | { type: 'answer'; sdp: string; to: string; from?: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit; to: string; from?: string }
  | { type: 'peers'; peers: SignalPeer[] };

export interface SignalAdapter {
  send(msg: SignalMessage): void;
  onMessage(fn: (msg: SignalMessage) => void): () => void;
}

export type ToolbarButton =
  | 'mic'
  | 'cam'
  | 'share'
  | 'participants'
  | 'background'
  | 'settings'
  | 'hangup';

export interface KapiMediaOptions {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
}

export interface KapiEffectsOptions {
  background?: BackgroundMode;
  /** CDN or local URL for MediaPipe selfie segmenter model */
  modelUrl?: string;
  blurAmount?: number;
}

export interface KapiRoomOptions {
  roomId: string;
  peerId: string;
  displayName?: string;
  signal: SignalAdapter;
  iceServers?: RTCIceServer[];
  maxPeers?: number;
  media?: KapiMediaOptions;
  effects?: KapiEffectsOptions;
  /** Prefer lower peerId as polite peer (perfect negotiation). Default true. */
  polite?: boolean;
  /** Max video bitrate bps (applied when sender exists). */
  maxBitrate?: number;
  /** Preferred video codec mime, e.g. video/VP8 */
  videoCodec?: string;
  autoJoin?: boolean;
  /**
   * Send `leave` (hangup) when the page unloads — F5, tab close, navigation.
   * Without this, remote peers only notice the departure after ICE timeouts
   * (~15–30s) and keep showing a frozen tile. Default true.
   *
   * Note: `SignalAdapter.send` must be synchronous-safe during unload
   * (BroadcastChannel postMessage, WebSocket send, or fetch with
   * `keepalive: true`/sendBeacon for HTTP).
   */
  leaveOnUnload?: boolean;
}

export type RoomEventMap = {
  'peer-joined': { peerId: string; displayName?: string };
  'peer-left': { peerId: string };
  track: { peerId: string; track: MediaStreamTrack; streams: readonly MediaStream[] };
  'local-stream': { stream: MediaStream };
  error: { error: Error };
  hangup: undefined;
};

export type RoomEvent = keyof RoomEventMap;

export interface KapiUiTheme {
  bg?: string;
  fg?: string;
  accent?: string;
  danger?: string;
  tileBg?: string;
  toolbarBg?: string;
}

export interface KapiUiLabels {
  micOn?: string;
  micOff?: string;
  camOn?: string;
  camOff?: string;
  share?: string;
  stopShare?: string;
  participants?: string;
  background?: string;
  settings?: string;
  hangup?: string;
  you?: string;
  enableSound?: string;
}

export interface KapiMountOptions extends KapiRoomOptions {
  toolbar?: ToolbarButton[];
  theme?: KapiUiTheme;
  labels?: KapiUiLabels;
  onHangup?: () => void;
  onReady?: (room: import('./core/room').KapiRoom) => void;
  onError?: (error: Error) => void;
}

export interface KapiMountHandle {
  room: import('./core/room').KapiRoom | null;
  dispose: () => void;
}
