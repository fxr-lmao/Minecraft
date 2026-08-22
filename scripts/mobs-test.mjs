// Mobs: the simulation rules, checked the way the rest of this game's are —
// a fake world of a floor and whatever a test wants in it, a player who is
// a position, and the physics rate the game actually runs at.
//
// The rules worth protecting here are the ones whose failure is silent:
//
//   * The speeds are the wiki's, converted. A zombie that walks at the
//     player's pace is a zombie you can never escape and never have to
//     fear, and both of those are the game broken in opposite directions.
//   * A mob must not fall through the floor, must stop falling at the
//     floor, and must pay Minecraft's fall-damage tariff when it lands.
//   * The hurt window is a floor, not a wall: identical hits inside it are
//     free, a bigger one pays the difference. Both halves matter — without
//     the first a held button is a blender, without the second nothing
//     could ever finish a mob that two things were hitting.
//   * A creeper must explode exactly once, exactly 1.5 s after it starts,
//     only with line of sight, and must unwind when you leave. A creeper
//     that blows instantly or never is not a creeper, it is a bug with a
//     texture.
//   * Nothing may spawn within 24 blocks of the player, at night, on solid
//     dry ground — and the daylight surface must spawn nothing at all,
//     because "nothing appears next to you in broad daylight" is the whole
//     reason a night is frightening.
//   * Zombies burn at dawn, exposed, and not in water or rain. This is the
//     rule that ends every night, and it has to end it reliably.

import {
  Mobs, Mob, moveMob, rayHitsMob, pickMob, playerAttack, attackDamage,
  MOB_FACTS, ZOMBIE, CREEPER, SKELETON, SPIDER, PIG, COW, CHICKEN, SHEEP,
  ZOMBIE_SPEED, CREEPER_SPEED, SKELETON_SPEED, SPIDER_SPEED,
  HURT_IFRAME, KNOCKBACK, KNOCKBACK_SPRINT,
  SWELL_RANGE, FUSE_SECONDS, CANCEL_RANGE, CREEPER_BLAST_RADIUS,
  SKELETON_RANGE_MIN, SKELETON_RANGE_MAX, SKELETON_SHOT_INTERVAL,
  SPIDER_LEAP_RANGE, SPIDER_LEAP_COOLDOWN,
  SPAWN_MIN, SPAWN_MAX, SPAWN_INTERVAL, DESPAWN_RANGE, MAX_MOBS,
  PASSIVE_CAP, PANIC_SECONDS, NIGHT_SUN, BURN_SUN,
} from '../src/mobs.js';
import {
  IRON_SWORD, WOOD_SWORD, STONE_SWORD, DIAMOND_SWORD, IRON_AXE, WOOD_AXE,
  PICKAXE, SHOVEL, BUCKET, GUNPOWDER, ROTTEN_FLESH, COAL,
  BONE, ARROW, STRING, SPIDER_EYE, RAW_PORKCHOP, RAW_BEEF, RAW_MUTTON, FEATHER,
} from '../src/items.js';
import { STONE, DIRT, WATER, AIR, GRASS } from '../src/terrain.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const near = (a, b, pct) => Math.abs(a - b) <= Math.abs(b) * pct;

// ------------------------------------------------------------ the fake world

/**
 * A world that is solid below `floor`, air above it, plus whatever the test
 * puts in `blocks`. `heightAt` has the real one's meaning: the y of the
 * top solid block in the column, because spawning, burning and cave-finding
 * all ask it exactly that.
 */
function makeWorld({ floor = 0, blocks = new Map(), minY = -64, maxY = 80 } = {}) {
  const key = (x, y, z) => `${x},${y},${z}`;
  const world = {
    blocks,
    minY,
    maxY,
    get(x, y, z) {
      const b = blocks.get(key(x, y, z));
      if (b !== undefined) return b;
      return y < floor ? STONE : AIR;
    },
    isSolid(x, y, z) {
      const b = this.get(x, y, z);
      return b !== AIR && b !== WATER;
    },
    inBounds(x, y, z) {
      return y >= minY && y <= maxY;
    },
    heightAt(x, z) {
      for (let y = maxY; y >= minY; y--) {
        if (this.isSolid(x, y, z)) return y;
      }
      return minY - 1;
    },
    set(x, y, z, id) {
      blocks.set(key(x, y, z), id);
    },
  };
  return world;
}

/** Run `seconds` of world at the game's physics rate. */
function run(mobs, seconds, world, player, ctx = {}, step = 1 / 120) {
  const events = [];
  for (let t = 0; t < seconds; t += step) {
    events.push(...mobs.update(step, world, player, ctx));
  }
  return events;
}

/** A water column: floor at `floor`, water filling `depth` cells above it. */
function waterWorld(depth = 4, floor = 0) {
  const blocks = new Map();
  for (let y = floor; y < floor + depth; y++) {
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) blocks.set(`${x},${y},${z}`, WATER);
    }
  }
  return makeWorld({ floor, blocks });
}

// ------------------------------------------------------------ the constants

{
  assert('zombie speed is the attribute squared × 43.17',
    near(ZOMBIE_SPEED, 2.28, 0.02), ZOMBIE_SPEED.toFixed(3));
  assert('creeper speed likewise',
    near(CREEPER_SPEED, 2.70, 0.02), CREEPER_SPEED.toFixed(3));
  assert('a zombie is slower than a walking player',
    ZOMBIE_SPEED < 4.317 && CREEPER_SPEED < 4.317);
  assert('a creeper is a shade faster than a zombie',
    CREEPER_SPEED > ZOMBIE_SPEED);

  const z = MOB_FACTS[ZOMBIE];
  assert('zombie: 20 hp, hits for 3 (Normal), tracks to 40',
    z.health === 20 && z.damage === 3 && z.followRange === 40);
  assert('zombie: the Java hitbox, 0.6 × 1.95',
    z.width === 0.6 && z.height === 1.95);
  assert('zombie: drops rotten flesh 0–2, pays 5 xp',
    z.drops[0].id === ROTTEN_FLESH && z.drops[0].min === 0 && z.drops[0].max === 2 && z.xp === 5);
  assert('zombie is the one that burns', z.burns === true);

  const c = MOB_FACTS[CREEPER];
  assert('creeper: 20 hp, the usual 16-block notice',
    c.health === 20 && c.followRange === 16);
  assert('creeper: 0.6 × 1.7, drops gunpowder 0–2, pays 5 xp',
    c.width === 0.6 && c.height === 1.7
    && c.drop.id === GUNPOWDER && c.drop.min === 0 && c.drop.max === 2 && c.xp === 5);
  assert('creepers do not burn', c.burns === false);

  assert('the swell/cancel distances are three and seven',
    SWELL_RANGE === 3 && CANCEL_RANGE === 7);
  assert('the fuse is a second and a half', FUSE_SECONDS === 1.5);
  assert('a creeper crater is a TNT crater', CREEPER_BLAST_RADIUS === 3);
  assert('the hurt window is ten ticks', HURT_IFRAME === 0.5);
  assert('knockback is 0.4 blocks a tick', KNOCKBACK === 8);
}

// ------------------------------------------------------- the damage table

{
  assert('a fist is 1', attackDamage(0) === 1);
  assert('a block in the hand is a fist',
    attackDamage(DIRT) === 1 && attackDamage(BUCKET) === 1);
  assert('coal is a fist', attackDamage(COAL) === 1);
  assert('wooden sword 4', attackDamage(WOOD_SWORD) === 4);
  assert('stone sword 5', attackDamage(STONE_SWORD) === 5);
  assert('iron sword 6', attackDamage(IRON_SWORD) === 6);
  assert('diamond sword 7', attackDamage(DIAMOND_SWORD) === 7);
  assert('axes hit like axes: wood 3, iron 5',
    attackDamage(WOOD_AXE) === 3 && attackDamage(IRON_AXE) === 5);
  assert('the pickaxe is a clumsy weapon: iron 4',
    attackDamage(PICKAXE) === 4 && attackDamage(SHOVEL) === 4);
  assert('a sword is never merely a fist', attackDamage(IRON_SWORD) > attackDamage(IRON_AXE));
}

// ------------------------------------------------------------- ray picking

{
  const mob = new Mob(ZOMBIE, 0, 0, -5); // box x∈[-0.3,0.3], y∈[0,1.95], z∈[-5.3,-4.7]
  const eye = { x: 0, y: 1, z: 0 };

  const hit = rayHitsMob(mob, eye, { x: 0, y: 0, z: -1 });
  assert('a square ray hits the zombie box', hit !== null);
  assert('...at the distance to its near face', near(hit, 4.7, 0.01), hit?.toFixed(3));

  const miss = rayHitsMob(mob, eye, { x: 1, y: 0, z: 0 });
  assert('a parallel ray outside the box misses', miss === null);
  const over = rayHitsMob(mob, eye, { x: 0, y: 1, z: -1 });
  assert('a ray over its head misses', over === null);

  // pickMob: nearest of several, dead ones ignored, distance respected.
  const near1 = new Mob(ZOMBIE, 0, 0, -3);
  const near2 = new Mob(CREEPER, 0, 0, -6);
  const dead = new Mob(ZOMBIE, 0, 0, -4);
  dead.kill('player');
  const pick = pickMob([near2, dead, near1], eye, { x: 0, y: 0, z: -1 }, 10);
  assert('pickMob returns the nearest mob', pick?.mob === near1);
  assert('pickMob reports the distance', near(pick.dist, 2.7, 0.01), pick?.dist.toFixed(3));
  assert('pickMob ignores the dead', pick?.mob !== dead);
  assert('pickMob honours the reach', pickMob([near1], eye, { x: 0, y: 0, z: -1 }, 2) === null);
  assert('pickMob normalises its direction',
    pickMob([near1], eye, { x: 0, y: 0, z: -5 }, 10)?.mob === near1);
  assert('pickMob picks the creeper nearer than the zombie',
    pickMob([near2, near1], eye, { x: 0, y: 0, z: -1 }, 10)?.mob === near1);
  // A ray that starts inside a box connects at once — the "0.5" case.
  assert('a ray from inside the box hits at zero',
    close(rayHitsMob(near1, { x: 0, y: 1, z: -3 }, { x: 0, y: 0, z: -1 }) ?? -1, 0, 1e-6));
}

// ------------------------------------------------- hurt, immunity, knockback

{
  const mob = new Mob(ZOMBIE, 0, 0, 0);
  assert('a fresh mob is at full health', mob.health === 20);
  const r1 = mob.hurt(6, { kx: 1, kz: 0 });
  assert('the first hit lands', r1 === 'hit');
  assert('...and costs its damage', mob.health === 14, mob.health);
  assert('the hit knocked it along the shove', near(mob.vx, KNOCKBACK, 0.01), mob.vx.toFixed(2));

  // Inside the window: same size is free, bigger pays the difference.
  const r2 = mob.hurt(6, { kx: 1, kz: 0 });
  assert('an identical hit inside the window is immune', r2 === 'immune');
  assert('...and costs nothing', mob.health === 14, String(mob.health));
  const r3 = mob.hurt(9, { kx: 1, kz: 0 });
  assert('a bigger hit inside the window lands', r3 === 'hit');
  assert('...but only for the difference', mob.health === 11, String(mob.health));

  // Let the window close; everything lands in full again.
  mob.sinceHurt = HURT_IFRAME;
  mob.hurt(6, { kx: 1, kz: 0 });
  assert('after the window closes, hits land in full', mob.health === 5, String(mob.health));

  mob.sinceHurt = HURT_IFRAME;
  const died = mob.hurt(6, { kx: 1, kz: 0 });
  assert('the hit that empties the bar is a death', died === 'died');
  assert('...by the player, and the clock starts', mob.dead && mob.deathBy === 'player');
  assert('a corpse cannot be hit again', mob.hurt(6, {}) === 'immune');
  assert('a corpse is immune to more of everything', mob.health <= 0);

  // Knockback details.
  const m2 = new Mob(ZOMBIE, 0, 0, 0);
  m2.onGround = true;
  m2.hurt(1, { kx: 0, kz: 1, sprinting: true });
  assert('a sprint hit throws at the sprint strength',
    near(m2.vz, KNOCKBACK_SPRINT, 0.01), m2.vz.toFixed(2));
  assert('a grounded mob pops up when hit', m2.vy > 0, m2.vy.toFixed(2));
  const m3 = new Mob(ZOMBIE, 0, 5, 0);
  m3.onGround = false;
  m3.vy = -3;
  m3.hurt(1, { kx: 1, kz: 0 });
  assert('an airborne mob is not lifted by a hit', m3.vy === -3);

  // Being hit is being noticed.
  const m4 = new Mob(ZOMBIE, 0, 0, 0);
  m4.aggro = false;
  m4.hurt(1, {});
  assert('a hit rouses a mob that had not seen you', m4.aggro === true);
}

// ------------------------------------------------------------ falling & rest

{
  const world = makeWorld(); // solid below y=0
  // A bystander 113 blocks off: inside the 128-block despawn horizon, well
  // outside the 40 a zombie cares about — the mob ignores it and falls.
  const player = { x: 80, y: 0.001, z: 80 };
  const mobs = new Mobs({ rand: () => 0.5 });
  const mob = mobs.spawn(ZOMBIE, 0.5, 10, 0.5);
  run(mobs, 4, world, player, { sun: 0 });

  assert('a mob falls to the floor and stops on it',
    close(mob.y, 0.001, 0.01), mob.y.toFixed(4));
  assert('...and does not fall through', mob.y >= 0, mob.y.toFixed(4));
  assert('...and knows it is standing', mob.onGround === true);
  assert('a ten-block fall costs seven hit points (three are free)',
    mob.health === 20 - 7, String(mob.health));

  const mob2 = mobs.spawn(ZOMBIE, 0.5, 3, 0.5);
  run(mobs, 3, world, player, { sun: 0 });
  assert('a three-block fall is free', mob2.health === 20, String(mob2.health));

  // Terminal velocity: the world's own cap.
  const mob3 = mobs.spawn(ZOMBIE, 0.5, 79, 0.5);
  mobs.update(1 / 120, world, player, { sun: 0 });
  let minVy = 0;
  for (let i = 0; i < 120; i++) {
    mobs.update(1 / 120, world, player, { sun: 0 });
    minVy = Math.min(minVy, mob3.dead ? minVy : mob3.vy);
    if (mob3.dead) break;
  }
  assert('nothing falls faster than the terminal velocity', minVy >= -78.5, minVy.toFixed(1));
}

// ------------------------------------------------------------- zombie chase

{
  const world = makeWorld();
  const player = { x: 0, y: 0.001, z: 0 };
  const mobs = new Mobs({ rand: () => 0.5 });
  const mob = mobs.spawn(ZOMBIE, 0.5, 0.001, 20.5);
  run(mobs, 0.1, world, player, { sun: 0 });

  assert('a zombie in sight acquires its target', mob.hasTarget === true);
  assert('...and chases', mob.state === 'chase');

  // Approach speed, measured rather than assumed: it should settle at the
  // wiki's 2.28 blocks/s, not the player's 4.3.
  run(mobs, 3, world, player, { sun: 0 });
  const before = mob.z;
  run(mobs, 2, world, player, { sun: 0 });
  const speed = (before - mob.z) / 2;
  assert('a zombie closes at its own speed, not the player\u2019s',
    speed > ZOMBIE_SPEED * 0.8 && speed < ZOMBIE_SPEED * 1.2, speed.toFixed(2));

  // Arrives, and swings: one attack a second, for 3.
  run(mobs, 8, world, player, { sun: 0 }); // ~13s total at 2.28 b/s over 20
  const events = run(mobs, 3.5, world, player, { sun: 0 });
  const attacks = events.filter((e) => e.type === 'attack');
  assert('a zombie next to you swings', attacks.length >= 2, String(attacks.length));
  assert('every swing is the full Normal-difficulty 3',
    attacks.every((a) => a.damage === 3));
  assert('the epitaph is written', attacks[0].cause === 'slain by a zombie');
  assert('the swings are a second apart, not a stream',
    attacks.length <= 4, String(attacks.length));

  // Too far to touch: no attacks, just the walk.
  const far = { x: 0, y: 0.001, z: -60 };
  const mobs2 = new Mobs({ rand: () => 0.5 });
  const z2 = mobs2.spawn(ZOMBIE, 0.5, 0.001, -65.5); // five and a half off
  const ev2 = run(mobs2, 1.2, world, far, { sun: 0 });
  assert('a zombie four blocks away does not swing',
    ev2.filter((e) => e.type === 'attack').length === 0);
  assert('...but it does keep coming', z2.hasTarget === true);
}

// --------------------------------------------------------------------- hops

{
  // A one-block step between the zombie and the player.
  const world = makeWorld();
  for (let x = -3; x <= 3; x++) world.set(x, 0, 5, STONE);
  const player = { x: 0, y: 0.001, z: 0 };
  const mobs = new Mobs({ rand: () => 0.5 });
  const mob = mobs.spawn(ZOMBIE, 0.5, 0.001, 10.5);
  run(mobs, 10, world, player, { sun: 0 });

  assert('a zombie hops a one-block wall and keeps coming',
    mob.z < 5 || mob.y > 0.9, `z=${mob.z.toFixed(2)} y=${mob.y.toFixed(2)}`);
  assert('...on the far side eventually', mob.z < 4.5, mob.z.toFixed(2));

  // A two-block wall stops it — none of them climbs two.
  const world2 = makeWorld();
  for (let x = -3; x <= 3; x++) {
    world2.set(x, 0, 5, STONE);
    world2.set(x, 1, 5, STONE);
  }
  const mobs2 = new Mobs({ rand: () => 0.5 });
  const z2 = mobs2.spawn(ZOMBIE, 0.5, 0.001, 10.5);
  run(mobs2, 10, world2, player, { sun: 0 });
  assert('a zombie cannot climb a two-block wall', z2.z >= 5, z2.z.toFixed(2));
  assert('...and stays interested anyway', z2.hasTarget === true);
}

// ----------------------------------------------------------- climbing walls
//
// The spider's whole reason for existing: a wall stops a zombie and does not
// stop a spider. The trap here is that a climb looks like a taller hop and is
// not one. A hop is an impulse — JUMP_VELOCITY buys 8.95²/2g ≈ 1.25 blocks,
// exactly the one step it is for — while a climb is a *rate*, and handing
// SPIDER_CLIMB_SPEED to gravity as an impulse the same way buys 3.2²/2g ≈
// 0.16 blocks, which is less than a doorstep. Written that way the "climber"
// is worse at walls than the zombie next to it, and every one of these
// passes only because the climb is re-applied while it is still pressing.
{
  // Wide enough that walking around it is not an option — the test is about
  // going *over*, and a mob that strolls past the end of a short wall proves
  // nothing either way.
  const wall = (height) => {
    const w = makeWorld();
    for (let x = -24; x <= 24; x++) {
      for (let y = 0; y < height; y++) w.set(x, y, 5, STONE);
    }
    return w;
  };
  const player = { x: 0, y: 0.001, z: 0 };

  // A mob that has already seen you, walking into the wall between you —
  // aggro is set by hand because a wall that blocks the way also blocks the
  // line of sight, and the question here is what a mob does with a wall, not
  // how it finds you through one.
  const walkInto = (kind, height, seconds) => {
    const w = wall(height);
    const mobs = new Mobs({ rand: () => 0.5 });
    const mob = mobs.spawn(kind, 0.5, 0.001, 10.5);
    mob.aggro = true;
    run(mobs, seconds, w, player, { sun: 0 });
    return mob;
  };

  // One block: the step a zombie hops. A spider must at least manage that.
  const s1 = walkInto(SPIDER, 1, 10);
  assert('a spider gets over a one-block step', s1.z < 4.5, s1.z.toFixed(2));

  // Three blocks: the wall that stops a zombie dead. This is the one that
  // fails if the climb is an impulse rather than a rate.
  const s3 = walkInto(SPIDER, 3, 12);
  assert('a spider climbs a three-block wall a zombie cannot', s3.z < 4.5,
    `z=${s3.z.toFixed(2)} y=${s3.y.toFixed(2)}`);
  const z3 = walkInto(ZOMBIE, 3, 12);
  assert('...and the same wall still stops a zombie', z3.z >= 5, z3.z.toFixed(2));

  // Going up is not coming down: three seconds into a ten-block wall the
  // spider is partway up it and has taken nothing for the trip. (Whatever it
  // does on the far side is a real fall and costs what a real fall costs —
  // the point is that the climb itself is not one.)
  const s10 = walkInto(SPIDER, 10, 3);
  assert('a spider is partway up a ten-block wall after three seconds',
    s10.y > 3, `y=${s10.y.toFixed(2)}`);
  assert('...and the climb itself costs no fall damage',
    s10.health === MOB_FACTS[SPIDER].health && s10.fallDistance === 0,
    `${s10.health}/${MOB_FACTS[SPIDER].health} fallen=${s10.fallDistance.toFixed(2)}`);
}

// ------------------------------------------------------------------- water

{
  const world = waterWorld(4); // water y=0..3, floor below
  // The player stands at the far end of the pool: nothing overhead, and a
  // reason to wade rather than bob.
  const player = { x: 0, y: 0.001, z: -20 };
  const mobs = new Mobs({ rand: () => 0.5 });
  const mob = mobs.spawn(ZOMBIE, 0.5, 6, 8.5);
  run(mobs, 1.5, world, player, { sun: 0 });
  assert('a zombie in water is in water', mob.inWater === true);
  assert('...sinks rather than swims', mob.y < 6, mob.y.toFixed(2));

  run(mobs, 8, world, player, { sun: 0 });
  assert('a zombie walks on the bottom, not the surface', mob.y < 0.5, mob.y.toFixed(2));
  assert('a twenty-block dive into water costs nothing',
    mob.health === 20, String(mob.health));

  // The wade: 0.55 × walking speed, measured mid-journey with the bottom
  // long since reached and the player still far off.
  const before = mob.z;
  run(mobs, 4, world, player, { sun: 0 });
  const speed = (before - mob.z) / 4;
  assert('a zombie wades at a little over half speed',
    speed > ZOMBIE_SPEED * 0.55 * 0.6 && speed < ZOMBIE_SPEED * 0.55 * 1.4,
    speed.toFixed(2));
}

// ----------------------------------------------------------------- creeper

{
  const world = makeWorld();
  const player = { x: 0, y: 0.001, z: 0 };
  const mobs = new Mobs({ rand: () => 0.5 });
  // Inside the sixteen-block notice, outside the three-block swell.
  const mob = mobs.spawn(CREEPER, 0.5, 0.001, 10.5);
  // The approach: it closes until the swell band stops it.
  const ev0 = run(mobs, 4, world, player, { sun: 0 });
  assert('a creeper closes the distance', mob.z < 10.5, mob.z.toFixed(2));
  assert('the swell begins with one hiss, once',
    ev0.filter((e) => e.type === 'sound' && e.name === 'hiss').length === 1);

  // Planted, swelling, still.
  const planted = { x: 0, y: 0.001, z: mob.z - SWELL_RANGE + 0.2 };
  const before = mob.fuse;
  run(mobs, 0.1, world, planted, { sun: 0 });
  assert('the fuse runs while you stand there', mob.fuse > before);
  assert('...and the creeper holds still while it does',
    Math.hypot(mob.vx, mob.vz) < 0.1, Math.hypot(mob.vx, mob.vz).toFixed(3));

  // 1.5 s to detonation — not before, not never.
  const t0 = mob.fuse;
  const stepsForRest = (1 - t0) * FUSE_SECONDS;
  const evA = run(mobs, Math.max(0, stepsForRest - 0.05), world, planted, { sun: 0 });
  assert('a hair before the full fuse there is no explosion',
    evA.filter((e) => e.type === 'explode').length === 0);
  const evB = run(mobs, 0.2, world, planted, { sun: 0 });
  assert('a hair after it, there is', evB.filter((e) => e.type === 'explode').length === 1);
  assert('the detonation is the creeper\u2019s own death',
    mob.dead && mob.deathBy === 'self');
  const evC = run(mobs, 2, world, planted, { sun: 0 });
  assert('a creeper explodes exactly once',
    evC.filter((e) => e.type === 'explode').length === 0);
  const dies = [...evB, ...evC].filter((e) => e.type === 'die');
  assert('its death is announced once, and leaves nothing (by: self)',
    dies.length === 1 && dies[0].by === 'self');

  // Leaving: the fuse unwinds at the rate it wound.
  const mobs2 = new Mobs({ rand: () => 0.5 });
  const c2 = mobs2.spawn(CREEPER, 0.5, 0.001, -3.2);
  run(mobs2, 0.6, world, { x: 0, y: 0.001, z: 0 }, { sun: 0 }); // swell to ~0.4
  const f0 = c2.fuse;
  assert('the fuse is part-run', f0 > 0.1 && f0 < 0.9, f0.toFixed(2));
  run(mobs2, 0.5, world, { x: 0, y: 0.001, z: -20 }, { sun: 0 }); // away, past seven
  assert('out past seven blocks the fuse unwinds', c2.fuse < f0, `${f0.toFixed(2)} → ${c2.fuse.toFixed(2)}`);
  run(mobs2, 2, world, { x: 0, y: 0.001, z: -20 }, { sun: 0 });
  assert('...all the way back to nothing', c2.fuse === 0);
  assert('...and it forgets it ever hissed', c2.hissed === false);

  // Killed mid-fuse: no explosion, ever.
  const mobs3 = new Mobs({ rand: () => 0.5 });
  const c3 = mobs3.spawn(CREEPER, 0.5, 0.001, -2.5);
  run(mobs3, 0.5, world, { x: 0, y: 0.001, z: 0 }, { sun: 0 });
  assert('the fuse is running when the sword arrives', c3.fuse > 0, c3.fuse.toFixed(2));
  // Three swings of seven, each after the window from the last has closed.
  for (let i = 0; i < 3 && !c3.dead; i++) {
    playerAttack(c3, DIAMOND_SWORD, { x: 0, y: 0, z: -1 }, false);
    c3.sinceHurt = HURT_IFRAME;
  }
  const ev3 = run(mobs3, 3, world, { x: 0, y: 0.001, z: 0 }, { sun: 0 });
  assert('a creeper killed mid-fuse never detonates',
    ev3.filter((e) => e.type === 'explode').length === 0 && c3.dead,
    `explodes=${ev3.filter((e) => e.type === 'explode').length} dead=${c3.dead} fuse=${c3.fuse}`);
  assert('a sword death is the player\u2019s doing', c3.deathBy === 'player');

  // No line of sight, no swell — even at arm's length. Four blocks of
  // stone stand between (the creeper is on the far side, pressed to it).
  const worldW = makeWorld();
  for (let x = -8; x <= 8; x++) {
    for (let y = 0; y < 4; y++) worldW.set(x, y, -2, STONE);
  }
  const mobs4 = new Mobs({ rand: () => 0.5 });
  const c4 = mobs4.spawn(CREEPER, 0.5, 0.001, -3.5);
  const ev4 = run(mobs4, 3, worldW, { x: 0.5, y: 0.001, z: 0.5 }, { sun: 0 });
  assert('a creeper behind glass does not hiss',
    ev4.filter((e) => e.type === 'sound' && e.name === 'hiss').length === 0);
  assert('...and its fuse never starts', c4.fuse === 0);
}

// ------------------------------------------------------------ the sword

{
  const mob = new Mob(ZOMBIE, 0, 0, 0);
  const look = { x: 0, y: 0, z: -1 };
  let r = playerAttack(mob, IRON_SWORD, look, false);
  assert('an iron sword takes six off a zombie', mob.health === 14 && r.result === 'hit');
  // The window makes the rhythm: an immediate second swing is a whiff.
  r = playerAttack(mob, IRON_SWORD, look, false);
  assert('the next swing inside the window whiffs', r.result === 'immune');
  mob.sinceHurt = HURT_IFRAME;
  playerAttack(mob, IRON_SWORD, look, false);
  mob.sinceHurt = HURT_IFRAME;
  playerAttack(mob, IRON_SWORD, look, false);
  assert('three swings leave it at two', mob.health === 2, String(mob.health));
  mob.sinceHurt = HURT_IFRAME;
  r = playerAttack(mob, IRON_SWORD, look, false);
  assert('the fourth finishes it', r.result === 'died');

  // Knockback along the swing.
  const m2 = new Mob(ZOMBIE, 0, 0, -3);
  m2.onGround = true;
  playerAttack(m2, IRON_SWORD, { x: 0, y: 0, z: -1 }, false);
  assert('the hit shoves the mob away from you', m2.vz < 0, m2.vz.toFixed(2));
  assert('...at Minecraft\u2019s strength', near(Math.abs(m2.vz), KNOCKBACK, 0.1), m2.vz.toFixed(2));
  const m3 = new Mob(ZOMBIE, 3, 0, 0);
  m3.onGround = true;
  playerAttack(m3, IRON_SWORD, { x: 1, y: 0, z: 0 }, true);
  assert('a sprint hit throws it harder',
    near(m3.vx, KNOCKBACK_SPRINT, 0.1), m3.vx.toFixed(2));

  // A wooden sword needs five swings for a zombie; verify the ladder.
  const tiers = [[WOOD_SWORD, 4], [STONE_SWORD, 5], [IRON_SWORD, 6], [DIAMOND_SWORD, 7]];
  for (const [sword, dmg] of tiers) {
    const m = new Mob(ZOMBIE, 0, 0, 0);
    playerAttack(m, sword, { x: 0, y: 0, z: -1 }, false);
    assert(`${dmg}-damage sword takes ${dmg} off`, m.health === 20 - dmg, String(m.health));
  }
}

// --------------------------------------------------------------- explosions

{
  const mobs = new Mobs({ rand: () => 0.5 });
  const nearMob = mobs.spawn(ZOMBIE, 0.5, 0.001, 2.5);
  const farMob = mobs.spawn(ZOMBIE, 8.5, 0.001, 0.5);
  const dead = mobs.explosionDamage(0.5, 0.9, 0.5, CREEPER_BLAST_RADIUS);

  assert('a mob beside the blast dies', dead.includes(nearMob) && nearMob.dead);
  assert('...and it was the blast that did it', nearMob.deathBy === 'blast');
  assert('a mob six blocks out survives', !farMob.dead);
  assert('the blast shoves harder than a sword',
    Math.hypot(nearMob.vx, nearMob.vz) > KNOCKBACK,
    Math.hypot(nearMob.vx, nearMob.vz).toFixed(2));

  // Falloff: closer hurts more, provably.
  const a = new Mobs({ rand: () => 0.5 });
  const mA = a.spawn(ZOMBIE, 0.5, 0.001, 1.5);
  const b = new Mobs({ rand: () => 0.5 });
  const mB = b.spawn(ZOMBIE, 0.5, 0.001, 3.5);
  a.explosionDamage(0.5, 0.9, 0.5, CREEPER_BLAST_RADIUS);
  b.explosionDamage(0.5, 0.9, 0.5, CREEPER_BLAST_RADIUS);
  assert('damage falls off with distance', mA.health < mB.health,
    `${mA.health} vs ${mB.health}`);
}

// ---------------------------------------------------------------- spawning

{
  // Night on a flat world, with the dice pinned: every roll is one half, so
  // the ring position, the depth and the kind are all the same every time
  // and the question is arithmetic, not statistics.
  const world = makeWorld();
  const player = { x: 100, y: 0.001, z: 100 };
  const mobs = new Mobs({ rand: () => 0.5, cap: 6 });
  run(mobs, 1.6, world, player, { sun: 0 }); // one spawn interval, no walking

  assert('night fills the ring', mobs.list.length >= 1, String(mobs.list.length));
  assert('...up to the cap and not past it', mobs.list.length <= 6, String(mobs.list.length));
  const dists = mobs.list.map((m) => Math.hypot(m.x - player.x, m.z - player.z));
  assert('nothing spawns inside the 24-block ring',
    dists.every((d) => d >= SPAWN_MIN - 0.75), Math.min(...dists).toFixed(2));
  assert('nothing spawns outside the spawn ring',
    dists.every((d) => d <= SPAWN_MAX + 1.5), Math.max(...dists).toFixed(2));
  assert('every spawned mob is one of the four kinds',
    mobs.list.every((m) => [ZOMBIE, CREEPER, SKELETON, SPIDER].includes(m.kind)));
  assert('the pinned roll makes a spider',
    mobs.list.every((m) => m.kind === SPIDER));

  // Day on the same world (a one-block floor has no underworld): nothing, ever.
  const day = makeWorld();
  const dayMobs = new Mobs({ rand: Math.random });
  run(dayMobs, 20, day, player, { sun: 1 });
  assert('the daytime surface spawns nothing at all',
    dayMobs.list.length === 0, String(dayMobs.list.length));

  // ...but a cave is dark at noon. The pocket sits where the pinned roll's
  // probe lands: angle π, radius 35.2 back from the player, depth −33.
  // The probe lands at y = −33 and walks *down* looking for a floor, so the
  // pocket is the two cells at −34/−33: air with rock under it and over it.
  const cave = makeWorld();
  cave.set(105, -34, 100, AIR);
  cave.set(105, -33, 100, AIR);
  const cavePlayer = { x: 140.5, y: 0.001, z: 100 };
  const caveMobs = new Mobs({ rand: () => 0.5, cap: 4 });
  const spot = caveMobs._caveSpot(cave, cavePlayer);
  assert('the cave finder finds the pocket',
    spot !== null && spot.x === 105.5 && spot.z === 100.5,
    spot ? `${spot.x},${spot.y.toFixed(1)},${spot.z}` : 'null');
  assert('...down where the sun is not', spot !== null && spot.y < 0);
  run(caveMobs, 3, cave, cavePlayer, { sun: 1 });
  assert('a cave spawns in daylight',
    caveMobs.list.length >= 1, String(caveMobs.list.length));
  assert('...and every cave mob is underground',
    caveMobs.list.every((m) => m.y < 0), caveMobs.list.map((m) => m.y.toFixed(1)).join(','));

  // Underground, the 24 blocks have to be measured in three dimensions. The
  // cave ring reaches closer in than the surface one does (a ring the size
  // of the surface's would almost never find a pocket), and the depth
  // usually makes up the difference — but not when you are down there with
  // it, and a zombie appearing fifteen blocks along your own tunnel is the
  // one thing SPAWN_MIN exists to forbid.
  const cavern = {
    // A layer cake: a floor every fourth block, all the way down, so every
    // probe finds somewhere and the distance is the only thing being asked.
    minY: -64,
    get(x, y, z) {
      if (y >= 0) return AIR;
      return y % 4 === 0 ? STONE : AIR;
    },
    isSolid(x, y, z) { return this.get(x, y, z) === STONE; },
    inBounds: (x, y, z) => y >= -64 && y <= 80,
    heightAt: () => -4,
  };
  const spelunker = { x: 0.5, y: -30, z: 0.5 };
  const deep = new Mobs({ rand: Math.random });
  let found = 0;
  let closest = Infinity;
  for (let i = 0; i < 400; i++) {
    const s = deep._caveSpot(cavern, spelunker);
    if (!s) continue;
    found++;
    closest = Math.min(closest,
      Math.hypot(s.x - spelunker.x, s.y - spelunker.y, s.z - spelunker.z));
  }
  assert('a cave has somewhere to put a mob', found > 0, String(found));
  assert('...and never inside the 24-block ring, depth counted in',
    closest >= SPAWN_MIN, closest.toFixed(2));

  // The sea is not a nursery: every spawnable column is water.
  const ocean = {
    // A world that IS the ocean, without spelling out 54,000 cells.
    get(x, y, z) {
      if (y <= 3 && y >= 0) return WATER;
      return y < 0 ? STONE : AIR;
    },
    isSolid(x, y, z) {
      const b = this.get(x, y, z);
      return b !== AIR && b !== WATER;
    },
    inBounds: () => true,
    heightAt: () => -1,
  };
  const seaMobs = new Mobs({ rand: () => 0.5 });
  run(seaMobs, 6, ocean, { x: 0, y: 4.001, z: 0 }, { sun: 0 });
  assert('no mob spawns in the ocean',
    seaMobs.list.length === 0, String(seaMobs.list.length));

  // The cap is hard.
  const capWorld = makeWorld();
  const capMobs = new Mobs({ rand: Math.random, cap: 3 });
  for (let i = 0; i < 5; i++) capMobs.spawn(ZOMBIE, 200 + i, 0.001, 200);
  run(capMobs, 10, capWorld, { x: 0, y: 0.001, z: 0 }, { sun: 0 });
  assert('the population never passes its cap', capMobs.list.length <= 3,
    String(capMobs.list.length));
}

// ---------------------------------------------------------------- despawning

{
  const world = makeWorld();
  const far = { x: 0, y: 0.001, z: 0 };
  const mobs = new Mobs({ rand: () => 0.5, cap: 10 });
  const m = mobs.spawn(ZOMBIE, 200.5, 0.001, 0.5);
  mobs.update(1 / 120, world, far, { sun: 0 });
  assert('a mob 200 blocks out is gone at once',
    !mobs.list.includes(m), String(mobs.list.length));

  // Soft despawn: past 32, uninterested, and the dice say go.
  const soft = new Mobs({ rand: () => 0, cap: 10 }); // rand 0: every roll says yes
  const m2 = soft.spawn(ZOMBIE, 40.5, 0.001, 0.5);
  soft.update(1 / 120, world, far, { sun: 0 });
  assert('an uninteresting mob past 32 despawns on the roll',
    !soft.list.includes(m2));

  const keep = new Mobs({ rand: () => 0, cap: 10 });
  const m3 = keep.spawn(ZOMBIE, 20.5, 0.001, 0.5);
  keep.update(1 / 120, world, far, { sun: 0 });
  assert('...but a mob inside 32 stays', keep.list.includes(m3));

  const busy = new Mobs({ rand: () => 0, cap: 10 });
  const m4 = busy.spawn(ZOMBIE, 36.5, 0.001, 0.5); // past 32, inside 40
  m4.hasTarget = true;
  busy.update(1 / 120, world, far, { sun: 0 });
  assert('...and so does one with a target', busy.list.includes(m4));

  // Eviction on chunk move, like the drops.
  const ev = new Mobs({ rand: () => 0.5 });
  ev.spawn(ZOMBIE, 0.5, 0.001, 0.5);
  ev.spawn(ZOMBIE, 100.5, 0.001, 0.5);
  ev.evictOutside(0, 0, 64);
  assert('eviction keeps the near and forgets the far',
    ev.list.length === 1 && ev.list[0].x < 1);
}

// -------------------------------------------------------------------- burning

{
  const world = makeWorld(); // heightAt = -1: standing at 0.001 is exposed
  const player = { x: 0, y: 0.001, z: 0 };
  const mobs = new Mobs({ rand: Math.random });
  const mob = mobs.spawn(ZOMBIE, 5.5, 0.001, 5.5);
  const ev = run(mobs, 4, world, player, { sun: 0.8 });
  assert('an exposed zombie burns at dawn', mob.burning > 0 || mob.dead);
  assert('fire costs a hit point a second', mob.health <= 16 + 1e-9, String(mob.health));
  assert('burning makes itself known', ev.some((e) => e.type === 'burn'));

  // The end of a long enough dawn.
  run(mobs, 25, world, player, { sun: 0.8 });
  assert('a burning zombie does not survive the morning', mob.dead);
  assert('...and the fire gets the credit', mob.deathBy === 'burn');

  // In water: no fire. Under a roof: no fire. In rain: no fire.
  const wet = waterWorld(2);
  const wetMobs = new Mobs({ rand: () => 0.5 });
  const w = wetMobs.spawn(ZOMBIE, 0.5, 0.5, 0.5);
  run(wetMobs, 3, wet, { x: 0, y: 0.5, z: 0 }, { sun: 1 });
  assert('a wet zombie does not burn', w.burning === 0 && w.health === 20);

  const roofed = makeWorld();
  roofed.set(5, 1, 5, STONE); // one block overhead
  const roofMobs = new Mobs({ rand: () => 0.5 });
  const r = roofMobs.spawn(ZOMBIE, 5.5, 0.001, 5.5);
  run(roofMobs, 3, roofed, player, { sun: 1 });
  assert('a zombie under a block does not burn', r.burning === 0 && r.health === 20);

  const rainMobs = new Mobs({ rand: () => 0.5 });
  const rn = rainMobs.spawn(ZOMBIE, 5.5, 0.001, 5.5);
  run(rainMobs, 3, world, player, { sun: 1, rain: 0.6 });
  assert('rain puts a stop to it', rn.burning === 0 && rn.health === 20);

  const cMobs = new Mobs({ rand: () => 0.5 });
  const c = cMobs.spawn(CREEPER, 5.5, 0.001, 5.5);
  run(cMobs, 3, world, player, { sun: 1 });
  assert('a creeper is above all this', c.burning === 0 && c.health === 20);
}

// ---------------------------------------------------------- creative & events

{
  const world = makeWorld();
  const player = { x: 0, y: 0.001, z: 0 };
  const mobs = new Mobs({ rand: () => 0.5 });
  const z = mobs.spawn(ZOMBIE, 0.5, 0.001, -2.5);
  const ev = run(mobs, 3, world, player, { sun: 0, creative: true });
  assert('a creative player is beneath a zombie\u2019s notice',
    z.hasTarget === false && z.state !== 'chase');
  assert('...and is never swung at', ev.filter((e) => e.type === 'attack').length === 0);

  // A death is announced exactly once, however it happened.
  const d = mobs.spawn(ZOMBIE, -5.5, 0.001, -5.5);
  d.kill('fall');
  const evd = run(mobs, 0.1, world, player, { sun: 0 });
  const dieEvents = evd.filter((e) => e.type === 'die' && e.mob === d);
  assert('a death is announced once', dieEvents.length === 1);
  run(mobs, 2, world, player, { sun: 0 });
  assert('...and never again', dieEvents.length === 1);

  // A zombie somewhere near makes a noise now and then; a creeper never does.
  const noisy = new Mobs({ rand: () => 0.99, cap: 4 });
  noisy.spawn(ZOMBIE, 2.5, 0.001, -2.5);
  const evn = run(noisy, 30, world, player, { sun: 0.2 });
  assert('a nearby zombie groans',
    evn.some((e) => e.type === 'sound' && e.name === 'zombie'));
  const quiet = new Mobs({ rand: () => 0.99, cap: 4 });
  quiet.spawn(CREEPER, 2.5, 0.001, -2.5);
  const evq = run(quiet, 30, world, player, { sun: 0.2 });
  assert('a creeper has no idle sound at all',
    !evq.some((e) => e.type === 'sound' && e.name === 'zombie'));

  // The night threshold itself.
  assert('the sun that counts as night', NIGHT_SUN === 0.25);
  assert('the sun that lights a zombie', BURN_SUN === 0.55);
  assert('the interval the world spawns on', SPAWN_INTERVAL === 1);
  assert('the despawn horizon is Minecraft\u2019s', DESPAWN_RANGE === 128);
  assert('the default cap is the renderer\u2019s budget, not Minecraft\u2019s 70',
    MAX_MOBS === 16);
}

// --------------------------------------------------------------------- moveMob

{
  // Directly, for the geometry: the box slides along a wall and stops flush.
  const world = makeWorld();
  for (let z = -20; z <= 5; z++) world.set(3, 0, z, STONE); // wall at x=3
  const mob = new Mob(ZOMBIE, 1.5, 0.001, -10);
  mob.vx = 2.28;
  mob.vy = 0;
  mob.vz = 0;
  for (let i = 0; i < 240; i++) moveMob(mob, 1 / 120, world);
  assert('a mob slides up to a wall and stops flush',
    mob.x < 3 - mob.halfWidth + 0.05 && mob.x > 2.2, mob.x.toFixed(3));
  assert('...and the wall eats the velocity', Math.abs(mob.vx) < 0.01);

  // A head bump kills upward motion cleanly.
  const low = makeWorld();
  low.set(0, 2, 0, STONE); // ceiling at y=2 (mob is 1.95 tall: 1.95+0.001 < 2 fits… barely not)
  low.set(1, 2, 0, STONE);
  const tall = new Mob(ZOMBIE, 0.5, 0.001, 0.5);
  tall.vy = 8.95;
  tall.vx = 0;
  tall.vz = 0;
  for (let i = 0; i < 60; i++) moveMob(tall, 1 / 120, low);
  assert('a mob that stands under a low ceiling stops rising',
    tall.y < 2 - 1.95 + 0.05 && tall.vy === 0, `${tall.y.toFixed(3)} ${tall.vy}`);
}

// ------------------------------------------------------------- the models
//
// The simulation is pure, but the models are three-dimensional and the one
// thing a mesher cannot do by looking at it is fail. So the same way the
// held-item tests build every item and inspect it, this builds both mobs
// under a stubbed canvas and checks the shapes: nothing taller than the
// hitbox it collides as, nothing wider, everything casting a shadow (a mob
// that doesn't is pasted onto the world rather than standing in it), and
// every animated state actually moving something.

{
  // A canvas that can be painted on (fillRect/fillStyle) and nothing else —
  // the textures only need a 2D context's raster surface, never a GPU.
  class Ctx {
    constructor() { this.fillStyle = '#000'; }
    fillRect() {}
  }
  class Canvas {
    constructor() { this.width = 8; this.height = 8; this._ctx = new Ctx(); }
    getContext() { return this._ctx; }
  }
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? new Canvas() : {}),
    createElementNS: (ns, tag) => (tag === 'canvas' ? new Canvas() : {}),
  };

  const { createZombieModel, createCreeperModel } = await import('../src/mob-models.js');
  const { ZOMBIE: Z, CREEPER: C } = await import('../src/mobs.js');

  const bounds = (model) => {
    model.group.updateMatrixWorld(true);
    const axes = ['x', 'y', 'z'];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    model.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      for (let i = 0; i < 3; i++) {
        const a = axes[i];
        min[i] = Math.min(min[i], o.matrixWorld.elements[12 + i] + b.min[a]);
        max[i] = Math.max(max[i], o.matrixWorld.elements[12 + i] + b.max[a]);
      }
    });
    return { min, max, height: max[1] - min[1], width: Math.max(max[0] - min[0], max[2] - min[2]) };
  };

  const shadows = (model) => {
    let meshes = 0;
    let casters = 0;
    model.group.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      if (o.castShadow) casters++;
    });
    return { meshes, casters };
  };

  const zombie = createZombieModel();
  const creeper = createCreeperModel();

  assert('the zombie model builds', zombie.kind === Z && zombie.group.children.length > 0);
  assert('the creeper model builds', creeper.kind === C && creeper.group.children.length > 0);

  const zb = bounds(zombie);
  assert('the zombie stands as tall as its hitbox',
    zb.height > 1.9 && zb.height <= 1.95 + 0.01, zb.height.toFixed(3));
  // The *model* is 16 skin pixels wide — body 8 plus two arms 4 — which
  // overhangs the 0.6 collision box, and that is Minecraft's own arithmetic:
  // its zombies' arms stick out past their hitbox too (it is why a crowd
  // of them visibly overlaps). What must fit the hitbox is the body.
  assert('...the whole figure is the 16-pixel overhang Minecraft\u2019s is',
    Math.abs(zb.width - 16 * (1.95 / 32)) < 0.02, zb.width.toFixed(3));
  assert('...with its feet at the origin',
    Math.abs(zb.min[1]) < 0.02, zb.min[1].toFixed(3));

  const cb = bounds(creeper);
  assert('the creeper is a 1.7-block figure',
    cb.height > 1.6 && cb.height <= 1.7 + 0.01, cb.height.toFixed(3));
  assert('...and no wider than its hitbox',
    cb.width <= 0.6 + 0.01, cb.width.toFixed(3));

  for (const [name, model] of [['zombie', zombie], ['creeper', creeper]]) {
    const { meshes, casters } = shadows(model);
    assert(`every part of the ${name} casts a shadow`,
      meshes > 0 && meshes === casters, `${casters}/${meshes}`);
  }

  // A walk cycle moves legs; a death tips the body over; a swell grows it;
  // a hit reddens it. Each state, run once, checked for having happened.
  const standing = { x: 0, y: 0, z: 0, yaw: 0, headYaw: 0, headPitch: 0,
    walkPhase: 0, hurtFlash: 0, burning: 0, fuse: 0, dying: -1 };
  const legPivotY = 12 * (1.95 / 32);
  let legSwing = -1;
  zombie.update({ ...standing, walkPhase: Math.PI / 2 });
  zombie.group.children[0].children.forEach((g) => {
    if (g.type === 'Group' && Math.abs(g.position.y - legPivotY) < 0.01) {
      legSwing = Math.max(legSwing, Math.abs(g.rotation.x));
    }
  });
  assert('the walk cycle swings a leg', legSwing > 0.1, legSwing.toFixed(3));

  creeper.update({ ...standing, walkPhase: Math.PI / 2 });
  const before = creeper.group.children[0].scale.x;
  creeper.update({ ...standing, fuse: 1 });
  assert('the swell grows the creeper',
    creeper.group.children[0].scale.x > before + 0.1,
    `${before.toFixed(2)} → ${creeper.group.children[0].scale.x.toFixed(2)}`);

  // ...and comes back down. The scale used to be written only when it was
  // not 1, so a creeper that unwound its fuse — you got away, or you killed
  // it mid-swell, which zeroes the fuse — stayed the size the last swelling
  // frame left it, corpse and all.
  creeper.update({ ...standing, fuse: 0 });
  assert('...and the swell comes back down again',
    Math.abs(creeper.group.children[0].scale.x - 1) < 1e-6,
    creeper.group.children[0].scale.x.toFixed(3));
  creeper.update({ ...standing, fuse: 1 });
  creeper.update({ ...standing, fuse: 0, dying: 0.9 });
  assert('...and a creeper killed mid-swell is buried its own size',
    Math.abs(creeper.group.children[0].scale.x - 1) < 1e-6,
    creeper.group.children[0].scale.x.toFixed(3));

  // Every box a mob is made of comes from the shared cache. This is not a
  // nicety: the renderer disposes a dead mob's *materials* only, on the
  // stated promise that its geometry is shared, so any geometry built
  // per-mob is leaked once per spawn — and a night is a lot of spawns.
  const geometriesOf = (model) => {
    const out = new Set();
    model.group.traverse((o) => { if (o.isMesh) out.add(o.geometry); });
    return out;
  };
  for (const [name, build] of [['zombie', createZombieModel], ['creeper', createCreeperModel]]) {
    const first = geometriesOf(build());
    const second = geometriesOf(build());
    assert(`a second ${name} allocates no geometry of its own`,
      second.size > 0 && [...second].every((g) => first.has(g)),
      `${[...second].filter((g) => first.has(g)).length}/${second.size}`);
  }

  const zRoot = zombie.group.children[0];
  zombie.update({ ...standing, dying: 0.9 });
  const upStraight = zRoot.rotation.z;
  zombie.update({ ...standing, dying: 0.05 });
  assert('death tips the body over',
    Math.abs(zRoot.rotation.z) > Math.abs(upStraight) + 1,
    `${upStraight.toFixed(2)} → ${zRoot.rotation.z.toFixed(2)}`);

  let redness = 0;
  zombie.update({ ...standing, hurtFlash: 1 });
  zombie.group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) redness = Math.max(redness, m.emissive.r - m.emissive.g);
  });
  assert('a hit reddens the whole figure', redness > 0.2, redness.toFixed(3));

  delete globalThis.document;
}

// ------------------------------------------------------- the new kinds\u2019 facts
{
  const s = MOB_FACTS[SKELETON];
  assert('skeleton: 20 hp, the tallest box, and it burns',
    s.health === 20 && s.height === 1.99 && s.burns === true);
  assert('skeleton: drops bone and arrows', s.drops.length === 2
    && s.drops[0].id === BONE && s.drops[1].id === ARROW);

  const sp = MOB_FACTS[SPIDER];
  assert('spider: wide, low, and faster than the rest',
    sp.width > sp.height && SPIDER_SPEED > ZOMBIE_SPEED && SPIDER_SPEED > CREEPER_SPEED);
  assert('spider: climbs and leaps', sp.climber === true && sp.leaper === true);
  assert('spider: drops string and eye', sp.drops.length === 2
    && sp.drops[0].id === STRING && sp.drops[1].id === SPIDER_EYE);

  for (const kind of [PIG, COW, CHICKEN, SHEEP]) {
    assert(`${MOB_FACTS[kind].name}: passive and harmless`,
      MOB_FACTS[kind].passive === true && MOB_FACTS[kind].damage === 0);
  }
  assert('pig drops pork, cow drops beef, sheep drops mutton',
    MOB_FACTS[PIG].drop.id === RAW_PORKCHOP
    && MOB_FACTS[COW].drops[0].id === RAW_BEEF
    && MOB_FACTS[SHEEP].drop.id === RAW_MUTTON);
  assert('chicken drops meat and feathers', MOB_FACTS[CHICKEN].drops.length === 2
    && MOB_FACTS[CHICKEN].drops[1].id === FEATHER);
}

// ------------------------------------------------------ skeleton and spider AI
{
  const world = makeWorld();
  const player = { x: 10, y: 0.001, z: 10 };
  const mobs = new Mobs({ rand: () => 0.5, cap: 4 });

  // A skeleton with a clear line to the player shoots, on a cadence.
  const skel = mobs.spawn(SKELETON, 8, 0.001, 10);
  const ev = run(mobs, 3, world, player, { sun: 0 });
  const shots = ev.filter((e) => e.type === 'shoot');
  assert('a skeleton shoots on sight', shots.length >= 1, String(shots.length));
  assert('...aimed at the player\u2019s eye',
    shots.length > 0 && shots[0].ty > 1.5, shots[0] ? shots[0].ty.toFixed(2) : '');

  // It keeps its distance rather than walking into you: after it has shot
  // once it backs off when you close in, rather than charging.
  const close = new Mobs({ rand: () => 0.5, cap: 4 });
  const skel2 = close.spawn(SKELETON, 10.5, 0.001, 10);
  skel2.attackTimer = 5; // do not shoot, so we see only the movement
  const ev2 = run(close, 0.5, world, player, { sun: 0 });
  assert('a skeleton inside its minimum backs away',
    skel2.x > 10.5, skel2.x.toFixed(2));

  // A spider leaps when close, and never shoots.
  const spmobs = new Mobs({ rand: () => 0.5, cap: 4 });
  const spider = spmobs.spawn(SPIDER, 12.5, 0.001, 10);
  const ev3 = run(spmobs, 3, world, player, { sun: 0 });
  assert('a spider leaps rather than shooting',
    ev3.some((e) => e.type === 'sound' && e.name === 'spiderLeap')
    && !ev3.some((e) => e.type === 'shoot'));
}

// ---------------------------------------------------------------- passives
{
  const world = makeWorld();
  const player = { x: 10, y: 0.001, z: 10 };
  const mobs = new Mobs({ rand: () => 0.5, cap: 4 });
  const pig = mobs.spawn(PIG, 9, 0.001, 10);

  // A pig never hunts: even with the player a block away it has no target.
  run(mobs, 2, world, player, { sun: 1 });
  assert('a passive animal never targets the player', pig.hasTarget === false);

  // ...but hit it and it runs away, and calms down afterwards.
  const before = pig.x;
  pig.hurt(3, { kx: 0, kz: 0 });
  assert('a struck animal panics', pig.panic > 0);
  run(mobs, 0.5, world, player, { sun: 1 });
  assert('...and runs away from the player', pig.x < before, pig.x.toFixed(2));
  run(mobs, PANIC_SECONDS + 1, world, player, { sun: 1 });
  assert('...then calms down', pig.panic === 0);

  // Animals spawn on grass in daylight; the flat stone floor spawns none. A
  // whole-grass surface makes the spawn question deterministic enough to ask.
  const grass = makeWorld();
  grass.get = (x, y, z) => (y === 0 ? GRASS : (y < 0 ? STONE : AIR));
  const dayMobs = new Mobs({ rand: Math.random, cap: 8 });
  run(dayMobs, 20, grass, { x: 0, y: 0.001, z: 0 }, { sun: 1 });
  assert('animals can spawn on grass in daylight', dayMobs.list.length >= 1,
    String(dayMobs.list.length));
}

// ------------------------------------------------------------- the new models
{
  class Ctx {
    constructor() { this.fillStyle = '#000'; }
    fillRect() {}
  }
  class Canvas {
    constructor() { this.width = 8; this.height = 8; this._ctx = new Ctx(); }
    getContext() { return this._ctx; }
  }
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? new Canvas() : {}),
    createElementNS: (ns, tag) => (tag === 'canvas' ? new Canvas() : {}),
  };

  const models = await import('../src/mob-models.js');

  const bounds = (model) => {
    model.group.updateMatrixWorld(true);
    const axes = ['x', 'y', 'z'];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    model.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      for (let i = 0; i < 3; i++) {
        const a = axes[i];
        min[i] = Math.min(min[i], o.matrixWorld.elements[12 + i] + b.min[a]);
        max[i] = Math.max(max[i], o.matrixWorld.elements[12 + i] + b.max[a]);
      }
    });
    return { height: max[1] - min[1], width: Math.max(max[0] - min[0], max[2] - min[2]) };
  };

  for (const [kind, name] of [[SKELETON, 'skeleton'], [SPIDER, 'spider'],
    [PIG, 'pig'], [COW, 'cow'], [CHICKEN, 'chicken'], [SHEEP, 'sheep']]) {
    const model = models.createMobModel(kind);
    assert(`the ${name} model builds`, model.kind === kind && model.group.children.length > 0);
    const b = bounds(model);
    assert(`...and stands no taller than its hitbox (${name})`,
      b.height <= MOB_FACTS[kind].height + 0.15, `${b.height.toFixed(2)} vs ${MOB_FACTS[kind].height}`);
    assert(`...with its feet at the origin (${name})`,
      Math.abs(model.group.children[0].position.y) < 0.01);
    // No per-model geometry: a second build shares every geometry the first
    // allocated, so a night of spawns cannot leak meshes.
    const g1 = new Set();
    model.group.traverse((o) => { if (o.isMesh) g1.add(o.geometry); });
    const g2 = new Set();
    models.createMobModel(kind).group.traverse((o) => { if (o.isMesh) g2.add(o.geometry); });
    assert(`a second ${name} allocates no geometry of its own`,
      g2.size > 0 && [...g2].every((g) => g1.has(g)),
      `${[...g2].filter((g) => g1.has(g)).length}/${g2.size}`);
  }

  // The spider is the one mob wider than it is tall, which is the whole of
  // its silhouette.
  const spider = bounds(models.createMobModel(SPIDER));
  assert('the spider is wider than it is tall', spider.width > spider.height,
    `${spider.width.toFixed(2)} vs ${spider.height.toFixed(2)}`);

  delete globalThis.document;
}

// ---------------------------------------------------------------------- total

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
