export type {
  KapiUserPreferences,
  KapiPreferencesOptions,
  PersistedBackgroundMode,
} from './types';
export {
  DEFAULT_PREFERENCES_KEY,
  EMPTY_PREFERENCES,
} from './types';
export {
  loadPreferences,
  savePreferences,
  patchPreferences,
  normalizePreferences,
  withPreferredDevice,
  deviceIdFromConstraint,
} from './storage';
