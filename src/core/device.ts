/**
 * Proactive quality vs performance presets from coarse device / network
 * signals. Complements the reactive adaptive encoder (bandwidth/CPU stats +
 * video-hint) — this picks capture ceilings and starting rungs *before* the
 * first frame, instead of waiting for the link to choke.
 */

import type { DeviceTier, KapiDeviceAdaptationOptions } from '../types';

export type { DeviceTier, KapiDeviceAdaptationOptions };

export type DeviceCapabilities = {
  tier: DeviceTier;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  saveData: boolean;
  effectiveType: string | null;
  mobileLike: boolean;
};

export type DevicePreset = {
  tier: DeviceTier;
  video: MediaTrackConstraints;
  /** Adaptive rung to start on (0 = best quality). */
  initialRung: number;
  /** Best (lowest index) rung this device may climb back to. */
  bestRung: number;
  /** Background-effect inference / captureStream fps. */
  effectFps: number;
  /** Default blur radius when the host did not set one. */
  blurAmount: number;
  /** Soft uplink cap when the host did not set `maxBitrate`. */
  maxBitrate?: number;
};

export type ResolvedDeviceAdaptation = {
  enabled: boolean;
  tier: DeviceTier;
  capabilities: DeviceCapabilities;
  preset: DevicePreset;
};

/** High-tier ceiling — also the public `DEFAULT_VIDEO` when adaptation is off. */
export const VIDEO_CONSTRAINTS_HIGH: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

export const DEVICE_PRESETS: Record<DeviceTier, DevicePreset> = {
  high: {
    tier: 'high',
    video: { ...VIDEO_CONSTRAINTS_HIGH },
    initialRung: 0,
    bestRung: 0,
    effectFps: 30,
    blurAmount: 12,
  },
  medium: {
    tier: 'medium',
    video: {
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 24 },
    },
    initialRung: 1,
    bestRung: 0,
    effectFps: 24,
    blurAmount: 10,
  },
  low: {
    tier: 'low',
    video: {
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 15 },
    },
    initialRung: 2,
    bestRung: 1,
    effectFps: 15,
    blurAmount: 8,
    maxBitrate: 600_000,
  },
};

type NetworkInformationLike = {
  saveData?: boolean;
  effectiveType?: string;
};

function readNetwork(nav: Navigator): { saveData: boolean; effectiveType: string | null } {
  const c = (
    nav as Navigator & {
      connection?: NetworkInformationLike;
      mozConnection?: NetworkInformationLike;
      webkitConnection?: NetworkInformationLike;
    }
  ).connection ??
    (nav as Navigator & { mozConnection?: NetworkInformationLike }).mozConnection ??
    (nav as Navigator & { webkitConnection?: NetworkInformationLike }).webkitConnection;
  if (!c) return { saveData: false, effectiveType: null };
  return {
    saveData: c.saveData === true,
    effectiveType: typeof c.effectiveType === 'string' ? c.effectiveType : null,
  };
}

function isMobileLike(nav: Navigator): boolean {
  const ua = nav.userAgent ?? '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS desktop UA still exposes multi-touch.
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

/**
 * Map Navigator hints to a coarse tier. Missing signals stay neutral (medium)
 * rather than assuming a beefy desktop — better soft than crushing a phone.
 */
export function scoreDeviceTier(caps: Omit<DeviceCapabilities, 'tier'>): DeviceTier {
  if (caps.saveData) return 'low';
  const et = caps.effectiveType?.toLowerCase() ?? '';
  if (et === 'slow-2g' || et === '2g') return 'low';

  let score = 1; // start medium
  if (et === '4g' || et === '') score = 2;
  if (et === '3g') score = Math.min(score, 1);

  if (caps.deviceMemoryGb !== null) {
    if (caps.deviceMemoryGb <= 2) score = Math.min(score, 0);
    else if (caps.deviceMemoryGb <= 4) score = Math.min(score, 1);
    else if (caps.deviceMemoryGb >= 8) score = Math.max(score, 2);
  }

  if (caps.hardwareConcurrency !== null) {
    if (caps.hardwareConcurrency <= 2) score = Math.min(score, 0);
    else if (caps.hardwareConcurrency <= 4) score = Math.min(score, 1);
    else if (caps.hardwareConcurrency >= 8) score = Math.max(score, 2);
  }

  if (caps.mobileLike) {
    const strong =
      (caps.deviceMemoryGb !== null && caps.deviceMemoryGb >= 6) ||
      (caps.hardwareConcurrency !== null && caps.hardwareConcurrency >= 6);
    if (!strong) score = Math.max(0, score - 1);
  }

  return (['low', 'medium', 'high'] as const)[score]!;
}

/** Read coarse device / network capabilities (SSR-safe). */
export function detectDeviceCapabilities(
  nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
): DeviceCapabilities {
  if (!nav) {
    const base = {
      hardwareConcurrency: null,
      deviceMemoryGb: null,
      saveData: false,
      effectiveType: null,
      mobileLike: false,
    };
    return { ...base, tier: scoreDeviceTier(base) };
  }

  const mem = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  const net = readNetwork(nav);
  const base = {
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
        ? nav.hardwareConcurrency
        : null,
    deviceMemoryGb: typeof mem === 'number' && mem > 0 ? mem : null,
    saveData: net.saveData,
    effectiveType: net.effectiveType,
    mobileLike: isMobileLike(nav),
  };
  return { ...base, tier: scoreDeviceTier(base) };
}

export function presetForTier(tier: DeviceTier): DevicePreset {
  return { ...DEVICE_PRESETS[tier], video: { ...DEVICE_PRESETS[tier].video } };
}

/**
 * Normalize `deviceAdaptation` and pick the active preset.
 * Default enabled — hosts opt out with `deviceAdaptation: false`.
 */
export function resolveDeviceAdaptation(
  opts: boolean | KapiDeviceAdaptationOptions | undefined,
  nav?: Navigator,
): ResolvedDeviceAdaptation {
  if (opts === false) {
    const capabilities = detectDeviceCapabilities(nav);
    return {
      enabled: false,
      tier: 'high',
      capabilities,
      preset: presetForTier('high'),
    };
  }
  const o: KapiDeviceAdaptationOptions = opts === true || opts === undefined ? {} : opts;
  const enabled = o.enabled !== false;
  const capabilities = detectDeviceCapabilities(nav);
  const tier =
    !enabled
      ? 'high'
      : o.tier && o.tier !== 'auto'
        ? o.tier
        : capabilities.tier;
  return {
    enabled,
    tier,
    capabilities: { ...capabilities, tier },
    preset: presetForTier(tier),
  };
}

/**
 * Merge a device-tier capture ceiling into host video constraints.
 * Explicit `width` / `height` from the host win; bare `true` / omitted /
 * deviceId-only prefs pick up the tier ideals.
 */
export function applyDeviceVideoConstraints(
  video: boolean | MediaTrackConstraints | undefined,
  preset: DevicePreset,
  enabled: boolean,
): boolean | MediaTrackConstraints {
  if (video === false) return false;
  const ceiling = enabled ? preset.video : VIDEO_CONSTRAINTS_HIGH;
  if (video === undefined || video === true) return { ...ceiling };
  if (video.width !== undefined || video.height !== undefined) return video;
  return { ...ceiling, ...video };
}
