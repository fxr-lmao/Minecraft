// Tests for the adaptive frame-rate targeting helpers in src/utils.js.
import { refreshBucket, initialTargetFps, tierDown, tierUp, FPS_TIERS } from '../src/utils.js';

const results = [];
const assert = (name, cond, detail) => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

// ---- refreshBucket: measured cadence snaps to standard refresh rates ----
assert('59.94 Hz → 60', refreshBucket(59.94) === 60, String(refreshBucket(59.94)));
assert('118 Hz → 120', refreshBucket(118) === 120, String(refreshBucket(118)));
assert('144.4 Hz → 144', refreshBucket(144.4) === 144, String(refreshBucket(144.4)));
assert('239.8 Hz → 240', refreshBucket(239.8) === 240, String(refreshBucket(239.8)));
assert('89.7 Hz → 90', refreshBucket(89.7) === 90, String(refreshBucket(89.7)));
assert('out-of-tolerance keeps measurement', refreshBucket(100) === 100, String(refreshBucket(100)));
assert('NaN → 60', refreshBucket(NaN) === 60);
assert('0 Hz → 60', refreshBucket(0) === 60);

// ---- initialTargetFps: what we aim for on each display class ----
assert('60 Hz display → 60 fps', initialTargetFps(60) === 60, String(initialTargetFps(60)));
assert('75 Hz display → 60 fps', initialTargetFps(75) === 60, String(initialTargetFps(75)));
assert('90 Hz display → 90 fps', initialTargetFps(90) === 90, String(initialTargetFps(90)));
assert('120 Hz display → 120 fps', initialTargetFps(120) === 120, String(initialTargetFps(120)));
assert('144 Hz display → 120 fps', initialTargetFps(144) === 120, String(initialTargetFps(144)));
assert('240 Hz display → 120 fps', initialTargetFps(240) === 120, String(initialTargetFps(240)));
assert('119.3 Hz measured → 120 fps (snapped)', initialTargetFps(119.3) === 120, String(initialTargetFps(119.3)));

// ---- tierDown: relax the target one level ----
assert('120 → 90', tierDown(120) === 90, String(tierDown(120)));
assert('90 → 60', tierDown(90) === 60, String(tierDown(90)));
assert('60 → 30', tierDown(60) === 30, String(tierDown(60)));
assert('30 stays 30', tierDown(30) === 30, String(tierDown(30)));

// ---- tierUp: recover ambition, capped by the display ----
assert('30 → 60', tierUp(30, 60) === 60, String(tierUp(30, 60)));
assert('60 → 90 (144 Hz display)', tierUp(60, 144) === 90, String(tierUp(60, 144)));
assert('90 → 120 (144 Hz display)', tierUp(90, 144) === 120, String(tierUp(90, 144)));
assert('120 stays 120 (144 Hz display)', tierUp(120, 144) === 120, String(tierUp(120, 144)));
assert('60 stays 60 (60 Hz display)', tierUp(60, 60) === 60, String(tierUp(60, 60)));
assert('90 stays 90 (90 Hz display)', tierUp(90, 90) === 90, String(tierUp(90, 90)));

// ---- tier ladder sanity ----
assert('tiers strictly ascending', FPS_TIERS.every((t, i) => i === 0 || t > FPS_TIERS[i - 1]), FPS_TIERS.join('/'));

console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
