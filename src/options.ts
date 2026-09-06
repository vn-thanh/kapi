import type {
  KapiConnectionQualityOptions,
  KapiConnectionQualityThresholds,
  KapiRoomOptions,
  KapiUiLabels,
  KapiUiTheme,
  ToolbarButton,
} from './types';
import {
  applyDeviceVideoConstraints,
  resolveDeviceAdaptation,
  VIDEO_CONSTRAINTS_HIGH,
} from './core/device';
import type { ResolvedDeviceAdaptation } from './core/device';
import { DEFAULT_QUALITY_THRESHOLDS } from './core/quality';

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const DEFAULT_MAX_PEERS = 6;

/**
 * Capture ceiling when device adaptation is off (or high-tier): 720p keeps
 * modern 1080p/4K webcams from burning CPU and uplink. `ideal` (not
 * `exact`/`max`) — lower-default cameras are untouched and the adaptive
 * engine scales down from whatever it gets. With `deviceAdaptation` on
 * (default), weaker devices get 540p / 360p ceilings instead.
 */
export const DEFAULT_VIDEO: MediaTrackConstraints = { ...VIDEO_CONSTRAINTS_HIGH };

export const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

/** Default chrome: frequent in-call actions + Settings (layout / background
 *  live there). Hosts can still add `'layout'` / `'background'` for one-tap
 *  shortcuts via `toolbar`. */
export const DEFAULT_TOOLBAR: ToolbarButton[] = [
  'mic',
  'cam',
  'share',
  'react',
  'participants',
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
  noShare: 'Screen sharing is not supported here',
  shareWithAudio: 'Sharing with audio',
  permissionDenied: 'Permission denied — check camera, mic, or screen sharing access',
  react: 'React',
  participants: 'Participants',
  background: 'Background',
  bgNone: 'None',
  bgBlur: 'Blur',
  bgRemove: 'Remove',
  bgImage: 'Image…',
  bgUnsupported: 'Background effects unavailable on this device',
  settings: 'Settings',
  hangup: 'Leave',
  more: 'More',
  layout: 'View: grid',
  layoutGrid: 'View: grid',
  layoutSpotlight: 'View: spotlight',
  layoutSidebar: 'View: sidebar',
  pin: 'Pin tile',
  unpin: 'Unpin tile',
  microphone: 'Microphone',
  camera: 'Camera',
  speaker: 'Speaker',
  noSpeaker: 'No speaker found',
  speakerUnsupported: 'Speaker selection is not supported in this browser.',
  settingsAudio: 'Audio',
  settingsVideo: 'Video',
  settingsEffects: 'Effects',
  settingsGeneral: 'General',
  settingsClose: 'Close settings',
  videoFit: 'Video fit',
  videoFitContain: 'Fit',
  videoFitCover: 'Fill',
  blurAmount: 'Blur strength',
  defaultLayout: 'Default view',
  layoutGridShort: 'Grid',
  layoutSpotlightShort: 'Spotlight',
  layoutSidebarShort: 'Sidebar',
  shortcutsToggle: 'Keyboard shortcuts',
  shortcutsHint: 'M mute · V camera (while the call is focused)',
  muted: 'Muted',
  you: 'You',
  enableSound: 'Tap to enable sound',
  connectionExcellent: 'Excellent connection',
  connectionGood: 'Good connection',
  connectionPoor: 'Poor connection',
  connectionLost: 'Connection lost',
  connectionUnknown: 'Connecting…',
};

export type ResolvedConnectionQuality = {
  enabled: boolean;
  intervalMs: number;
  thresholds: Required<KapiConnectionQualityThresholds>;
};

/** Normalize `connectionQuality: boolean | object` into resolved settings. */
export function resolveConnectionQuality(
  opts: boolean | KapiConnectionQualityOptions | undefined,
): ResolvedConnectionQuality {
  if (opts === false) {
    return {
      enabled: false,
      intervalMs: 3000,
      thresholds: { ...DEFAULT_QUALITY_THRESHOLDS },
    };
  }
  const o: KapiConnectionQualityOptions = opts === true || opts === undefined ? {} : opts;
  const t = o.thresholds ?? {};
  return {
    enabled: o.enabled !== false,
    intervalMs: typeof o.intervalMs === 'number' && o.intervalMs >= 500 ? o.intervalMs : 3000,
    thresholds: {
      excellentLoss: t.excellentLoss ?? DEFAULT_QUALITY_THRESHOLDS.excellentLoss,
      goodLoss: t.goodLoss ?? DEFAULT_QUALITY_THRESHOLDS.goodLoss,
      excellentRtt: t.excellentRtt ?? DEFAULT_QUALITY_THRESHOLDS.excellentRtt,
      goodRtt: t.goodRtt ?? DEFAULT_QUALITY_THRESHOLDS.goodRtt,
    },
  };
}

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
    | 'adaptive'
  >
> &
  KapiRoomOptions & {
    connectionQualityResolved: ResolvedConnectionQuality;
    deviceAdaptationResolved: ResolvedDeviceAdaptation;
  } {
  const deviceAdaptationResolved = resolveDeviceAdaptation(opts.deviceAdaptation);
  const preset = deviceAdaptationResolved.preset;
  const videoOpt = opts.media?.video;
  return {
    ...opts,
    displayName: opts.displayName ?? opts.peerId,
    iceServers: opts.iceServers?.length ? opts.iceServers : DEFAULT_ICE_SERVERS,
    maxPeers: opts.maxPeers ?? DEFAULT_MAX_PEERS,
    media: {
      audio: opts.media?.audio ?? true,
      // Bare true/omitted (and deviceId-only prefs) pick up the tier ceiling;
      // host-pinned width/height win.
      video: applyDeviceVideoConstraints(
        videoOpt,
        preset,
        deviceAdaptationResolved.enabled,
      ),
      startMic: opts.media?.startMic ?? false,
      startCam: opts.media?.startCam ?? false,
      acquire: opts.media?.acquire ?? 'join',
    },
    effects: {
      background: opts.effects?.background ?? 'none',
      modelUrl: opts.effects?.modelUrl ?? DEFAULT_MODEL_URL,
      blurAmount: opts.effects?.blurAmount ?? preset.blurAmount,
    },
    // Soft uplink cap on weak tiers when the host did not set one.
    maxBitrate: opts.maxBitrate ?? preset.maxBitrate,
    polite: opts.polite ?? true,
    autoJoin: opts.autoJoin ?? true,
    leaveOnUnload: opts.leaveOnUnload ?? true,
    adaptive: opts.adaptive ?? true,
    connectionQualityResolved: resolveConnectionQuality(opts.connectionQuality),
    deviceAdaptationResolved,
  };
}
