// Arrows: the projectile half of ranged combat.
//
// Both sides of a bow use this file — the skeleton's shots and the player's.
// It is pure, like drops.js and mobs.js: positions, velocities and events,
// no THREE and no DOM, so every rule in it can be run and checked in Node.
// The numbers are Minecraft's where Minecraft has a number: an arrow falls
// at 0.05 blocks/tick² (20 blocks/s²), flies a little faster than a sprint,
// and a skeleton's arrow hits for 3 on Normal.
//
// An arrow is a point that moves under gravity and dies in one of three
// ways: it sticks in a block, it finds a body, or it runs out of air. The
// collision is sub-stepped like the drops', because at 24 blocks/s a single
// frame step is most of a block and a fast arrow would tunnel straight
// through a thin wall — and an arrow that passes through the wall you hid
// behind is a bow that might as well not exist.

import { isWater } from './terrain.js';

/** Blocks/s². Minecraft's 0.05 per tick², converted to the game's seconds. */
export const ARROW_GRAVITY = 20;
/** Muzzle speed, blocks/s — a shade over a sprinting player. */
export const ARROW_SPEED = 24;
/** A skeleton's arrow, on Normal difficulty. */
export const ARROW_DAMAGE = 3;
/** A fully drawn player bow. */
export const BOW_DAMAGE = 6;
/** Seconds of flight before an arrow gives up and vanishes. */
export const ARROW_TTL = 60;
/**
 * How long after leaving the bow an arrow cannot hit its owner. Without it a
 * shot fired while walking forward would connect with your own hitbox on the
 * frame it leaves the string, and the bow would look like it misfired.
 */
export const ARROW_IGNORE_SECONDS = 0.25;
/** Substep ceiling, so a huge frame cannot let an arrow skip a wall. */
const MAX_SUBSTEPS = 32;

/** Does the arrow's tip, at (x, y, z), lie inside a feet-centred box? */
export function arrowHitsBox(x, y, z, box) {
  const half = box.width / 2;
  return x >= box.x - half && x <= box.x + half
    && y >= box.y && y <= box.y + box.height
    && z >= box.z - half && z <= box.z + half;
}

let nextId = 1;

/** One arrow in flight. */
export class Arrow {
  constructor(x, y, z, vx, vy, vz, { owner = null, damage = ARROW_DAMAGE } = {}) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    this.age = 0;
    /** The body (or 'player') that must not be hit for the first quarter second. */
    this.owner = owner;
    /** What this arrow hits for — a skeleton's 3, or a drawn bow's charge. */
    this.damage = damage;
    /** Set when the arrow has ended, so the renderer can let go. */
    this.dead = false;
  }
}

/**
 * Every arrow in flight. The sim owns the motion; whoever fired the arrow
 * owns the consequences — an event comes back and the game loop turns it
 * into damage, a puff of particles, or a stuck arrow on a wall.
 */
export class Arrows {
  constructor({ cap = 64 } = {}) {
    this.list = [];
    this.cap = cap;
  }

  get count() {
    return this.list.length;
  }

  clear() {
    for (const a of this.list) a.dead = true;
    this.list.length = 0;
  }

  /**
   * Put one in the air. Returns the arrow, or null at the population cap.
   * The velocity is handed in rather than computed — a skeleton aims at an
   * eye and the player aims at a crosshair, and both know better than this
   * file where their target is.
   */
  shoot(x, y, z, vx, vy, vz, opts) {
    if (this.list.length >= this.cap) return null;
    const arrow = new Arrow(x, y, z, vx, vy, vz, opts);
    this.list.push(arrow);
    return arrow;
  }

  /**
   * Advance every arrow by `dt` seconds.
   *
   * @param {object} world `get`/`isSolid`, the real one or a test's.
   * @param {Array<{x:number, y:number, width:number, height:number, ref:*}>} targets
   *   feet-centred AABBs to hit: the player and the mobs, both passed in by
   *   the caller so this file never has to know what a player or a mob is.
   * @returns {Array<object>} `{type:'hitBlock'|'hitEntity', ...}` what ended.
   */
  update(dt, world, targets) {
    const events = [];
    if (dt <= 0) return events;

    for (const a of this.list) {
      if (a.dead) continue;
      const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / (1 / 120))));
      const h = dt / steps;
      for (let i = 0; i < steps && !a.dead; i++) {
        a.age += h;
        a.vy -= ARROW_GRAVITY * h;
        a.x += a.vx * h;
        a.y += a.vy * h;
        a.z += a.vz * h;

        // Blocks first: a wall stops an arrow before the body behind it does.
        const cx = Math.floor(a.x);
        const cy = Math.floor(a.y);
        const cz = Math.floor(a.z);
        if (world.isSolid(cx, cy, cz) && !isWater(world.get(cx, cy, cz))) {
          a.dead = true;
          events.push({ type: 'hitBlock', x: a.x, y: a.y, z: a.z, arrow: a });
          break;
        }

        // Bodies second — but not the one who fired it, for the first blink.
        for (const t of targets) {
          if (t.ref === a.owner && a.age < ARROW_IGNORE_SECONDS) continue;
          if (arrowHitsBox(a.x, a.y, a.z, t)) {
            a.dead = true;
            events.push({ type: 'hitEntity', ref: t.ref, x: a.x, y: a.y, z: a.z, arrow: a });
            break;
          }
        }
      }

      // Time out: an arrow that missed everything eventually stops existing,
      // the way a real one would stick in the ground somewhere out of sight.
      if (!a.dead && a.age >= ARROW_TTL) {
        a.dead = true;
        events.push({ type: 'expire', x: a.x, y: a.y, z: a.z, arrow: a });
      }
    }

    // Sweep the dead ones out.
    this.list = this.list.filter((a) => !a.dead);
    return events;
  }
}

/**
 * Aim a straight shot at a target point: the velocity that would carry an
 * arrow there if nothing slowed it down. The caller is expected to give the
 * target a small lead or spread if it wants one — this is the honest line,
 * and a skeleton firing exactly down it at a standing player does not miss.
 */
export function aimAt(x, y, z, tx, ty, tz, speed = ARROW_SPEED) {
  const dx = tx - x;
  const dy = ty - y;
  const dz = tz - z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { vx: (dx / len) * speed, vy: (dy / len) * speed, vz: (dz / len) * speed };
}
