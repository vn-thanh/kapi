import type {
  KapiAudioProcessingPreferences,
  KapiUserPreferences,
  PersistedBackgroundMode,
} from './types';
import { DEFAULT_PREFERENCES_KEY, EMPTY_PREFERENCES } from './types';
import type { KapiLayout } from '../types';

const LAYOUTS: readonly KapiLayout[] = ['grid', 'spotlight', 'sidebar'];
const BG_MODES: readonly PersistedBackgroundMode[] = ['none', 'blur', 'remove'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asBlur(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(1, Math.min(40, Math.round(v)));
}

function asLayout(v: unknown): KapiLayout | undefined {
  return typeof v === 'string' && (LAYOUTS as readonly string[]).includes(v)
    ? (v as KapiLayout)
    : undefined;
}

function asBg(v: unknown): PersistedBackgroundMode | undefined {
  return typeof v === 'string' && (BG_MODES as readonly string[]).includes(v)
    ? (v as PersistedBackgroundMode)
    : undefined;
}

function asFit(v: unknown): 'contain' | 'cover' | undefined {
  return v === 'contain' || v === 'cover' ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function asAudioProcessing(raw: unknown): KapiAudioProcessingPreferences {
  if (!isRecord(raw)) return {};
  return {
    noiseSuppression: asBool(raw.noiseSuppression),
    echoCancellation: asBool(raw.echoCancellation),
    autoGainControl: asBool(raw.autoGainControl),
  };
}

/** Normalize unknown JSON into a complete preferences object. */
export function normalizePreferences(raw: unknown): KapiUserPreferences {
  if (!isRecord(raw)) {
    return { ...EMPTY_PREFERENCES, devices: {}, audio: {}, effects: {}, ui: {} };
  }
  const devices = isRecord(raw.devices) ? raw.devices : {};
  const effects = isRecord(raw.effects) ? raw.effects : {};
  const ui = isRecord(raw.ui) ? raw.ui : {};
  return {
    version: 1,
    devices: {
      audioInputId: asString(devices.audioInputId),
      videoInputId: asString(devices.videoInputId),
      audioOutputId: asString(devices.audioOutputId),
    },
    audio: asAudioProcessing(raw.audio),
    effects: {
      background: asBg(effects.background),
      blurAmount: asBlur(effects.blurAmount),
    },
    ui: {
      layout: asLayout(ui.layout),
      videoFit: asFit(ui.videoFit),
      shortcuts: asBool(ui.shortcuts),
      mirror: asBool(ui.mirror),
    },
  };
}

function storageAvailable(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const k = '__kapi_prefs__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

export function loadPreferences(key = DEFAULT_PREFERENCES_KEY): KapiUserPreferences {
  const store = storageAvailable();
  if (!store) return normalizePreferences(null);
  try {
    const raw = store.getItem(key);
    if (!raw) return normalizePreferences(null);
    return normalizePreferences(JSON.parse(raw) as unknown);
  } catch {
    return normalizePreferences(null);
  }
}

export function savePreferences(
  prefs: KapiUserPreferences,
  key = DEFAULT_PREFERENCES_KEY,
): KapiUserPreferences {
  const next = normalizePreferences(prefs);
  const store = storageAvailable();
  if (store) {
    try {
      store.setItem(key, JSON.stringify(next));
    } catch {
      // Quota / private mode — keep in-memory shape for this session.
    }
  }
  return next;
}

/** Deep-merge a partial patch onto current prefs and persist. */
export function patchPreferences(
  patch: {
    devices?: Partial<KapiUserPreferences['devices']>;
    audio?: Partial<KapiAudioProcessingPreferences>;
    effects?: Partial<KapiUserPreferences['effects']>;
    ui?: Partial<KapiUserPreferences['ui']>;
  },
  key = DEFAULT_PREFERENCES_KEY,
): KapiUserPreferences {
  const cur = loadPreferences(key);
  return savePreferences(
    {
      version: 1,
      devices: { ...cur.devices, ...patch.devices },
      audio: { ...cur.audio, ...patch.audio },
      effects: { ...cur.effects, ...patch.effects },
      ui: { ...cur.ui, ...patch.ui },
    },
    key,
  );
}

/**
 * Attach a preferred `deviceId: { ideal }` when the host has not already
 * pinned a device in the constraints object.
 */
export function withPreferredDevice(
  constraints: boolean | MediaTrackConstraints | undefined,
  deviceId: string | undefined,
): boolean | MediaTrackConstraints | undefined {
  if (!deviceId || constraints === false) return constraints;
  if (constraints === true || constraints === undefined) {
    return { deviceId: { ideal: deviceId } };
  }
  if (constraints.deviceId !== undefined) return constraints;
  return { ...constraints, deviceId: { ideal: deviceId } };
}

/**
 * Merge remembered mic processing flags into audio constraints when the host
 * has not already set those keys. Leaves browser defaults alone when prefs
 * are empty.
 */
export function withAudioProcessing(
  constraints: boolean | MediaTrackConstraints | undefined,
  processing: KapiAudioProcessingPreferences | undefined,
): boolean | MediaTrackConstraints | undefined {
  if (!processing || constraints === false) return constraints;
  const patch: MediaTrackConstraints = {};
  if (processing.noiseSuppression !== undefined) patch.noiseSuppression = processing.noiseSuppression;
  if (processing.echoCancellation !== undefined) patch.echoCancellation = processing.echoCancellation;
  if (processing.autoGainControl !== undefined) patch.autoGainControl = processing.autoGainControl;
  if (!Object.keys(patch).length) return constraints;

  if (constraints === true || constraints === undefined) return patch;
  const next = { ...constraints };
  for (const key of Object.keys(patch) as (keyof MediaTrackConstraints)[]) {
    if (next[key] === undefined) {
      (next as Record<string, unknown>)[key as string] = patch[key];
    }
  }
  return next;
}

/** Read a deviceId string from MediaTrackConstraints (exact or ideal). */
export function deviceIdFromConstraint(
  constraints: boolean | MediaTrackConstraints | undefined,
): string | undefined {
  if (!constraints || constraints === true) return undefined;
  const id = constraints.deviceId;
  if (typeof id === 'string') return id || undefined;
  if (!id || typeof id !== 'object') return undefined;
  const cand =
    'exact' in id ? id.exact : 'ideal' in id ? id.ideal : undefined;
  if (typeof cand === 'string') return cand || undefined;
  if (Array.isArray(cand) && typeof cand[0] === 'string') return cand[0] || undefined;
  return undefined;
}
