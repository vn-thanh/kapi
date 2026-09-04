export type BackgroundMode = 'none' | 'blur' | 'remove' | { image: string };

export type SignalPeer = { peerId: string; displayName?: string };

export type SignalMessage =
  | { type: 'join'; peerId: string; displayName?: string }
  | { type: 'leave'; peerId: string }
  | { type: 'offer'; sdp: string; to: string; from?: string }
  | { type: 'answer'; sdp: string; to: string; from?: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit; to: string; from?: string }
  | { type: 'reaction'; emoji: string; from?: string }
  | { type: 'peers'; peers: SignalPeer[] }
  /**
   * Broadcast when a peer starts/stops screen sharing (and sent targeted with
   * `to` to peers that join mid-share). Relays that only switch over the
   * documented types may drop it — the UI then falls back to plain grid
   * placement, media itself is unaffected.
   */
  | { type: 'media-state'; peerId: string; sharing: boolean; to?: string; from?: string };

export interface SignalAdapter {
  send(msg: SignalMessage): void;
  onMessage(fn: (msg: SignalMessage) => void): () => void;
}

export type ToolbarButton =
  | 'mic'
  | 'cam'
  | 'share'
  | 'react'
  | 'participants'
  | 'layout'
  | 'background'
  | 'settings'
  | 'hangup';

/** Tile arrangement of the built-in UI. `'grid'` tiles everyone equally;
 *  `'spotlight'` gives one featured tile the stage with a bottom filmstrip;
 *  `'sidebar'` puts the filmstrip in a right-hand column instead. */
export type KapiLayout = 'grid' | 'spotlight' | 'sidebar';

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
  /** RTCPeerConnection state per remote peer — drive UI connection badges. */
  'peer-state': { peerId: string; state: RTCPeerConnectionState };
  'local-stream': { stream: MediaStream };
  /** An emoji reaction — fired for remote arrivals AND for the local one
   *  triggered by `sendReaction` (single stream for UI consumers). */
  reaction: { peerId: string; emoji: string };
  /** Screen-share state changed — fired locally when `shareScreen` toggles
   *  and for remote peers via the `media-state` signal message. */
  'media-state': { peerId: string; sharing: boolean };
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
  /** Tooltip for the mic button when no audioinput device exists. */
  noMic?: string;
  camOn?: string;
  camOff?: string;
  /** Tooltip for the cam button when no videoinput device exists. */
  noCam?: string;
  share?: string;
  stopShare?: string;
  react?: string;
  participants?: string;
  background?: string;
  settings?: string;
  hangup?: string;
  /** Toolbar view-cycle button tooltip. */
  layout?: string;
  /** Click-to-pin tile tooltip (pinned tiles win the spotlight/sidebar stage). */
  pin?: string;
  /** Tooltip of an already-pinned tile. */
  unpin?: string;
  you?: string;
  enableSound?: string;
}

export interface KapiMountOptions extends KapiRoomOptions {
  toolbar?: ToolbarButton[];
  theme?: KapiUiTheme;
  labels?: KapiUiLabels;
  /** Initial tile layout (default `'grid'`). Switchable at runtime via the
   *  `layout` toolbar button or `handle.setLayout()`. */
  layout?: KapiLayout;
  /**
   * How camera video fits inside its tile. `'contain'` (default) always shows
   * the full frame at its true aspect ratio; `'cover'` fills the tile and
   * crops overflow (pre-0.2 behavior). Screen shares always use `contain` —
   * cropped screen content is unreadable.
   */
  videoFit?: 'contain' | 'cover';
  onHangup?: () => void;
  onReady?: (room: import('./core/room').KapiRoom) => void;
  onError?: (error: Error) => void;
}

export interface KapiMountHandle {
  room: import('./core/room').KapiRoom | null;
  /** Current tile layout. */
  readonly layout: KapiLayout;
  /** Switch the tile layout at runtime. */
  setLayout: (layout: KapiLayout) => void;
  dispose: () => void;
}
