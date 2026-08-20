// Dropped items: physics, pickup, merging, despawn, eviction.
//
// Pure — a fake world of a floor at y=0 and whatever else a test wants, and a
// fake player who is a position. No THREE, no DOM.
//
// The rules worth protecting here are the ones whose failure is silent and
// expensive:
//
//   * A drop must not fall through the floor. Anything that tunnels is a
//     diamond you mined and cannot have.
//   * A drop must come to rest. A bounce that keeps too much energy is an
//     item that jitters on the ground forever and never settles.
//   * A full inventory must leave the remainder on the floor, not eat it.
//     This is the entire reason the feature exists.
//   * Two tools must never merge, because merging means one durability
//     number survives and the other is invented.
//   * A thrown item must not come straight back to you, which is the only
//     thing standing between "drop" and "a key that does nothing".

import {
  Drop, Drops, popFromBlock, throwAlong,
  DROP_GRAVITY, DROP_DRAG, BOUNCE, GROUND_FRICTION,
  WATER_SINK, WATER_DRAG, DROP_RADIUS, DROP_HEIGHT,
  PICKUP_RADIUS, MAGNET_RADIUS, MAGNET_SPEED,
  DESPAWN_SECONDS, PICKUP_DELAY, MERGE_RADIUS, MERGE_INTERVAL,
  BOB_HEIGHT, BOB_RATE, SPIN_RATE, LAND_SOUND_SPEED,
} from '../src/drops.js';
import { STONE, DIRT, COBBLESTONE, WATER, AIR } from '../src/terrain.js';
import { PICKAXE, DIAMOND_PICKAXE, COAL, DIAMOND, IRON_INGOT } from '../src/items.js';
import { Inventory, STACK_MAX } from '../src/inventory.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

/** A world that is solid below y=0 and whatever the test puts in `blocks`. */
function makeWorld(blocks = {}) {
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    blocks,
    get(x, y, z) {
      const b = blocks[key(x, y, z)];
      if (b !== undefined) return b;
      return y < 0 ? STONE : AIR;
    },
    isSolid(x, y, z) {
      const b = this.get(x, y, z);
      return b !== AIR && b !== WATER;
    },
    set(x, y, z, id) { blocks[key(x, y, z)] = id; },
  };
}

const makePlayer = (x, y, z) => ({ pos: { x, y, z }, height: 1.8 });

/** Run `seconds` of simulation in 1/120s steps, the game's physics rate. */
function simulate(drops, world, seconds, player = null, collect = null, step = 1 / 120) {
  for (let t = 0; t < seconds; t += step) drops.update(step, world, player, collect);
}

// ----------------------------------------------------------- the drop itself
{
  const d = new Drop(1.5, 4, 2.5, COBBLESTONE, 3);
  assert('a drop remembers what it is', d.id === COBBLESTONE && d.count === 3);
  assert('...and where it is', d.x === 1.5 && d.y === 4 && d.z === 2.5);
  assert('a fresh drop is not collectable yet', d.pickupIn === PICKUP_DELAY);
  assert('...and starts still', d.vx === 0 && d.vy === 0 && d.vz === 0);
  assert('a stack drop carries no durability', d.toStack().durability === undefined);
  assert('...and the stack is what the inventory wants',
    d.toStack().id === COBBLESTONE && d.toStack().count === 3);

  const tool = new Drop(0, 0, 0, PICKAXE, 1, 96);
  assert('a tool drop keeps its wear', tool.toStack().durability === 96);

  const a = new Drop(0, 0, 0, DIRT);
  const b = new Drop(0, 0, 0, DIRT);
  assert('every drop gets its own key', a.key !== b.key);
  assert('...and its own bob phase (a pile does not pulse in lockstep)',
    a.phase !== b.phase);
}

// --------------------------------------------------------------- the shoves
{
  // A deterministic "random" so the pop can be checked exactly.
  const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const d = popFromBlock(new Drop(0, 0, 0, DIRT), seq(0, 0, 0));
  assert('a mined block pops upward', d.vy > 1.5, d.vy);
  assert('...and not very fast sideways', Math.hypot(d.vx, d.vz) < 1, Math.hypot(d.vx, d.vz));

  let maxH = 0;
  for (let i = 0; i < 200; i++) {
    const p = popFromBlock(new Drop(0, 0, 0, DIRT));
    maxH = Math.max(maxH, Math.hypot(p.vx, p.vz));
    assert.silent = true;
  }
  assert('the scatter stays gentle over many pops', maxH < 1.2, maxH);

  const t = throwAlong(new Drop(0, 0, 0, DIRT), { x: 1, y: 0, z: 0 });
  assert('a throw goes where you look', t.vx > 4 && Math.abs(t.vz) < 1e-9, t.vx);
  assert('...with a lob on it', t.vy > 0, t.vy);
  assert('...and waits longer before it can be picked back up',
    t.pickupIn > PICKUP_DELAY, t.pickupIn);

  const back = throwAlong(new Drop(0, 0, 0, DIRT), { x: 0, y: 0, z: -1 });
  assert('a throw the other way goes the other way', back.vz < -4, back.vz);
  const up = throwAlong(new Drop(0, 0, 0, DIRT), { x: 0, y: 1, z: 0 });
  assert('a throw straight up goes up', up.vy > 5 && Math.abs(up.vx) < 1e-9);
}

// -------------------------------------------------------------- the physics
{
  const world = makeWorld();
  const drops = new Drops();
  const d = drops.add(4.5, 8, 4.5, COBBLESTONE);
  simulate(drops, world, 4);

  assert('a drop falls', d.y < 8);
  assert('...and lands on top of the floor, not in it', d.y >= 0 - 1e-6, d.y);
  assert('...and comes to rest there', Math.abs(d.y - 0) < 0.01, d.y);
  assert('...and stops moving', Math.abs(d.vy) < 0.01, d.vy);
  assert('a drop that fell straight down did not wander', Math.abs(d.x - 4.5) < 1e-6);
  assert('...and knows it is on the ground', d.onGround);

  // The tunnelling case: dropped from very high, so it is moving fast when it
  // meets the floor. A naive integrator steps straight past it.
  const fast = new Drops();
  const f = fast.add(2.5, 120, 2.5, DIRT);
  simulate(fast, world, 12);
  assert('a drop from a great height still lands on the floor',
    f.y >= -1e-6 && f.y < 0.5, f.y);

  // Even at a coarse step it must not fall through. The loop runs at a fixed
  // 1/120, but a tab that was in the background hands the first frame back a
  // much bigger dt.
  const coarse = new Drops();
  const c = coarse.add(2.5, 40, 2.5, DIRT);
  simulate(coarse, world, 8, null, null, 1 / 10);
  assert('...and does not tunnel at a coarse timestep', c.y >= -1e-6, c.y);
}

// ------------------------------------------------------------- walls, floors
{
  //   .#.     A drop shoved east into a wall must stop at the wall, and it
  //   x>#     must not end up inside it.
  const world = makeWorld();
  world.set(6, 0, 4, STONE);
  const drops = new Drops();
  const d = drops.add(4.5, 0.5, 4.5, DIRT);
  d.vx = 9;
  simulate(drops, world, 3);
  assert('a drop stops at a wall', d.x < 6, d.x);
  assert('...outside it', !world.isSolid(Math.floor(d.x), Math.floor(d.y), Math.floor(d.z)));

  // Friction: a drop sliding along a floor must stop, and reasonably soon.
  const slide = new Drops();
  const s = slide.add(0.5, 0.001, 0.5, DIRT);
  s.vx = 6;
  simulate(slide, world, 3);
  assert('a drop sliding on the ground stops', Math.abs(s.vx) < 0.02, s.vx);
  assert('...within a few blocks', s.x < 4, s.x);

  // Bounce: it must lose almost everything, so nothing jitters forever.
  const bounce = new Drops();
  const b = bounce.add(0.5, 10, 0.5, DIRT);
  simulate(bounce, world, 6);
  assert('a bounce dies out', Math.abs(b.vy) < 0.01, b.vy);
  assert('the bounce coefficient is small enough to settle', BOUNCE < 0.3, BOUNCE);
}

// ------------------------------------------------------------- landing sound
{
  const world = makeWorld();

  // Dropped from a height: one audible landing, and only one, even though it
  // bounces several times on the way to settling.
  const drops = new Drops();
  drops.add(4.5, 12, 4.5, COBBLESTONE);
  let audible = 0;
  let loudest = 0;
  for (let t = 0; t < 6; t += 1 / 120) {
    drops.update(1 / 120, world);
    const v = drops.loudestLanding();
    if (v) { audible++; loudest = Math.max(loudest, v); }
  }
  assert('a drop landing makes a sound', audible >= 1, audible);
  assert('...but the bounces afterwards do not', audible === 1, audible);
  assert('...and a long fall lands hard', loudest > 8, loudest.toFixed(1));

  // A block popping out of the cell it was mined from is below the
  // threshold: the break sound is already covering it.
  const gentle = new Drops();
  const g = gentle.spawnFromBlock(4, 0, 4, DIRT, 1, undefined, () => 0.5);
  let quiet = 0;
  for (let t = 0; t < 3; t += 1 / 120) {
    gentle.update(1 / 120, world);
    if (gentle.loudestLanding()) quiet++;
  }
  assert('a mined block settling makes no thud of its own', quiet === 0, quiet);

  // But a block that fell off a cliff does.
  const cliff = new Drops();
  cliff.add(4.5, 6, 4.5, DIRT);
  let heard = 0;
  for (let t = 0; t < 4; t += 1 / 120) {
    cliff.update(1 / 120, world);
    if (cliff.loudestLanding()) heard++;
  }
  assert('a block that fell does thud', heard === 1, heard);

  // Water swallows it.
  const pool = makeWorld();
  for (let y = 0; y < 6; y++) pool.set(3, y, 3, WATER);
  const wet = new Drops();
  wet.add(3.5, 5.5, 3.5, DIAMOND);
  let splashes = 0;
  for (let t = 0; t < 8; t += 1 / 120) {
    wet.update(1 / 120, pool);
    if (wet.loudestLanding()) splashes++;
  }
  assert('a drop settling underwater is silent', splashes === 0, splashes);

  // The rule that makes one landing one sound, checked at the worst case
  // there is. Drag caps a falling drop at terminal velocity — gravity over
  // drag — so nothing can ever hit the ground faster than that however far it
  // fell, and the hardest bounce possible is BOUNCE of it. That has to stay
  // under the threshold, or a drop from high enough re-arms its own latch on
  // the way back up and thuds twice.
  const terminal = DROP_GRAVITY / DROP_DRAG;
  assert('nothing can fall faster than terminal velocity', terminal === 40, terminal);
  assert('no bounce can be loud enough to re-arm the sound',
    terminal * BOUNCE < LAND_SOUND_SPEED, `${(terminal * BOUNCE).toFixed(1)} vs ${LAND_SOUND_SPEED}`);

  // And the other end: the threshold must be low enough that an ordinary
  // two-block fall is still audible, or the sound never plays at all.
  assert('a two-block fall clears the threshold',
    Math.sqrt(2 * DROP_GRAVITY * 2) > LAND_SOUND_SPEED,
    Math.sqrt(2 * DROP_GRAVITY * 2).toFixed(1));
  assert('an empty world reports no landing', new Drops().loudestLanding() === 0);
}

// --------------------------------------------------------------------- water
{
  //  A pool of water four deep. A drop in it must sink slowly, not plummet.
  const world = makeWorld();
  for (let y = 0; y < 4; y++) world.set(3, y, 3, WATER);
  const drops = new Drops();
  const d = drops.add(3.5, 3.5, 3.5, DIAMOND);
  drops.update(1 / 120, world, null, null);
  assert('a drop in water knows it', d.inWater);

  const dry = new Drops();
  const air = dry.add(3.5, 9, 3.5, DIAMOND);
  simulate(dry, world, 0.5);
  simulate(drops, world, 0.5);
  assert('...and sinks far more slowly than it falls',
    Math.abs(d.vy) < Math.abs(air.vy) / 4, `${d.vy} vs ${air.vy}`);
  assert('water sinking is gentler than gravity', WATER_SINK < DROP_GRAVITY / 10);
  assert('water drags harder than air', WATER_DRAG > DROP_DRAG);

  // Thrown into water it should not keep its speed.
  const thrown = new Drops();
  const t = thrown.add(3.5, 3.5, 3.5, DIAMOND);
  t.vx = 8;
  simulate(thrown, world, 1.5);
  assert('water kills a thrown item\'s speed', Math.abs(t.vx) < 1, t.vx);
}

// -------------------------------------------------------------- pickup rules
{
  const world = makeWorld();
  const drops = new Drops();
  const player = makePlayer(4.5, 0, 4.5);
  let taken = 0;
  const collect = (d) => { taken += d.count; return d.count; };

  const d = drops.add(4.6, 0.2, 4.6, COBBLESTONE, 5);

  // The delay: for the first half-second it is standing right on top of it
  // and must not be picked up.
  simulate(drops, world, PICKUP_DELAY * 0.6, player, collect);
  assert('a fresh drop is not collected during its delay', taken === 0, taken);
  assert('...and is still there', drops.count === 1);

  simulate(drops, world, 0.6, player, collect);
  assert('...and is collected once the delay is up', taken === 5, taken);
  assert('...and is gone from the world', drops.count === 0);
  assert('...and marked dead so the renderer lets go', d.dead);

  // Distance: something across the room stays where it is.
  const far = new Drops();
  far.add(40, 0.2, 40, COBBLESTONE);
  let farTaken = 0;
  simulate(far, world, 2, player, (x) => { farTaken += x.count; return x.count; });
  assert('a drop across the room is not collected', farTaken === 0);
  assert('...and stays on the floor', far.count === 1);

  // The magnet: just outside pickup range but inside the ring, it must come
  // to you rather than sit there.
  const magnet = new Drops();
  const m = magnet.add(4.5 + (PICKUP_RADIUS + MAGNET_RADIUS) / 2, 0.2, 4.5, COAL);
  const start = m.x;
  simulate(magnet, world, 0.6, player, () => 0);
  assert('a drop in the magnet ring flies toward you', m.x < start - 0.05,
    `${start} -> ${m.x}`);
  assert('the magnet ring is bigger than the pickup radius', MAGNET_RADIUS > PICKUP_RADIUS);

  // And it has to actually *arrive*, promptly, from rest on the ground.
  //
  // This is the regression that caught the first implementation: the pull was
  // applied as velocity, and an item lying on the floor is under a friction
  // of GROUND_FRICTION per second which cancelled almost all of it. The item
  // did creep toward you — the assertion above passed — but it took the best
  // part of a minute to cross two blocks, so in practice items at the edge of
  // the ring simply never came. Anything slower than a second here is broken.
  // Placed by true 3D distance: the pull is measured to a point 40% up the
  // player's body, so a drop MAGNET_RADIUS away *horizontally* is already
  // outside the ring.
  const chest = 1.8 * 0.4;
  const edge = Math.sqrt(MAGNET_RADIUS * MAGNET_RADIUS - chest * chest) - 0.05;
  const settled = new Drops();
  const g = settled.add(4.5 + edge, 0.0, 4.5, COAL);
  g.pickupIn = 0;
  simulate(settled, world, 3);            // let it come to rest first
  assert('...even one resting on the ground', settled.count === 1 && g.onGround);
  let got = 0;
  let elapsed = 0;
  for (; elapsed < 5 && got === 0; elapsed += 1 / 120) {
    settled.update(1 / 120, world, player, (d) => { got += d.count; return d.count; });
  }
  assert('a drop at the edge of the ring reaches you', got === 1, `after ${elapsed.toFixed(2)}s`);
  assert('...within a second, not a minute', elapsed < 1, elapsed.toFixed(2));
  assert('...faster than walking there would be',
    elapsed < (MAGNET_RADIUS - PICKUP_RADIUS) / (MAGNET_SPEED * 0.5), elapsed.toFixed(2));

  // Outside the ring: no pull at all.
  const still = new Drops();
  const s = still.add(4.5 + MAGNET_RADIUS + 1, 0.2, 4.5, COAL);
  const sx = s.x;
  simulate(still, world, 1, player, () => 0);
  assert('a drop outside the ring is not pulled', Math.abs(s.x - sx) < 1e-6);
}

// --------------------------------- a full inventory leaves the rest behind
{
  // The headline rule. Fill an inventory to the brim with cobblestone but
  // leave one slot with room for 4 more, then walk over a stack of 30.
  const world = makeWorld();
  const inv = new Inventory();
  for (let i = 0; i < inv.slots.length; i++) inv.set(i, { id: COBBLESTONE, count: STACK_MAX });
  inv.set(0, { id: COBBLESTONE, count: STACK_MAX - 4 });

  const drops = new Drops();
  drops.add(4.6, 0.2, 4.6, COBBLESTONE, 30);
  const player = makePlayer(4.5, 0, 4.5);
  const collect = (d) => {
    const before = inv.countOf(d.id);
    inv.add(d.id, d.count, d.durability);
    return inv.countOf(d.id) - before;
  };
  simulate(drops, world, 2, player, collect);

  assert('a nearly-full inventory takes what fits', inv.countOf(COBBLESTONE) === inv.slots.length * STACK_MAX,
    inv.countOf(COBBLESTONE));
  assert('...and the rest stays on the floor', drops.count === 1, drops.count);
  assert('...with exactly the remainder in it', drops.items[0].count === 26,
    drops.items[0].count);

  // Completely full: nothing is taken and nothing is destroyed.
  let before = drops.items[0].count;
  simulate(drops, world, 2, player, collect);
  assert('a full inventory takes nothing', drops.items[0].count === before, drops.items[0].count);
  assert('...and destroys nothing', drops.count === 1);

  // Make room and it goes in.
  inv.set(5, null);
  simulate(drops, world, 2, player, collect);
  assert('making room lets the rest be collected', drops.count === 0, drops.count);
}

// -------------------------------------------------------------------- merging
{
  const world = makeWorld();
  const drops = new Drops();
  // A dug seam: ten separate stacks of one, all in the same place.
  for (let i = 0; i < 10; i++) drops.add(4.5 + i * 0.02, 0.2, 4.5, COBBLESTONE, 1);
  assert('ten mined blocks start as ten drops', drops.count === 10);
  simulate(drops, world, MERGE_INTERVAL * 3);
  assert('...and fold into one', drops.count === 1, drops.count);
  assert('...keeping every item', drops.items[0].count === 10, drops.items[0].count);

  // Different things do not merge.
  const mixed = new Drops();
  mixed.add(1.5, 0.2, 1.5, COBBLESTONE, 1);
  mixed.add(1.5, 0.2, 1.5, DIRT, 1);
  simulate(mixed, world, MERGE_INTERVAL * 3);
  assert('unlike items do not merge', mixed.count === 2, mixed.count);

  // Far apart, they do not merge.
  const apart = new Drops();
  apart.add(1.5, 0.2, 1.5, COBBLESTONE, 1);
  apart.add(1.5 + MERGE_RADIUS * 3, 0.2, 1.5, COBBLESTONE, 1);
  simulate(apart, world, MERGE_INTERVAL * 3);
  assert('drops far apart do not merge', apart.count === 2, apart.count);

  // TOOLS NEVER MERGE. Two pickaxes at different wear in the same spot must
  // stay two pickaxes, or one of those durability numbers is fiction.
  const tools = new Drops();
  tools.add(1.5, 0.2, 1.5, PICKAXE, 1, 200);
  tools.add(1.5, 0.2, 1.5, PICKAXE, 1, 40);
  simulate(tools, world, MERGE_INTERVAL * 4);
  assert('two tools never merge', tools.count === 2, tools.count);
  const wear = tools.items.map((d) => d.durability).sort((a, b) => a - b);
  assert('...and each keeps its own wear', wear[0] === 40 && wear[1] === 200, wear.join('/'));

  // A tool and a stack of the same id — still no merge.
  const half = new Drops();
  half.add(1.5, 0.2, 1.5, PICKAXE, 1, 200);
  half.add(1.5, 0.2, 1.5, PICKAXE, 1);
  simulate(half, world, MERGE_INTERVAL * 3);
  assert('a worn tool does not absorb a fresh one', half.count === 2, half.count);

  // The stack ceiling holds: 100 coal in one place is 64 + 36, not 100.
  const big = new Drops();
  for (let i = 0; i < 100; i++) big.add(2.5, 0.2, 2.5, COAL, 1);
  simulate(big, world, MERGE_INTERVAL * 6);
  const total = big.items.reduce((n, d) => n + d.count, 0);
  assert('merging respects the stack ceiling',
    big.items.every((d) => d.count <= STACK_MAX), big.items.map((d) => d.count).join('/'));
  assert('...and loses nothing', total === 100, total);
  assert('...folding a hundred singles into two stacks', big.count === 2, big.count);
}

// -------------------------------------------------------------------- despawn
{
  const world = makeWorld();
  const drops = new Drops();
  drops.add(4.5, 0.2, 4.5, DIRT);
  // Straight to just before the deadline in one big step, then over it.
  drops.update(DESPAWN_SECONDS - 1, world);
  assert('a drop survives to just before five minutes', drops.count === 1);
  drops.update(2, world);
  assert('...and pops after it', drops.count === 0);
  assert('...and is counted', drops.despawned === 1);
  assert('five minutes is Minecraft\'s number', DESPAWN_SECONDS === 300);
}

// ------------------------------------------------------------------- eviction
{
  const drops = new Drops();
  drops.add(0, 0.2, 0, DIRT);
  drops.add(10, 0.2, 0, DIRT);
  drops.add(300, 0.2, 0, DIRT);
  drops.add(0, 0.2, -400, DIRT);
  const gone = drops.evictOutside(0, 0, 64);
  assert('drops outside the loaded radius are evicted', gone === 2, gone);
  assert('...and the near ones stay', drops.count === 2);
  assert('...and height is ignored (it is a chunk radius, not a sphere)',
    drops.items.every((d) => Math.hypot(d.x, d.z) <= 64));

  // `near` is the query the debug screen uses.
  const q = new Drops();
  q.add(0, 0, 0, DIRT);
  q.add(1, 0, 0, DIRT);
  q.add(20, 0, 0, DIRT);
  assert('near() finds what is near', q.near(0, 0, 0, 2).length === 2);
  assert('...and nothing else', q.near(0, 0, 0, 0.5).length === 1);
  assert('...and is spherical', q.near(0, 0, 0, 100).length === 3);
}

// ------------------------------------------------------------------ the cap
{
  const drops = new Drops({ max: 8 });
  for (let i = 0; i < 40; i++) drops.add(i, 0, 0, DIRT);
  assert('the population is capped', drops.count === 8, drops.count);
  assert('...and the overflow is refused, not thrown', drops.add(0, 0, 0, DIRT) === null);
  drops.clear();
  assert('clear empties it', drops.count === 0);

  assert('a zero-count drop is refused', new Drops().add(0, 0, 0, DIRT, 0) === null);
  assert('an air drop is refused', new Drops().add(0, 0, 0, AIR) === null);

  // spawnFromBlock centres it in the cell it came from and gives it a pop.
  const s = new Drops();
  const d = s.spawnFromBlock(7, 3, 9, COBBLESTONE, 1, undefined, () => 0.5);
  assert('a mined block pops from the middle of its cell',
    d.x === 7.5 && d.z === 9.5, `${d.x},${d.z}`);
  assert('...at about its middle height', d.y > 3 && d.y < 4, d.y);
  assert('...moving', d.vy > 0);
}

// --------------------------------------------------------------- bob and spin
{
  const d = new Drop(0, 0, 0, DIRT);
  d.phase = 0;
  const a = Drops.bob(d, 0);
  const b = Drops.bob(d, Math.PI / (2 * BOB_RATE));
  assert('the bob starts at the middle', Math.abs(a.lift) < 1e-9, a.lift);
  assert('...and rises to its peak', Math.abs(b.lift - BOB_HEIGHT) < 1e-9, b.lift);
  assert('the bob stays small', Math.abs(Drops.bob(d, 12.34).lift) <= BOB_HEIGHT + 1e-9);

  assert('the spin advances', Drops.bob(d, 1).spin > Drops.bob(d, 0).spin);
  assert('...and wraps', Drops.bob(d, 1e6).spin < Math.PI * 2 + 1e-9);

  // Same clock, same answer — no hidden state, which is what lets a paused
  // game freeze the animation by simply not advancing the clock.
  assert('bob is pure', Drops.bob(d, 3.5).lift === Drops.bob(d, 3.5).lift);
  const e = new Drop(0, 0, 0, DIRT);
  e.phase = 1;
  assert('two drops with different phases do not bob together',
    Drops.bob(d, 1).lift !== Drops.bob(e, 1).lift);
}

// ---------------------------------------------- a round trip through the world
{
  // Mine a block, let it settle, walk over it, and it must be in the bag with
  // the right count — the whole loop the feature replaced.
  const world = makeWorld();
  const inv = new Inventory();
  const drops = new Drops();
  drops.spawnFromBlock(4, 0, 4, COBBLESTONE, 1);
  simulate(drops, world, 2);
  assert('a mined block settles on the floor', drops.count === 1 && drops.items[0].onGround);

  const player = makePlayer(4.5, 0, 4.5);
  const collect = (d) => {
    const before = inv.countOf(d.id);
    inv.add(d.id, d.count, d.durability);
    return inv.countOf(d.id) - before;
  };
  simulate(drops, world, 1, player, collect);
  assert('...and walking over it picks it up', inv.countOf(COBBLESTONE) === 1);
  assert('...and it is gone', drops.count === 0);

  // Throw a worn pickaxe away and pick it up: the wear must survive.
  const t = drops.add(4.5, 0.5, 4.5, PICKAXE, 1, 77);
  throwAlong(t, { x: 0, y: 0, z: 0 }, 0);
  simulate(drops, world, 3, player, (d) => {
    const slot = inv.slots.findIndex((s) => !s);
    if (slot < 0) return 0;
    inv.set(slot, d.toStack());
    return d.count;
  });
  assert('a thrown tool can be picked back up', drops.count === 0);
  const back = inv.slots.find((s) => s && s.id === PICKAXE);
  assert('...with its wear intact, not repaired', back && back.durability === 77,
    back ? back.durability : 'missing');
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
