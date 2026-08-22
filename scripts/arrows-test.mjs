// Arrows: the projectile rules, checked the way the rest of this game's are —
// a fake world of a floor and air, targets as plain boxes, and the physics
// rate the game actually runs at.
//
// The rules worth protecting here are the ones whose failure is silent:
//
//   * An arrow falls under Minecraft's gravity and stops at the floor — a
//     shot that never comes down is a laser, not an arrow.
//   * A shot at a body hits it; a shot past it does not, and the box test is
//     the same slab arithmetic the crosshair uses.
//   * The owner is immune for a quarter second, or a shot fired while walking
//     forward connects with your own back.
//   * An arrow that hits nothing expires after a minute rather than existing
//     forever out past the render distance.
//   * aimAt points a velocity at a target, so a standing skeleton can hit you
//     and a moving one must lead you.

import {
  Arrows, Arrow, aimAt, arrowHitsBox,
  ARROW_GRAVITY, ARROW_SPEED, ARROW_DAMAGE, ARROW_TTL, ARROW_IGNORE_SECONDS,
} from '../src/arrows.js';
import { STONE, AIR, WATER } from '../src/terrain.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A world solid below y=0 and air above it — the same stub mobs-test uses. */
function makeWorld() {
  const world = {
    get(x, y, z) { return y < 0 ? STONE : AIR; },
    isSolid(x, y, z) { return y < 0; },
  };
  return world;
}

/** Run `seconds` of flight at the game's physics rate. */
function run(arrows, seconds, world, targets, step = 1 / 120) {
  const events = [];
  for (let t = 0; t < seconds; t += step) {
    events.push(...arrows.update(step, world, targets));
  }
  return events;
}

// ------------------------------------------------------------- the constants
{
  assert('an arrow falls at Minecraft\u2019s 20 blocks/s\u00b2', ARROW_GRAVITY === 20);
  assert('and flies faster than a sprint', ARROW_SPEED > 5.612);
  assert('a skeleton\u2019s arrow hits for 3', ARROW_DAMAGE === 3);
  assert('an arrow lives a minute', ARROW_TTL === 60);
  assert('the owner is immune for a quarter second', ARROW_IGNORE_SECONDS === 0.25);
}

// ------------------------------------------------------------ the box test
{
  const box = { x: 0, y: 0, z: 0, width: 0.6, height: 1.8 };
  assert('a point inside the box is a hit', arrowHitsBox(0, 0.5, 0, box));
  assert('a point beside it is not', !arrowHitsBox(0.5, 0.5, 0, box));
  assert('a point above it is not', !arrowHitsBox(0, 2.0, 0, box));
  assert('a point at the feet is', arrowHitsBox(0, 0, 0, box));
}

// ---------------------------------------------------------------- the flight
{
  // Shot flat, it drops: the floor is at y=0 (solid below), so a shot from
  // y=1.5 with no vertical speed lands in about 0.39 s and a few blocks out.
  const world = makeWorld();
  const arrows = new Arrows();
  const a = arrows.shoot(0, 1.5, 0, ARROW_SPEED, 0, 0, {});
  assert('shooting returns the arrow', a !== null);
  const events = run(arrows, 1, world, []);
  assert('a flat shot comes down and sticks', events.some((e) => e.type === 'hitBlock'),
    JSON.stringify(events.map((e) => e.type)));
  assert('...and it is gone afterwards', arrows.count === 0);

  // A body in the way catches it before the floor does.
  const arrows2 = new Arrows();
  const target = { x: 5, y: 0, z: 0, width: 0.6, height: 1.8, ref: { name: 'zombie' } };
  arrows2.shoot(0, 1.5, 0, ARROW_SPEED, 0, 0, {});
  const ev2 = run(arrows2, 0.5, world, [target]);
  assert('a shot at a body hits it',
    ev2.some((e) => e.type === 'hitEntity' && e.ref === target.ref), JSON.stringify(ev2.map((e) => e.type)));

  // The owner is immune for the first blink: an arrow fired from a body's own
  // position straight at itself must not count in that window.
  const arrows3 = new Arrows();
  const self = { x: 0, y: 0, z: 0, width: 0.6, height: 1.8, ref: 'me' };
  arrows3.shoot(0, 0.5, 0, 0, 0, ARROW_SPEED, { owner: 'me' });
  const ev3 = run(arrows3, ARROW_IGNORE_SECONDS, world, [self]);
  assert('the owner cannot be hit in the ignore window',
    !ev3.some((e) => e.type === 'hitEntity' && e.ref === 'me'));
}

// ------------------------------------------------------------------- aimAt
{
  const aim = aimAt(0, 1, 0, 0, 1, 5);
  assert('aimAt points a velocity at the target',
    aim.vx === 0 && Math.abs(aim.vy) < 1e-9 && near(aim.vz, ARROW_SPEED));
  const diag = aimAt(0, 0, 0, 3, 0, 4);
  const len = Math.hypot(diag.vx, diag.vy, diag.vz);
  assert('...at the arrow\u2019s speed whatever the direction', near(len, ARROW_SPEED));
  assert('...and in the target\u2019s direction', near(diag.vx / diag.vz, 3 / 4));
}

// ---------------------------------------------------------------- the cap
{
  const arrows = new Arrows({ cap: 3 });
  arrows.shoot(0, 1, 0, 1, 0, 0);
  arrows.shoot(0, 1, 0, 1, 0, 0);
  arrows.shoot(0, 1, 0, 1, 0, 0);
  assert('the population caps', arrows.shoot(0, 1, 0, 1, 0, 0) === null && arrows.count === 3);
}

// ---------------------------------------------------------------- the ttl
{
  const world = makeWorld();
  const arrows = new Arrows();
  // Shot straight up with barely enough speed to never come down within a
  // minute is not possible; instead verify the ttl gate directly: age the
  // arrow past its life and confirm it expires even in open air.
  const a = new Arrow(0, 100, 0, 0, 0, 0, {});
  a.age = ARROW_TTL;
  arrows.list.push(a);
  const ev = run(arrows, 0.1, world, []);
  assert('an aged arrow expires', ev.some((e) => e.type === 'expire') && arrows.count === 0);
}

// Water is not solid: an arrow passes through it (it may sink in Minecraft's
// water, but it never *stops* at the surface).
{
  const world = {
    get(x, y, z) { return y < 0 ? STONE : (y < 5 ? WATER : AIR); },
    isSolid(x, y, z) { return y < 0; },
  };
  const arrows = new Arrows();
  arrows.shoot(0, 6, 0, 0, 0, ARROW_SPEED, {});
  const ev = run(arrows, 0.2, world, []);
  assert('water does not stop an arrow',
    !ev.some((e) => e.type === 'hitBlock'), JSON.stringify(ev.map((e) => e.type)));
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
