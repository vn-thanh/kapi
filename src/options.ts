import type { KapiRoomOptions, KapiUiLabels, KapiUiTheme, ToolbarButton } from './types';

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const DEFAULT_MAX_PEERS = 6;

export const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

export const DEFAULT_TOOLBAR: ToolbarButton[] = [
  'mic',
  'cam',
  'share',
  'react',
  'participants',
  'layout',
  'background',
  'settings',
  'hangup',
];

export const DEFAULT_THEME: Required<KapiUiTheme> = {
  bg: '#141414',
  fg: '#f5f5f5',
  accent: '#3b82f6',
  danger: '#ef4444',
  tileBg: '#1f1f1f',
  toolbarBg: 'rgba(0,0,0,0.72)',
};

export const DEFAULT_LABELS: Required<KapiUiLabels> = {
  micOn: 'Mute',
  micOff: 'Unmute',
  noMic: 'No microphone found',
  camOn: 'Stop video',
  camOff: 'Start video',
  noCam: 'No camera found',
  share: 'Share screen',
  stopShare: 'Stop sharing',
  react: 'React',
  participants: 'Participants',
  background: 'Background',
  settings: 'Settings',
  hangup: 'Leave',
  layout: 'View: grid',
  pin: 'Pin tile',
  unpin: 'Unpin tile',
  you: 'You',
  enableSound: 'Tap to enable sound',
};

export function resolveRoomOptions(opts: KapiRoomOptions): Required<
  Pick<
    KapiRoomOptions,
    | 'roomId'
    | 'peerId'
    | 'signal'
    | 'iceServers'
    | 'maxPeers'
    | 'media'
    | 'effects'
    | 'polite'
    | 'autoJoin'
    | 'leaveOnUnload'
  >
> &
  KapiRoomOptions {
  return {
    ...opts,
    displayName: opts.displayName ?? opts.peerId,
    iceServers: opts.iceServers?.length ? opts.iceServers : DEFAULT_ICE_SERVERS,
    maxPeers: opts.maxPeers ?? DEFAULT_MAX_PEERS,
    media: {
      audio: opts.media?.audio ?? true,
      video: opts.media?.video ?? true,
    },
    effects: {
      background: opts.effects?.background ?? 'none',
      modelUrl: opts.effects?.modelUrl ?? DEFAULT_MODEL_URL,
      blurAmount: opts.effects?.blurAmount ?? 12,
    },
    polite: opts.polite ?? true,
    autoJoin: opts.autoJoin ?? true,
    leaveOnUnload: opts.leaveOnUnload ?? true,
  };
}
