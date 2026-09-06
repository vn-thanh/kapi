import type { BackgroundMode, KapiLayout } from '../types';

/** Persisted background modes — custom image URLs are session-only (blob). */
export type PersistedBackgroundMode = Extract<BackgroundMode, 'none' | 'blur' | 'remove'>;

/** Browser audio-processing flags remembered across sessions. */
export interface KapiAudioProcessingPreferences {
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
}

/**
 * User preferences remembered across sessions (Zoom/Meet/Discord style).
 * Host mount options still win when explicitly set.
 */
export interface KapiUserPreferences {
  version: 1;
  devices: {
    audioInputId?: string;
    videoInputId?: string;
    audioOutputId?: string;
  };
  /** Mic processing toggles (applied via `MediaTrackConstraints`). */
  audio?: KapiAudioProcessingPreferences;
  effects: {
    background?: PersistedBackgroundMode;
    blurAmount?: number;
  };
  ui: {
    layout?: KapiLayout;
    videoFit?: 'contain' | 'cover';
    shortcuts?: boolean;
    /** Mirror the local camera preview (not screen shares). */
    mirror?: boolean;
  };
}

export interface KapiPreferencesOptions {
  /** Persist settings to localStorage. Default `true`. */
  enabled?: boolean;
  /** Storage key. Default `'kapi.prefs.v1'`. */
  key?: string;
  /** Fired after every successful write. */
  onChange?: (prefs: KapiUserPreferences) => void;
}

export const DEFAULT_PREFERENCES_KEY = 'kapi.prefs.v1';

export const EMPTY_PREFERENCES: KapiUserPreferences = {
  version: 1,
  devices: {},
  audio: {},
  effects: {},
  ui: {},
};
