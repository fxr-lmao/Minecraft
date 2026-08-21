// Mobs: something to swing the swords at.
//
// The world has had four tiers of sword in it since the crafting table went
// in, and nothing to swing one at. This file is the simulation half of the
// fix — zombies and creepers, the two overworld hostiles a survival first
// night is made of — and like drops.js it is pure: positions and velocities
// and plain objects, no THREE and no DOM, so every rule in it can be run and
// checked in Node. The drawing is in mob-models.js and mobs-render.js.
//
// The numbers are the wiki's wherever the wiki has a number, and where it
// has an attribute instead of a number the conversion is spelled out:
//
//   * Zombies have movement speed 0.23 and creepers 0.25 on Minecraft's
//     attribute scale. For mobs (not players — the player's 0.1 is linear)
//     the measured conversion is attribute² × 43.17 blocks/s, the same 43.17
//     that turns the player's 0.1 into 4.317 walking. That puts a zombie at
//     2.28 blocks/s and a creeper at 2.70 — both slower than a walking
//     player, which is the whole shape of melee in Minecraft: you can always
//     walk away, and the danger is being cornered, not run down. A baby
//     zombie (0.35 before the ×1.3 for being a baby) would outrun a sprint,
//     which is exactly why there are none here.
//   * Both have 20 hit points, and pay 5 experience for the kill.
//   * A zombie hits for 3 on Normal difficulty, at most once a second.
//   * A creeper swells at three blocks, detonates after a second and a half,
//     and unwinds if you get seven away — numbers so load-bearing to how the
//     game plays that the wiki's *intro paragraph* carries them.
//
// Everything that happened during a tick comes back as events, because the
// sim cannot play a sound or dig a crater and should not learn how.

import {
  GRAVITY, JUMP_VELOCITY,
  DRAG_GROUND, DRAG_AIR, DRAG_WATER, FALL_SAFE,
} from './constants.js';
import { raycastVoxel } from './raycast.js';
import { isWater } from './terrain.js';
import {
  GUNPOWDER, ROTTEN_FLESH, toolKind,
  SHAPE_SWORD, SHAPE_AXE, SHAPE_PICKAXE, SHAPE_SHOVEL,
  TIER_WOOD, TIER_STONE, TIER_IRON, TIER_DIAMOND,
} from './items.js';

export const ZOMBIE = 'zombie';
export const CREEPER = 'creeper';

/**
 * Zombie speed on the ground, blocks/s: 0.23² × 43.17 ≈ 2.284.
 *
 * In water a zombie does not swim — Minecraft's zombies have no swim AI,
 * they walk along the bottom and think nothing of it — so the water speed is
 * a wade, not a stroke.
 */
export const ZOMBIE_SPEED = 0.23 * 0.23 * 43.17;
/** Creeper speed: 0.25² × 43.17 ≈ 2.698, a shade quicker than a zombie. */
export const CREEPER_SPEED = 0.25 * 0.25 * 43.17;

/** How fast anything here falls — the player's terminal fall, same world. */
const TERMINAL_FALL = 78.4;

/**
 * The hurt interval. Minecraft gives every living thing ten ticks — half a
 * second — of invulnerability after a hit, and it is the reason a sword has
 * a rhythm instead of being a damage hose: holding the button cannot hit
 * faster than the window allows, because the swings in between land on a mob
 * that is not listening.
 */
export const HURT_IFRAME = 0.5;

/**
 * Attack damage by held item, on the classic pre-cooldown scale the rest of
 * this game's combat-era rules come from: a fist is 1, a wooden sword 4,
 * stone 5, iron 6, diamond 7. Tools hit like tools — a pickaxe is a clumsy
 * thing to hit someone with and the numbers say so, an axe a bit less so —
 * and anything else (blocks, buckets, an armful of coal) is a fist.
 */
const BLADE_DAMAGE = {
  [TIER_WOOD]: 4, [TIER_STONE]: 5, [TIER_IRON]: 6, [TIER_DIAMOND]: 7,
};
const PICK_DAMAGE = {
  [TIER_WOOD]: 2, [TIER_STONE]: 3, [TIER_IRON]: 4, [TIER_DIAMOND]: 5,
};
const AXE_DAMAGE = {
  [TIER_WOOD]: 3, [TIER_STONE]: 4, [TIER_IRON]: 5, [TIER_DIAMOND]: 6,
};

/** How hard a hit with this item is, in half-hearts. */
export function attackDamage(held) {
  const kind = toolKind(held);
  if (!kind) return 1;
  if (kind.shape === SHAPE_SWORD) return BLADE_DAMAGE[kind.tier];
  if (kind.shape === SHAPE_AXE) return AXE_DAMAGE[kind.tier];
  if (kind.shape === SHAPE_PICKAXE || kind.shape === SHAPE_SHOVEL) return PICK_DAMAGE[kind.tier];
  return 1;
}

/**
 * Knockback, as a horizontal speed handed to the one who was hit.
 *
 * Minecraft's basic melee knockback is 0.4 blocks per *tick* — 8 blocks/s
//  here — aimed away from the attacker. Sprinting at the moment of impact
 * adds a good deal more (the sprint-knockback is effectively a second push),
 * which is the mechanic the whole hit-and-back-off rhythm of melee hangs
 * on: run in, shove it out of its own reach, retreat before the shove wears
 * off. It is no accident that a creeper's cancel range (7) is comfortably
 * smaller than the distance a sprint hit throws it.
 */
export const KNOCKBACK = 0.4 * 20; // 8 blocks/s
export const KNOCKBACK_SPRINT = 10.5; // blocks/s, sprint behind the blow
/** The little hop that comes with being hit — less than a jump, but a hop. */
export const KNOCKBACK_LIFT = 4.8;

// ----------------------------------------------------------------- the facts

/** What each kind of mob is, all in one place. */
export const MOB_FACTS = {
  [ZOMBIE]: {
    kind: ZOMBIE,
    name: 'Zombie',
    width: 0.6,
    height: 1.95, // Java Edition's exact box
    health: 20,
    speed: ZOMBIE_SPEED,
    /** Normal difficulty. (Easy 2.5, Hard 4.5 — Normal is the one.) */
    damage: 3,
    /** Zombies track unusually far: most mobs manage 16, zombies 40. */
    followRange: 40,
    /** Seconds between swings — Minecraft's base melee cooldown. */
    attackCooldown: 1,
    /** The one mob here the sun has an opinion about. */
    burns: true,
    xp: 5,
    drop: { id: ROTTEN_FLESH, min: 0, max: 2 },
  },
  [CREEPER]: {
    kind: CREEPER,
    name: 'Creeper',
    width: 0.6,
    height: 1.7,
    health: 20,
    speed: CREEPER_SPEED,
    damage: 0, // it does not hit; it detonates
    followRange: 16, // like most mobs — wider once it has decided on you
    attackCooldown: 0,
    burns: false,
    xp: 5,
    drop: { id: GUNPOWDER, min: 0, max: 2 },
  },
};

/**
 * Creeper etiquette, which is more precise than anything else in this file:
 *
 *   * It starts swelling at SWELL_RANGE — three blocks — and stops moving
 *     while it does. Standing still is the tell; it is the only warning the
 *     game gives you, and Minecraft gives you exactly the same one.
 *   * The fuse runs FUSE_SECONDS (1.5s) and then the world loses a sphere.
 *   * Get CANCEL_RANGE away and the fuse runs *backwards* at the same rate.
 *     Seven blocks on Normal; the distance grows with difficulty, a
 *     politeness this world does not extend.
 *   * The whole thing needs line of sight. A creeper that cannot see you
 *     does not hiss at arm's length, and one that was hissing stops — which
 *     is why a corner beats a sword, if you have one and can reach it.
 */
export const SWELL_RANGE = 3;
export const FUSE_SECONDS = 1.5;
export const CANCEL_RANGE = 7;
export const CREEPER_BLAST_RADIUS = 3;

// ------------------------------------------------------------------ spawning

/**
 * How close to you a mob may appear. Minecraft will not spawn hostiles
 * within 24 blocks of a player — close enough to hear the first groan,
 * never close enough to be beside you when the screen fades in — and
 * neither does this.
 */
export const SPAWN_MIN = 24;
/** ...and how far out the spawn ring reaches. */
export const SPAWN_MAX = 56;
/** Beyond this a mob is simply gone: Minecraft's 128-block instant despawn. */
export const DESPAWN_RANGE = 128;
/**
 * Past 32 blocks, a mob with nothing better than wandering to do may
 * despawn at random. Minecraft rolls this per tick at 1/600; rolled per
 * second at the same expected lifetime it is 8%, and the lifetime is what
 * matters — half a minute or so of not being worth keeping before the
 * world quietly agrees.
 */
export const SOFT_DESPAWN_RANGE = 32;
export const SOFT_DESPAWN_CHANCE = 0.08;

/**
 * How many hostile mobs may exist at once.
 *
 * Minecraft's hostile cap is 70, and this is not 70, for a reason about
 * *this* game: every mob here is a small group of lit, shadow-casting
 * boxes, and seventy of them is a thousand draw calls walking towards you.
 * Sixteen keeps a night busy and the frame rate honest. The cap is a
 * renderer's budget, not a rule of Minecraft, and it says so here so nobody
 * mistakes it for one.
 */
export const MAX_MOBS = 16;

/** How often the world tries to place a mob, in seconds. */
export const SPAWN_INTERVAL = 1;
/** Attempts per try — most fail (water, cliff, too close), which is normal. */
export const SPAWN_ATTEMPTS = 4;

/**
 * Which mob a spawn becomes. Minecraft's overworld weights zombies and
 * creepers roughly equally, but two enemies that both simply walk at you is
 * a coin flip with no stakes; here the walker is the common case and the
 * bomber is the one you learn to check for.
 */
export const CREEPER_CHANCE = 0.3;

/**
 * How dark the world must be before the surface will spawn anything.
 *
 * Minecraft asks a light level; this world has no light propagation, so the
 * sun stands in for it — `sun < NIGHT_SUN` means the sun is low enough that
 * the wiki would call the surface dark. Underground there is no sun to ask,
 * and a cave is dark at noon, so caves spawn whenever they have room.
 */
export const NIGHT_SUN = 0.25;

/** Sunlight at which an exposed zombie catches fire. */
export const BURN_SUN = 0.55;
/** Fire costs a zombie a hit point a second — Minecraft's undead burn rate. */
export const BURN_DPS = 1;

/** Player half-width, for the melee test: the player's box is 0.6 wide. */
const PLAYER_HALF = 0.3;

let nextUid = 1;

// ------------------------------------------------------------------ one mob

/**
 * A mob. Position is its feet-centre, like the player's; velocities are
 * blocks per second. Everything else is either a fact of its kind (kept by
 * reference for the hot path) or state the AI owns.
 */
export class Mob {
  constructor(kind, x, y, z, rand = Math.random) {
    const facts = MOB_FACTS[kind];
    this.uid = nextUid++;
    this.kind = kind;
    this.facts = facts;
    this.rand = rand;

    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    /** Body facing, radians — the direction the walk is going. */
    this.yaw = rand() * Math.PI * 2;
    /** Where the head points: at you, whenever you are interesting. */
    this.headYaw = this.yaw;
    this.headPitch = 0;

    this.health = facts.health;
    /** Seconds since a hit connected; counts up through the hurt window. */
    this.sinceHurt = HURT_IFRAME;
    /** The size of the hit that opened the current window, if one is open. */
    this.lastDamage = 0;

    this.onGround = false;
    this.inWater = false;
    this.fallDistance = 0;

    // ---- perception ----
    /** Can it see the player right now (a block-free line, eye to eye)? */
    this.canSee = false;
    /** Is it acting on the player — chasing, or in the zombie's case closing? */
    this.hasTarget = false;
    /**
     * Roused, and staying that way. A mob that has been hit or has given
     * chase does not drop the whole thing the moment you duck round a
     * corner; Minecraft's targets persist out to well past sight range.
     */
    this.aggro = false;

    // ---- idle behaviour ----
    /** 'idle' | 'wander' | 'chase'. */
    this.state = 'idle';
    /** Seconds until the wander picks a new heading (or stops for a rest). */
    this.stateTimer = rand() * 3;
    this.wanderX = 0; // unit heading; zero pair means standing
    this.wanderZ = 0;

    // ---- combat ----
    /** Seconds until the next swing may land. */
    this.attackTimer = 0;
    /** Creeper fuse, 0..1: builds in range, decays out of it, fires at 1. */
    this.fuse = 0;
    /** Set once per swell, so the hiss is one event and not a stream. */
    this.hissed = false;
    /** Zombie shuffling noises; creepers are famously given none. */
    this.groanTimer = 2 + rand() * 6;

    // ---- death ----
    /** Seconds left of the fall-over animation, or -1 while alive. */
    this.dying = -1;
    /** 'player' | 'blast' | 'burn' | 'fall' | 'self' — set once, at the end. */
    this.deathBy = null;
    /**
     * Set for exactly one tick when a mob dies, so `update` can announce it
     * as an event exactly once no matter which of the several ways of dying
     * (sword, blast, fire, floor) happened to be the one.
     */
    this.justDied = false;

    // ---- animation state, written here, read by the renderer ----
    /** Walking clock, driven by ground speed. */
    this.walkPhase = 0;
    /** 0..1 flash of having just been hit. */
    this.hurtFlash = 0;
    /** 0..1 while on fire. */
    this.burning = 0;
  }

  /**
   * Dead means dead: the kill happened, even if the 0.9 s fall-over has
   * since run out and the body is gone. (`dying >= 0` was the first draft
   * and it had exactly that hole — a corpse whose animation had counted
   * past zero read as *alive* to anything still holding a reference to it.)
   */
  get dead() {
    return this.deathBy !== null;
  }

  get halfWidth() {
    return this.facts.width / 2;
  }

  /** Where its eyes are — line-of-sight rays start here. */
  eyePos() {
    return { x: this.x, y: this.y + this.facts.height * 0.85, z: this.z };
  }

  /**
   * Take a hit. Returns 'died', 'hit' or 'immune'.
   *
   * The interesting branch is 'immune', because Minecraft's rule is not
   * "invulnerable for ten ticks" but "invulnerable to anything *up to* the
   * last hit for ten ticks": a bigger blow inside the window gets through,
   * pays only the difference, and restarts the clock. Without that, a mob
   * between two sources of damage could never be finished by either; with
   * it, the window is a floor rather than a wall.
   *
   * Knockback rides along on any hit that *connected* — Minecraft shoves
   * things around on every landed blow — but not on one that was shrugged
   * off, or a held button would juggle a mob to death across a field.
   */
  hurt(damage, opts = {}) {
    if (this.dead || damage <= 0) return 'immune';
    const windowOpen = this.sinceHurt < HURT_IFRAME;
    if (windowOpen && damage <= this.lastDamage) return 'immune';
    const paid = windowOpen ? damage - this.lastDamage : damage;
    this.lastDamage = damage;
    this.sinceHurt = 0;
    this.health -= paid;
    this.hurtFlash = 1;
    // Being hit is being noticed, even through a wall, even in the dark.
    this.aggro = true;
    this._shove(opts);
    if (this.health <= 0) {
      this.kill(opts.byPlayer ? 'player' : (opts.cause ?? 'player'));
      return 'died';
    }
    return 'hit';
  }

  /**
   * Shove, aimed along (kx, kz). The caller normalises; the strength and
   * the lift come from whoever is doing the shoving.
   */
  _shove(opts) {
    const { kx = 0, kz = 0, sprinting = false,
      lift = KNOCKBACK_LIFT, strength = KNOCKBACK } = opts;
    const len = Math.hypot(kx, kz);
    if (len < 1e-6) return;
    const speed = sprinting ? KNOCKBACK_SPRINT : strength;
    this.vx = (kx / len) * speed;
    this.vz = (kz / len) * speed;
    if (this.onGround) this.vy = Math.max(this.vy, lift);
    this.onGround = false;
  }

  /** Die, once: wind the animation up and remember what did it. */
  kill(cause) {
    if (this.dead) return;
    this.dying = 0.9;
    this.deathBy = cause;
    this.justDied = true;
    this.fuse = 0;
  }

  /**
   * Would this mob's box and the player's, each grown by `pad`, overlap?
   * Melee reach in Minecraft is measured between boxes, not centres: a
   * zombie's reach is not "one block from its middle", it is its 0.6 box
   * plus your 0.6 box nearly touching. The pad is the arm.
   */
  withinMelee(px, pz, pad = 0.15) {
    return Math.abs(this.x - px) < this.halfWidth + PLAYER_HALF + pad
      && Math.abs(this.z - pz) < this.halfWidth + PLAYER_HALF + pad;
  }
}

// ----------------------------------------------------------------- collision

/**
 * Axis-separated AABB movement against `world.isSolid` — the same scheme the
 * player uses, written plainly because the player's is welded to its class.
 * Y resolves first: whether a horizontal push is "walking into a step" (hop
 * it) or "falling past a wall" (slide it) depends on already being on the
 * floor, so the floor is established before the question is asked.
 *
 * Returns which axes were blocked and whether this step landed, because
 * "bumped into something while meaning to walk" is the cue to hop.
 */
export function moveMob(mob, dt, world) {
  const half = mob.halfWidth - 1e-4;
  const height = mob.facts.height - 2e-4;
  let { x, y, z } = mob;
  const dx = mob.vx * dt;
  const dy = mob.vy * dt;
  const dz = mob.vz * dt;
  let blockedX = false;
  let blockedZ = false;
  let landed = false;

  const fits = (px, py, pz) => {
    const x1 = Math.floor(px + half);
    const y1 = Math.floor(py + height);
    const z1 = Math.floor(pz + half);
    for (let cy = Math.floor(py + 1e-4); cy <= y1; cy++) {
      for (let cx = Math.floor(px - half); cx <= x1; cx++) {
        for (let cz = Math.floor(pz - half); cz <= z1; cz++) {
          if (world.isSolid(cx, cy, cz)) return false;
        }
      }
    }
    return true;
  };

  if (dy !== 0) {
    const ny = y + dy;
    if (fits(x, ny, z)) {
      y = ny;
      mob.onGround = false;
    } else {
      // Park at the boundary of the cell being entered.
      y = dy > 0
        ? Math.ceil(y + height) - height - 1e-3
        : Math.floor(y) + 1e-3;
      if (dy < 0) {
        mob.onGround = true;
        landed = true;
      }
      mob.vy = 0;
    }
  }

  if (dx !== 0) {
    if (fits(x + dx, y, z)) x += dx;
    else {
      blockedX = true;
      x = dx > 0
        ? Math.floor(x + half) + 1 - half - 1e-3
        : Math.ceil(x - half) - 1 + half + 1e-3;
      mob.vx = 0;
    }
  }
  if (dz !== 0) {
    if (fits(x, y, z + dz)) z += dz;
    else {
      blockedZ = true;
      z = dz > 0
        ? Math.floor(z + half) + 1 - half - 1e-3
        : Math.ceil(z - half) - 1 + half + 1e-3;
      mob.vz = 0;
    }
  }

  mob.x = x;
  mob.y = y;
  mob.z = z;
  return { blockedX, blockedZ, landed };
}

// ------------------------------------------------------------------- picking

/**
 * Where a ray first enters a mob's box, as a distance along the ray, or
 * null. Slab test — plain arithmetic, so the crosshair can be checked
 * against mobs exactly the way `raycastVoxel` checks it against blocks.
 */
export function rayHitsMob(mob, origin, dir) {
  const half = mob.halfWidth;
  const minX = mob.x - half, maxX = mob.x + half;
  const minY = mob.y, maxY = mob.y + mob.facts.height;
  const minZ = mob.z - half, maxZ = mob.z + half;
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [origin.x, dir.x, minX, maxX],
    [origin.y, dir.y, minY, maxY],
    [origin.z, dir.z, minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (d === 0) {
      if (o < lo || o > hi) return null; // parallel and outside: never hits
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/**
 * The mob the crosshair is on, if any: nearest hit along the ray, alive,
 * and nearer than `maxDist`. The caller compares the result's distance
 * against the block the same ray found, because a zombie behind glass is a
 * block interaction and not a fight.
 */
export function pickMob(mobs, origin, dir, maxDist) {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0) return null;
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  let best = null;
  for (const mob of mobs) {
    if (mob.dead) continue;
    const t = rayHitsMob(mob, origin, d);
    if (t === null || t < 0 || t > maxDist) continue;
    if (!best || t < best.dist) best = { mob, dist: t };
  }
  return best;
}

// --------------------------------------------------------------- the sounds

/**
 * A sound event, with distance already folded into a volume — the sim knows
 * where everything is, and nothing about how loud anything should be.
 */
export function soundEvent(name, x, y, z, player, range) {
  const d = Math.hypot(x - player.x, y - player.y, z - player.z);
  return { type: 'sound', name, x, y, z, volume: Math.max(0.05, 1 - d / range) };
}

// ------------------------------------------------------------- the mob field

/**
 * Every mob in the world, plus the spawning that keeps it stocked.
 *
 * Not saved. Like lit fuses and flowing water, a mob is a consequence of the
 * world rather than a fact about it: walk away for an hour and the night you
 * left behind is not the night you walk back into — it is dark, so it will
 * have filled itself back up on its own. Minecraft persists mobs; this world
 * persists edits, and a fresh population each session is the simpler bargain.
 */
export class Mobs {
  /**
   * @param {{rand?: () => number, cap?: number}} [opts] the random source and
   *   the population cap, both overridable so a test can ask a deterministic
   *   question ("on these rolls, what spawns?") instead of a statistical one.
   */
  constructor(opts = {}) {
    this.list = [];
    this.rand = opts.rand ?? Math.random;
    this.cap = opts.cap ?? MAX_MOBS;
    this._spawnClock = 0;
  }

  /** Put one here, if there is room. Returns it, or null. */
  spawn(kind, x, y, z) {
    if (this.list.length >= this.cap) return null;
    const mob = new Mob(kind, x, y, z, this.rand);
    this.list.push(mob);
    return mob;
  }

  /** Every mob within `radius` of (x, y, z) — for explosions. */
  near(x, y, z, radius) {
    const out = [];
    const r2 = radius * radius;
    for (const mob of this.list) {
      const dx = mob.x - x;
      const dy = mob.y + mob.facts.height / 2 - y;
      const dz = mob.z - z;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(mob);
    }
    return out;
  }

  /**
   * An explosion's effect on the population: damage falling off with
   * distance, and a shove away from the centre. Minecraft's blast throws
   * things harder than any sword does, and so does this.
   *
   * The `power` is on the scale a creeper's blast actually hits for on
   * Normal — up to the forties at point-blank, nothing at the edge of the
   * shockwave — because a mob caught hugging its own explosion should not
   * survive it, and on the player's 14-point TNT scale it comfortably
   * would. (The player is hurt separately, in the game loop, on the gentler
   * scale this game's own TNT uses for them.) Returns the mobs that died,
   * causes set to 'blast', so the caller can decide what they leave.
   */
  explosionDamage(x, y, z, radius = CREEPER_BLAST_RADIUS, power = 40) {
    const reach = radius + 1.5; // a hair past the crater, for the shockwave
    const dead = [];
    for (const mob of this.near(x, y, z, reach)) {
      const dx = mob.x - x;
      const dy = mob.y + mob.facts.height / 2 - y;
      const dz = mob.z - z;
      const dist = Math.hypot(dx, dy, dz);
      const damage = Math.max(1, Math.round(power * (1 - dist / reach)));
      const len = Math.max(1e-4, Math.hypot(dx, dz));
      const before = mob.dead;
      mob.hurt(damage, {
        kx: dx / len, kz: dz / len,
        strength: KNOCKBACK * 1.6, lift: 6.5, cause: 'blast',
      });
      if (mob.dead && !before) dead.push(mob);
    }
    return dead;
  }

  /** Forget everything too far away to simulate — the same deal as drops. */
  evictOutside(x, z, radius) {
    this.list = this.list.filter((m) => Math.hypot(m.x - x, m.z - z) <= radius);
  }

  /**
   * One step of the world.
   *
   * @param {number} dt seconds of game time
   * @param {object} world get/isSolid/heightAt — the real one, or a test's
   * @param {{x: number, y: number, z: number}} player where the player is
   * @param {{creative?: boolean, sun?: number, rain?: number}} [ctx]
   *   `creative` — mobs ignore a creative player entirely, which is
   *   Minecraft's rule: hostile AI never targets what it cannot hurt.
   *   `sun` — 0..1 sunlight, for how dark "night" is and who burns.
   *   `rain` — 0..1, because rain puts fires out.
   * @returns {Array<object>} what happened, for the loop to make noises and
   *   craters about. Events carry positions; they do not carry THREE.
   */
  update(dt, world, player, ctx = {}) {
    const events = [];
    if (dt <= 0) return events;
    const sun = ctx.sun ?? 1;
    const rain = ctx.rain ?? 0;
    const night = sun < NIGHT_SUN;

    this._spawnClock += dt;
    while (this._spawnClock >= SPAWN_INTERVAL) {
      this._spawnClock -= SPAWN_INTERVAL;
      this._trySpawn(world, player, night);
    }

    for (const mob of this.list) {
      // A death is announced exactly once and by exactly one path, however
      // it happened — sword, blast, fire, floor, or its own fuse — so the
      // flag is consumed here, at the top, before anything else can touch
      // the mob this tick. (Deaths can arrive from outside a tick entirely:
      // `playerAttack` and `explosionDamage` run on the game loop's clock.)
      if (mob.justDied) {
        mob.justDied = false;
        events.push({
          type: 'die', mob, kind: mob.kind,
          x: mob.x, y: mob.y, z: mob.z, by: mob.deathBy,
        });
      }

      // A corpse only finishes falling over.
      if (mob.dead) {
        mob.dying -= dt;
        continue;
      }

      this._sense(mob, world, player, ctx);
      const intent = this._think(mob, dt, player, ctx);

      // Events out first: a creeper planting itself does not also walk, and
      // a zombie swinging does not also step — Minecraft's mobs stand and
      // deliver, and so do these.
      if (intent && intent.event) {
        this._onIntentEvent(mob, intent, player, events);
        if (intent.event !== 'explode') {
          // Swelling and swinging hold still; the fuse clock still ran.
          this._age(mob, dt, world, sun, rain, player, events);
          continue;
        }
        // An exploded creeper is done; fall through to nothing.
        continue;
      }

      this._move(mob, dt, world, intent);
      this._environment(mob, dt, world, sun, rain, events);
      this._age(mob, dt, world, sun, rain, player, events);
    }

    // Corpses out, runaways gone, and the far-away forgotten.
    this.list = this.list.filter((mob) => {
      if (mob.dead && mob.dying <= 0) return false;
      const dist = Math.hypot(mob.x - player.x, mob.z - player.z);
      if (dist > DESPAWN_RANGE) return false;
      if (dist > SOFT_DESPAWN_RANGE && !mob.hasTarget && !mob.dead
          && this.rand() < SOFT_DESPAWN_CHANCE * dt) {
        return false;
      }
      return true;
    });

    return events;
  }

  /** Clocks that run the same whichever way the thinking went. */
  _age(mob, dt, world, sun, rain, player, events) {
    mob.sinceHurt += dt;
    mob.hurtFlash = Math.max(0, mob.hurtFlash - dt * 3);
    mob.attackTimer = Math.max(0, mob.attackTimer - dt);

    // The sounds of a zombie: a groan every so often, only when near enough
    // to be worth hearing. Creepers make no idle sound at all, which the
    // wiki notes with some feeling and this matches on purpose — the hiss
    // is the entire soundtrack of a creeper, and it only comes at the end.
    if (mob.kind === ZOMBIE) {
      mob.groanTimer -= dt;
      if (mob.groanTimer <= 0) {
        mob.groanTimer = 4 + mob.rand() * 6;
        if (Math.hypot(mob.x - player.x, mob.z - player.z) < 24) {
          events.push(soundEvent('zombie', mob.x, mob.y + 1, mob.z, player, 24));
        }
      }
    }
  }

  // ---------------------------------------------------------------- spawning

  /**
   * One round of spawn attempts around the player.
   *
   * Two very different worlds are being asked. On the surface, only at
   * night: the sun stands in for the light level this engine does not
   * compute, and while it is up there is nothing up there for a hostile mob
   * to come out of. Underground, any hour — a cave is dark at noon, and
   * dark is the whole of the rule. At night the surface gets the larger
   * share of the attempts, because that is where the night actually is.
   */
  _trySpawn(world, player, night) {
    if (this.list.length >= this.cap) return;
    for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
      const wantSurface = night ? this.rand() < 0.65 : false;
      const spot = wantSurface
        ? this._surfaceSpot(world, player)
        : this._caveSpot(world, player);
      if (!spot) continue;
      const kind = this.rand() < CREEPER_CHANCE ? CREEPER : ZOMBIE;
      if (this.spawn(kind, spot.x, spot.y, spot.z)) return;
    }
  }

  /**
   * The physical checks every spawn makes, in whichever world it is: two
   * cells of air for the body, something solid underfoot, and no water.
   * Minecraft's own spawn rules are a paragraph of light levels and block
   * tags; these three are the parts of them that survive not having light.
   */
  _fits(world, x, y, z) {
    if (world.inBounds && !world.inBounds(x, y, z)) return false;
    if (!world.isSolid(x, y - 1, z)) return false;
    for (let h = 0; h < 2; h++) {
      const id = world.get(x, y + h, z);
      if (id === undefined) return false;
      if (world.isSolid(x, y + h, z)) return false;
      if (isWater(id)) return false;
    }
    return true;
  }

  /** A place on the surface: a ring position, its ground, and a night check. */
  _surfaceSpot(world, player) {
    if (typeof world.heightAt !== 'function') return null;
    const ang = this.rand() * Math.PI * 2;
    const r = SPAWN_MIN + this.rand() * (SPAWN_MAX - SPAWN_MIN);
    const x = Math.floor(player.x + Math.cos(ang) * r);
    const z = Math.floor(player.z + Math.sin(ang) * r);
    // The ring was chosen in floating point and the cell is an integer, so
    // floor() can shave most of a block off the radius — and the whole
    // promise of SPAWN_MIN is that nothing appears closer than it. Check
    // the *cell's* distance, not the ring's.
    if (Math.hypot(x + 0.5 - player.x, z + 0.5 - player.z) < SPAWN_MIN - 0.75) return null;
    const y = world.heightAt(x, z) + 1;
    if (!this._fits(world, x, y, z)) return null;
    return { x: x + 0.5, y: y + 0.01, z: z + 0.5 };
  }

  /**
   * A place under the surface. `heightAt` says where the rock stops; a spot
   * well below that is dark whatever the hour, and dark is the only rule.
   * Pick a column, pick a depth, and walk down a few cells looking for a
   * pocket with a floor in it — caves are common enough that five cells of
   * looking finds one whenever there is one to find.
   */
  _caveSpot(world, player) {
    if (typeof world.heightAt !== 'function') return null;
    const minY = world.minY ?? -64;
    const ang = this.rand() * Math.PI * 2;
    const r = SPAWN_MIN * 0.6 + this.rand() * (SPAWN_MAX - SPAWN_MIN * 0.6);
    const x = Math.floor(player.x + Math.cos(ang) * r);
    const z = Math.floor(player.z + Math.sin(ang) * r);
    const top = world.heightAt(x, z) - 6;
    if (top <= minY + 6) return null; // no underworld here (superflat, say)
    const y = Math.floor(minY + 6 + this.rand() * (top - (minY + 6)));
    for (let dy = 0; dy < 5; dy++) {
      const at = y - dy;
      if (at <= minY + 3) break;
      if (!this._fits(world, x, at, z)) continue;
      // SPAWN_MIN is a promise about *distance*, not about the surface: the
      // ring this column was drawn from reaches closer in than 24 (a cave
      // ring the size of the surface one would almost never find a pocket),
      // and the depth usually makes up the difference — but not when you are
      // down there with it. Underground the 24 blocks have to be measured,
      // in three dimensions, or a zombie appears fifteen blocks along the
      // tunnel you are standing in.
      const dx = x + 0.5 - player.x;
      const dy3 = at + 0.01 - player.y;
      const dz = z + 0.5 - player.z;
      if (dx * dx + dy3 * dy3 + dz * dz < SPAWN_MIN * SPAWN_MIN) continue;
      return { x: x + 0.5, y: at + 0.01, z: z + 0.5 };
    }
    return null;
  }

  // --------------------------------------------------------------- perception

  /**
   * What the mob knows: where the player is, whether it can see them, and
   * therefore whether they are a target.
   *
   * Line of sight is a block ray, eye to eye, out to the follow range —
   * always, at any distance, because the one mob that cares most about it
   * cares at arm's length: a creeper behind glass does not hiss even with
   * its face against it, and a shortcut that assumes "close enough to see"
   * would hiss. It only *gates the first look* for everyone else: a mob
   * that has decided on you does not un-decide because you stepped behind a
   * fence for a moment (Minecraft's targets persist), and a mob you have
   * just hit never needed to see you — the hit was introduction enough.
   */
  _sense(mob, world, player, ctx) {
    const dx = player.x - mob.x;
    const dz = player.z - mob.z;
    const distSq = dx * dx + dz * dz;
    const acquire = mob.facts.followRange;
    const keep = mob.aggro ? acquire * 1.75 : acquire;
    const inRange = !ctx.creative && distSq < keep * keep;

    if (!inRange) {
      mob.canSee = false;
      mob.hasTarget = false;
      if (distSq > keep * keep) mob.aggro = false;
      return;
    }

    let los = true;
    const eye = mob.eyePos();
    const pe = { x: player.x, y: player.y + 1.62, z: player.z };
    const dir = { x: pe.x - eye.x, y: pe.y - eye.y, z: pe.z - eye.z };
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len > 0.001) {
      los = !raycastVoxel(world, eye,
        { x: dir.x / len, y: dir.y / len, z: dir.z / len }, len);
    }
    mob.canSee = los;
    mob.hasTarget = mob.aggro || los;
    if (mob.hasTarget && !ctx.creative) mob.aggro = true;
  }

  // ---------------------------------------------------------------- thinking

  /**
   * What the body wants this instant. Returns null (stand), a walking
   * intent `{x, z}`, or an intent-event `{event, ...}` for the two things a
   * mob does instead of walking: swinging, and detonating.
   */
  _think(mob, dt, player, ctx) {
    const dx = player.x - mob.x;
    const dz = player.z - mob.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    const ux = dx / dist;
    const uz = dz / dist;

    if (mob.hasTarget && !ctx.creative) {
      mob.state = 'chase';
      mob.headYaw = Math.atan2(-ux, -uz);
      mob.headPitch = Math.atan2(
        player.y + 1.4 - (mob.y + mob.facts.height * 0.85), dist);

      // ---- zombie: walk in, swing when the boxes touch ----
      if (mob.kind === ZOMBIE) {
        if (mob.attackTimer <= 0 && mob.withinMelee(player.x, player.z)
            && Math.abs(player.y - mob.y) < 2.2) {
          mob.attackTimer = mob.facts.attackCooldown;
          return { event: 'attack', damage: mob.facts.damage, kx: ux, kz: uz };
        }
        return { x: ux, z: uz };
      }

      // ---- creeper: close to swell range, then stand and be a bomb ----
      //
      // The swell needs *current* sight, not remembered interest — the wiki
      // is explicit that a creeper without line of sight does not hiss even
      // at arm's length, and that one already hissing stops the moment the
      // line breaks. That is the one place this engine can be more faithful
      // than a shrug, because the block ray to decide it is already here.
      const inSwell = dist < SWELL_RANGE && mob.canSee;
      if (inSwell) {
        if (!mob.hissed) {
          mob.hissed = true;
          return { event: 'hiss' };
        }
        mob.fuse += dt / FUSE_SECONDS;
        if (mob.fuse >= 1) {
          mob.fuse = 1;
          return { event: 'explode' };
        }
        return null; // planted: swelling, flashing, going nowhere
      }
      // Out past cancel range the fuse unwinds at the rate it wound; inside
      // it — the band between three and seven — the fuse simply holds, and
      // the creeper walks back in to close the distance again.
      if (dist > CANCEL_RANGE || !mob.canSee) {
        mob.fuse = Math.max(0, mob.fuse - dt / FUSE_SECONDS);
        if (mob.fuse === 0) mob.hissed = false;
      }
      return { x: ux, z: uz };
    }

    // ---- nothing hunting: the wander ----
    // A creeper that has lost interest in everything unwinds whatever fuse
    // it was holding, the same as if you had run away from it.
    if (mob.fuse > 0) {
      mob.fuse = Math.max(0, mob.fuse - dt / FUSE_SECONDS);
      if (mob.fuse === 0) mob.hissed = false;
    }
    mob.stateTimer -= dt;
    if (mob.stateTimer <= 0) {
      if (mob.wanderX !== 0 || mob.wanderZ !== 0) {
        mob.wanderX = 0; // was walking — stand a while
        mob.wanderZ = 0;
        mob.stateTimer = 1.5 + mob.rand() * 4;
      } else {
        const a = mob.rand() * Math.PI * 2;
        mob.wanderX = Math.cos(a);
        mob.wanderZ = Math.sin(a);
        mob.stateTimer = 0.8 + mob.rand() * 2.2;
      }
    }
    if (mob.wanderX === 0 && mob.wanderZ === 0) {
      mob.state = 'idle';
      return null;
    }
    mob.state = 'wander';
    return { x: mob.wanderX, z: mob.wanderZ };
  }

  /** The two intent-events, turned into tick events the loop can consume. */
  _onIntentEvent(mob, intent, player, events) {
    if (intent.event === 'attack') {
      events.push({
        type: 'attack', damage: intent.damage,
        kx: intent.kx, kz: intent.kz,
        x: mob.x, y: mob.y + 1.2, z: mob.z,
        cause: 'slain by a zombie',
      });
      events.push(soundEvent('zombieAttack', mob.x, mob.y + 1, mob.z, player, 16));
    } else if (intent.event === 'hiss') {
      events.push(soundEvent('hiss', mob.x, mob.y + 0.8, mob.z, player, 16));
    } else if (intent.event === 'explode') {
      // The creeper's own blast is its death; it leaves nothing behind —
      // Minecraft's creepers drop no gunpowder for their own explosion.
      // The death event comes from the same single path every other death
      // takes (the justDied flag, consumed at the top of the next tick).
      mob.kill('self');
      events.push({
        type: 'explode', x: mob.x, y: mob.y + 0.4, z: mob.z,
        radius: CREEPER_BLAST_RADIUS,
      });
    }
  }

  // ---------------------------------------------------------------- movement

  /**
   * Apply a walking intent: accelerate toward it at the mob's speed under
   * the ground drag, hop one-block steps, fall, and pay for the fall.
   */
  _move(mob, dt, world, intent) {
    const feetId = world.get(Math.floor(mob.x), Math.floor(mob.y + 0.1), Math.floor(mob.z));
    mob.inWater = isWater(feetId);

    const speed = mob.facts.speed * (mob.inWater ? 0.55 : 1);
    const k = mob.inWater ? DRAG_WATER : (mob.onGround ? DRAG_GROUND : DRAG_AIR);
    const f = Math.exp(-k * dt);

    if (intent && (intent.x !== 0 || intent.z !== 0)) {
      const a = speed * (1 - f);
      mob.vx = mob.vx * f + intent.x * a;
      mob.vz = mob.vz * f + intent.z * a;
      mob.yaw = Math.atan2(-intent.x, -intent.z);
    } else {
      mob.vx *= f;
      mob.vz *= f;
    }

    // Vertical. A zombie in water does not swim — it sinks until it stands
    // and keeps walking, which is Minecraft's zombies exactly: no buoyancy,
    // no breath, no opinion about the sea at all.
    if (mob.inWater) {
      mob.vy += (-1 - mob.vy) * Math.min(1, dt * 3); // sink gently to a walk
      mob.fallDistance = 0;
    } else {
      mob.vy -= GRAVITY * dt;
      if (mob.vy < -TERMINAL_FALL) mob.vy = -TERMINAL_FALL;
    }

    const before = mob.y;
    const moved = moveMob(mob, dt, world);

    // Falling costs, on exactly the player's tariff: three blocks free, a
    // hit point a block after that, and any distance into water for
    // nothing. Fire and fall damage bypass the hurt window rather than
    // competing with it — the environment is not taking turns with swords.
    if (!mob.onGround && !mob.inWater && mob.y < before) {
      mob.fallDistance += before - mob.y;
    } else if (moved.landed) {
      if (mob.fallDistance > FALL_SAFE) {
        this._environmentalHurt(mob, Math.ceil(mob.fallDistance - FALL_SAFE), 'fall');
      }
      mob.fallDistance = 0;
    }

    // The hop: pushed into something while meaning to walk, and standing on
    // the floor. Every ground mob in Minecraft climbs one block this way —
    // it is why hills do not stop a zombie — and none of them climbs two.
    if ((moved.blockedX || moved.blockedZ) && mob.onGround
        && intent && (intent.x !== 0 || intent.z !== 0)) {
      mob.vy = JUMP_VELOCITY;
      mob.onGround = false;
    }

    // Walking drives the animation clock, at a rate that keeps the legs
    // matched to the ground they are covering.
    mob.walkPhase += Math.hypot(mob.vx, mob.vz) * dt * 2.4;
  }

  /** Damage from the world rather than a combatant. Can still be the end. */
  _environmentalHurt(mob, paid, cause) {
    mob.health -= paid;
    mob.hurtFlash = 1;
    if (mob.health <= 0) mob.kill(cause);
  }

  // -------------------------------------------------------------- environment

  /**
   * The world's slow opinions about a mob — of which, here, there is one:
   * fire, in the case of zombies.
   *
   * A zombie in daylight burns, at a hit point a second, which is the
   * reason a night of zombies is a *night* and dawn is a reprieve. The
   * rules: exposed to the sky (approximated by the column — standing on
   * the surface counts, standing under anything does not), the sun genuinely
   * up (BURN_SUN of it), not in water, and not being rained on — rain puts
   * fires out, and a stormy dawn is the one dawn the zombies survive.
   */
  _environment(mob, dt, world, sun, rain, events) {
    if (!mob.facts.burns) return;
    const x = Math.floor(mob.x);
    const z = Math.floor(mob.z);
    let exposed = true;
    if (typeof world.heightAt === 'function') {
      exposed = Math.floor(mob.y) >= world.heightAt(x, z) + 1;
    }
    const alight = exposed && sun >= BURN_SUN && !mob.inWater && rain < 0.3;
    if (alight) {
      mob.burning = Math.min(1, mob.burning + dt * 2);
      this._environmentalHurt(mob, BURN_DPS * dt, 'burn');
      if (mob.rand() < dt * 3) {
        events.push({ type: 'burn', x: mob.x, y: mob.y + mob.facts.height * 0.6, z: mob.z });
      }
    } else {
      mob.burning = Math.max(0, mob.burning - dt);
    }
  }
}

// -------------------------------------------------------------------- attack

/**
 * The player swings at a mob.
 *
 * The knockback runs along the swing — the horizontal part of where the
 * player is looking — so a hit from the side sends a mob sideways and a
 * sprint hit sends it out of the fight. Durability, sounds and the swing of
 * the arm are the caller's business; this is the numbers.
 *
 * @returns {{result: 'died'|'hit'|'immune', mob: Mob}} what the swing did.
 *   'immune' means the window from a previous hit is still up and this blow
 *   was not bigger than the one that set it — the caller should not spend
 *   durability or make the hit noise.
 */
export function playerAttack(mob, held, look, sprinting) {
  const damage = attackDamage(held);
  const len = Math.hypot(look.x, look.z);
  const kx = len > 1e-6 ? look.x / len : 0;
  const kz = len > 1e-6 ? look.z / len : 1;
  const result = mob.hurt(damage, {
    kx, kz, sprinting, byPlayer: true,
  });
  return { result, mob };
}
