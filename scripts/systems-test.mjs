// Save/restore, settings clamping, camera-distance smoothing and the
// body-turn angle maths behind the third-person avatar.
import { World, AIR, GRASS } from '../src/world.js';
import { Inventory } from '../src/inventory.js';
import {
  buildSnapshot, parseSnapshot, encodeEdits, decodeEdits, migrateV1Edits,
} from '../src/savegame.js';
import { normalise, DEFAULTS } from '../src/settings.js';
import { smoothDistance, ViewController } from '../src/view.js';
import { wrapAngle, approachAngle } from '../src/player-model.js';
import { THIRD_PERSON_MIN, THIRD_PERSON_MAX, VIEW_FIRST } from '../src/constants.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

// ---------------------------------------------------------------- savegame
{
  const world = new World(1, { flat: 3 });
  world.setBlock(70, 6, 70, GRASS);
  world.setBlock(-70, 3, -12, AIR); // negative coordinates must survive too
  assert('edits are recorded', world.edits.size === 2, world.edits.size);

  const inv = new Inventory();
  inv.fillStarterKit([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  inv.select(4);
  const player = { pos: { x: 1.5, y: 4, z: 2.5 }, yaw: 1.2, pitch: -0.3 };

  const snap = buildSnapshot({ world, inventory: inv, player, viewMode: 2 });
  const round = parseSnapshot(JSON.parse(JSON.stringify(snap)));
  assert('snapshot round-trips', round !== null);
  assert('not flagged as migrated', round.migrated === false);
  assert('edits survive', round.edits.length === 2, round.edits.length);
  assert('inventory survives', round.inventory.slots[0].count === 64 && round.inventory.selected === 4);
  assert('position survives', Math.abs(round.player.x - 1.5) < 1e-9 && Math.abs(round.player.yaw - 1.2) < 1e-9);
  assert('view mode survives', round.view === 2, round.view);

  // replaying the edits onto a fresh world reproduces it exactly
  const fresh = new World(1, { flat: 3 });
  fresh.applyEdits(round.edits);
  assert('replayed world matches',
    fresh.get(70, 6, 70) === GRASS && fresh.get(-70, 3, -12) === AIR,
    `${fresh.get(70, 6, 70)}/${fresh.get(-70, 3, -12)}`);

  // rejections
  assert('null save rejected', parseSnapshot(null) === null);
  assert('unknown version rejected', parseSnapshot({ ...snap, version: 99 }) === null);

  const dirty = parseSnapshot({ ...snap, edits: [1, 2, 3, 999, 4, -5, 6, 1, 7, 8, 9, 2] });
  assert('malformed edits dropped', dirty.edits.length === 1 && dirty.edits[0].id === 2,
    JSON.stringify(dirty.edits));

  const junkInv = parseSnapshot(
    { ...snap, inventory: { slots: ['x', [3, 0], [2, 5], null], selected: 'nope' } }
  );
  assert('malformed stacks become empty slots',
    junkInv.inventory.slots[0] === null && junkInv.inventory.slots[1] === null &&
    junkInv.inventory.slots[2].count === 5, JSON.stringify(junkInv.inventory.slots.slice(0, 3)));
  assert('bad selected index falls back to 0', junkInv.inventory.selected === 0);
}

// version 1 saves came from the old finite 128x128x32 world
{
  const v1 = {
    version: 1,
    size: 128,
    layers: 32,
    // index = y*128*128 + z*128 + x  ->  (5, 2, 3) and (127, 0, 127)
    edits: [2 * 16384 + 3 * 128 + 5, 4, 127 * 128 + 127, 7],
    inventory: { slots: [[1, 10]], selected: 0 },
    player: { x: 64.5, y: 4, z: 64.5, yaw: 0, pitch: 0 },
    view: 1,
  };
  const parsed = parseSnapshot(v1);
  assert('v1 saves are migrated, not discarded', parsed !== null && parsed.migrated === true);
  assert('v1 indices become coordinates',
    parsed.edits.some((e) => e.x === 5 && e.y === 2 && e.z === 3 && e.id === 4),
    JSON.stringify(parsed.edits));
  assert('v1 inventory survives the upgrade', parsed.inventory.slots[0].count === 10);

  const direct = migrateV1Edits([2 * 16384 + 3 * 128 + 5, 4]);
  assert('migrateV1Edits is exact',
    direct.length === 1 && direct[0].x === 5 && direct[0].y === 2 && direct[0].z === 3);
  assert('migrate survives garbage', migrateV1Edits('nope').length === 0);
}

// encode/decode on their own
{
  const flat = encodeEdits([{ x: 1, y: 2, z: 3, id: 4 }, { x: -5, y: 6, z: -7, id: 8 }]);
  assert('encode is flat quadruples', flat.join(',') === '1,2,3,4,-5,6,-7,8', flat.join(','));
  assert('decode pairs up', decodeEdits(flat).length === 2);
  assert('decode survives garbage', decodeEdits('nope').length === 0);
  assert('decode drops a partial trailing record', decodeEdits([1, 2, 3]).length === 0);
}

// ---------------------------------------------------------------- settings
{
  assert('defaults when nothing stored', normalise(null).sensitivity === DEFAULTS.sensitivity);
  assert('high sensitivity clamped', normalise({ sensitivity: 99 }).sensitivity === 3,
    normalise({ sensitivity: 99 }).sensitivity);
  assert('low fov clamped', normalise({ fov: 1 }).fov === 50, normalise({ fov: 1 }).fov);
  assert('NaN falls back to the default', normalise({ sensitivity: 'abc' }).sensitivity === 1);
  assert('booleans coerced', normalise({ invertY: 'yes' }).invertY === true);
  assert('unknown keys ignored', normalise({ hacks: true }).hacks === undefined);
}

// ------------------------------------------------------- camera smoothing
{
  // pulling in past an obstacle is immediate, easing back out is gradual
  assert('snaps inward', smoothDistance(4, 1.2, 0.016) === 1.2);
  const out = smoothDistance(1.2, 4, 0.016);
  assert('eases outward', out > 1.2 && out < 1.4, out.toFixed(3));
  let d = 1.2;
  for (let i = 0; i < 200; i++) d = smoothDistance(d, 4, 0.016);
  assert('reaches the target eventually', Math.abs(d - 4) < 1e-9, d);
}

// --------------------------------------------------------------- view zoom
{
  const v = new ViewController();
  assert('starts in first person', v.mode === VIEW_FIRST && v.isFirstPerson);
  assert('cycle wraps through three views',
    v.cycle() === 1 && v.cycle() === 2 && v.cycle() === 0, v.mode);
  for (let i = 0; i < 40; i++) v.zoom(1);
  assert('zoom in stops at the minimum', v.distance === THIRD_PERSON_MIN, v.distance);
  for (let i = 0; i < 60; i++) v.zoom(-1);
  assert('zoom out stops at the maximum', v.distance === THIRD_PERSON_MAX, v.distance);
}

// ------------------------------------------------------- avatar body turn
{
  assert('wrap keeps small angles', Math.abs(wrapAngle(0.5) - 0.5) < 1e-9);
  assert('wrap folds past pi', Math.abs(wrapAngle(Math.PI * 1.5) + Math.PI / 2) < 1e-9, wrapAngle(Math.PI * 1.5));
  assert('wrap folds negatives', Math.abs(wrapAngle(-Math.PI * 1.5) - Math.PI / 2) < 1e-9);

  // turning takes the short way round: from 170° to -170° is +20°, not -340°
  const from = (170 * Math.PI) / 180;
  const to = (-170 * Math.PI) / 180;
  const next = approachAngle(from, to, 1, 0.05);
  assert('turns the short way', next > from || next < -Math.PI + 0.4, next.toFixed(3));
  assert('never overshoots', Math.abs(wrapAngle(approachAngle(0, 0.01, 10, 1) - 0.01)) < 1e-9);
  assert('a zero rate holds still', approachAngle(1, 2, 0, 0.5) === 1);

  // repeated steps converge
  let a = 0;
  for (let i = 0; i < 100; i++) a = approachAngle(a, 2, 9, 0.016);
  assert('converges on the target', Math.abs(a - 2) < 1e-6, a.toFixed(4));
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
