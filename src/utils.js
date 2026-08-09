// Small seeded PRNG (mulberry32) so textures look identical every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Adaptive frame-rate targeting
//
// rAF runs at the display's refresh rate, so "how fast could we be going" is
// a property of the display. We measure the observed cadence, snap it to a
// standard refresh rate (60/75/90/120/...), and derive an FPS *target* from
// it — on a 120 Hz+ screen the game aims for 120 fps and adapts its render
// quality to hold it; on a 60 Hz screen it aims for 60 and spends the spare
// frame budget on image quality instead.
// ---------------------------------------------------------------------------

// Standard display refresh rates measured cadences snap to.
const REFRESH_RATES = [60, 75, 90, 120, 144, 165, 240];

// Ambition levels for the FPS target, lowest to highest.
export const FPS_TIERS = [30, 60, 90, 120];

/**
 * Snap a measured frame cadence (Hz) to the nearest standard display
 * refresh rate if it is within `tol` (fraction) of it; otherwise keep the
 * measurement, clamped to a sane range. Invalid input falls back to 60.
 */
export function refreshBucket(hz, tol = 0.05) {
  if (!Number.isFinite(hz) || hz <= 0) return 60;
  let best = REFRESH_RATES[0];
  for (const r of REFRESH_RATES) {
    if (Math.abs(hz - r) < Math.abs(hz - best)) best = r;
  }
  return Math.abs(hz - best) / best <= tol
    ? best
    : clamp(Math.round(hz), 30, 240);
}

/**
 * FPS target for a fresh session on a display with the given refresh rate.
 * High-refresh displays target 120 fps; mid-range ones 90; the rest 60.
 */
export function initialTargetFps(displayHz) {
  const hz = refreshBucket(displayHz);
  if (hz >= 115) return 120;
  if (hz >= 85) return 90;
  return 60;
}

/** Relax the target one tier (when even minimum resolution can't hold it). */
export function tierDown(target) {
  for (let i = FPS_TIERS.length - 1; i >= 0; i--) {
    if (FPS_TIERS[i] < target) return FPS_TIERS[i];
  }
  return FPS_TIERS[0];
}

/** Raise the target one tier, capped by what the display can show. */
export function tierUp(target, displayHz) {
  const cap = initialTargetFps(displayHz);
  for (const t of FPS_TIERS) {
    if (t > target) return Math.min(t, cap);
  }
  return cap;
}
