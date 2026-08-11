// Player settings, persisted in localStorage.
//
// Sensitivity matters more here than in a normal game: a trackpad in
// free-look mode moves the view very differently from a locked mouse, so
// being able to tune it is the difference between playable and not.

const KEY = 'mc-clone.settings.v1';

import {
  RENDER_DISTANCE_MIN, RENDER_DISTANCE_MAX, RENDER_DISTANCE_DEFAULT,
} from './constants.js';

export const LIMITS = {
  sensitivity: { min: 0.2, max: 3, step: 0.05 },
  fov: { min: 50, max: 110, step: 1 },
  touchSensitivity: { min: 0.3, max: 3, step: 0.05 },
  renderDistance: { min: RENDER_DISTANCE_MIN, max: RENDER_DISTANCE_MAX, step: 1 },
};

const DEFAULTS = {
  sensitivity: 1,
  touchSensitivity: 1,
  fov: 70,
  renderDistance: RENDER_DISTANCE_DEFAULT,
  invertY: false,
  autoJump: true,
};

function clampSetting(key, value) {
  const lim = LIMITS[key];
  if (!lim) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS[key];
  return Math.min(lim.max, Math.max(lim.min, n));
}

/** Merge stored values over the defaults, ignoring anything unrecognised. */
export function normalise(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) continue;
    out[key] = typeof DEFAULTS[key] === 'boolean' ? Boolean(raw[key]) : clampSetting(key, raw[key]);
  }
  return out;
}

function read() {
  try {
    return normalise(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = read();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private browsing / storage full — settings just don't persist */
  }
}

export function setSetting(key, value) {
  if (!(key in DEFAULTS)) return;
  settings[key] = typeof DEFAULTS[key] === 'boolean' ? Boolean(value) : clampSetting(key, value);
  saveSettings();
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings();
}

export { DEFAULTS };
