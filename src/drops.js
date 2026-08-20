// Dropped items: the things a broken block leaves lying on the floor.
//
// Until now, breaking a block teleported it into your inventory. That is the
// convention of a hundred voxel demos and it is not Minecraft's, and the
// difference is bigger than it looks:
//
//   * A full inventory used to mean the block was *destroyed*. You would dig
//     a seam of diamond, the message would say "Inventory full", and the
//     diamond was gone. Now it lies on the ground until you make room.
//   * Blowing up a hundred blocks with TNT dropped nothing at all, because
//     posting a hundred stacks into a 36-slot inventory is a mess. As items
//     on the floor it is not a mess, it is a crater with the rubble in it,
//     and you pick up what you want.
//   * You can throw things away, which turns out to be the only way to
//     empty a slot you no longer want.
//   * And the drops are *visible*, which is the part that matters for the
//     rest of this change: every one of them is one of the three-dimensional
//     models, spinning, catching the light, and telling you what it is from
//     across the room.
//
// This file is the simulation and nothing else — positions, velocities, the
// pickup rule, merging, despawn. No THREE, no DOM. The rendering is in
// drops-render.js and reads this.
//
// The physics is Minecraft's, which is simpler than the player's: gravity,
// a drag, a bounce that keeps almost none of the impact, and a friction on
// the ground that stops a dropped block sliding across a floor forever.

import { isWater } from './terrain.js';

/** Blocks/s². Minecraft drops items at 0.04 per tick², which is 16/s². */
export const DROP_GRAVITY = 16;
/** Per-second drag. Minecraft's 0.98 per tick. */
export const DROP_DRAG = 0.4;
/** How much of the impact speed a bounce keeps. Minecraft: almost none. */
export const BOUNCE = 0.12;
/** Horizontal friction on the ground, per second. */
export const GROUND_FRICTION = 6;
/** In water an item sinks slowly and then drifts, rather than falling. */
export const WATER_SINK = 0.6;
export const WATER_DRAG = 3.2;

/** Half-width of an item's collision box, in blocks. */
export const DROP_RADIUS = 0.125;
/** How tall it is. */
export const DROP_HEIGHT = 0.25;

/**
 * How close you have to be for it to come to you.
 *
 * Minecraft's is 1 block on the horizontal and 0.5 vertically, measured
 * between hitboxes rather than centres, which in practice means "walk over
 * it". Slightly generous here because there is no hunger bar to make you
 * value the walk.
 */
export const PICKUP_RADIUS = 1.35;
/** ...and the range at which it starts *flying* toward you. */
export const MAGNET_RADIUS = 2.6;
/** How fast it flies in. */
export const MAGNET_SPEED = 8;

/**
 * Seconds before an item pops. Minecraft's five minutes.
 *
 * It exists for the same reason Minecraft's does: without it, a TNT crater
 * leaves four hundred entities on the floor forever and the frame rate is
 * the thing that pays for your explosion.
 */
export const DESPAWN_SECONDS = 300;

/**
 * Seconds after a drop is created before it can be picked up.
 *
 * Minecraft's half-second, and it is not a detail: without it, an item you
 * threw would be picked straight back up on the same frame, so dropping
 * something would do nothing at all and look like the key was broken.
 */
export const PICKUP_DELAY = 0.5;

/**
 * The impact speed below which a landing is silent: about a block's fall.
 *
 * Two things have to be quiet and this one number decides both. A block
 * popping out of the cell you just mined rises a few centimetres and comes
 * back down at around 4 m/s, and it does not want a thud of its own — the
 * break sound is already playing over it. And the bounce after a real
 * landing keeps BOUNCE of the impact, so even a fall from cloud height
 * bounces back at only a couple of m/s. Setting the bar at a block's worth
 * of fall — sqrt(2 · 16 · 1.1) ≈ 5.9 — puts both of those below it, and
 * leaves anything that genuinely fell somewhere above it.
 */
export const LAND_SOUND_SPEED = 6;

/** Two drops merge if they are this close and hold the same thing. */
export const MERGE_RADIUS = 0.6;
/** ...and no more often than this, because it is an O(n²) scan. */
export const MERGE_INTERVAL = 0.5;

/** How high a drop bobs, and how fast it turns. */
export const BOB_HEIGHT = 0.08;
export const BOB_RATE = 2.2;
export const SPIN_RATE = 1.1; // radians/s

/** Stack ceiling, matching the inventory's. */
const STACK_MAX = 64;

let nextId = 1;

/**
 * One dropped item.
 *
 * `durability` rides along because a tool that fell out of a broken furnace,
 * or that you threw away with forty uses left, is still that tool. Dropping
 * a part-used pickaxe and picking it back up must not repair it.
 */
export class Drop {
  constructor(x, y, z, id, count = 1, durability = undefined) {
    this.id = id;
    this.count = count;
    this.durability = durability;
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.age = 0;
    this.pickupIn = PICKUP_DELAY;
    this.onGround = false;
    this.inWater = false;
    /**
     * Impact speed of the landing that happened during the last step, or 0.
     * Read and cleared by whoever is playing sounds; kept as a number rather
     * than a flag so a block dropped off a cliff can land harder than one
     * nudged off a ledge.
     */
    this.landed = 0;
    /**
     * Cleared on the first impact of a fall and re-armed when the drop is
     * airborne again.
     *
     * A drop bounces two or three times before it settles, and every bounce
     * is an impact. Thresholding the speed does not separate them: a long
     * enough fall arrives fast enough that even a tenth of it clears any
     * threshold low enough to catch an ordinary landing. One sound per fall
     * is the rule, so this is a latch rather than a comparison.
     */
    this._canLand = true;
    /** Per-drop phase so a pile of them does not bob in lockstep. */
    this.phase = Math.random() * Math.PI * 2;
    this.key = nextId++;
    /** Set when the drop has been collected, so the renderer can let go. */
    this.dead = false;
  }

  /** The stack this drop would put in an inventory. */
  toStack() {
    return this.durability === undefined
      ? { id: this.id, count: this.count }
      : { id: this.id, count: this.count, durability: this.durability };
  }
}

/**
 * Give a drop a shove.
 *
 * Two callers and they want different things. A block that was mined pops
 * gently straight up with a little scatter, so a seam you dig leaves a neat
 * trail rather than a shotgun blast. A block you *threw* goes where you were
 * looking, hard enough to clear your own pickup radius — which is the whole
 * point of throwing it.
 */
export function popFromBlock(drop, rand = Math.random) {
  const a = rand() * Math.PI * 2;
  const r = rand() * 0.9;
  drop.vx = Math.cos(a) * r;
  drop.vz = Math.sin(a) * r;
  drop.vy = 1.8 + rand() * 0.9;
  return drop;
}

/** Throw a drop along a look direction. */
export function throwAlong(drop, dir, speed = 5.2) {
  drop.vx = dir.x * speed;
  drop.vy = dir.y * speed + 1.2;
  drop.vz = dir.z * speed;
  // A thrown item must not come straight back, so it waits a little longer
  // than a mined one before it is collectable.
  drop.pickupIn = Math.max(drop.pickupIn, 0.85);
  return drop;
}

/**
 * The whole population of dropped items.
 *
 * A flat array and a linear scan: a busy world has tens of these, a TNT
 * crater has a few hundred, and a spatial index for a few hundred moving
 * points that all want to know about one player is more machinery than the
 * scan it replaces.
 */
export class Drops {
  constructor({ max = 512 } = {}) {
    this.items = [];
    this.max = max;
    this._mergeIn = 0;
    /** Counted for the debug screen: how many have popped for age. */
    this.despawned = 0;
  }

  get count() {
    return this.items.length;
  }

  clear() {
    for (const d of this.items) d.dead = true;
    this.items.length = 0;
  }

  /**
   * Add a drop. Returns it, or null when the world is already at its limit —
   * which is not a failure worth reporting: the cap exists because five
   * hundred items on the floor is already more than anyone is going to pick
   * up, and the five hundred and first is not the interesting one.
   */
  add(x, y, z, id, count = 1, durability = undefined) {
    if (!id || count <= 0) return null;
    if (this.items.length >= this.max) return null;
    const drop = new Drop(x, y, z, id, count, durability);
    this.items.push(drop);
    return drop;
  }

  /** A block that has just been mined, popping out of its own cell. */
  spawnFromBlock(x, y, z, id, count = 1, durability = undefined, rand = Math.random) {
    const drop = this.add(x + 0.5, y + 0.35, z + 0.5, id, count, durability);
    if (drop) popFromBlock(drop, rand);
    return drop;
  }

  /**
   * Step the whole population.
   *
   * @param {number} dt seconds
   * @param {object} world anything with isSolid(x, y, z) and get(x, y, z)
   * @param {object} [player] { pos, height } — the thing drops fly toward
   * @param {(drop: Drop) => number} [collect]
   *   Called when a drop reaches the player. Returns how many items were
   *   actually taken; the drop keeps whatever did not fit, which is what
   *   makes a full inventory leave the rest on the floor instead of eating
   *   it. Return 0 and the drop is simply not collected this frame.
   */
  update(dt, world, player = null, collect = null) {
    if (dt <= 0) return;
    this._mergeIn -= dt;
    const doMerge = this._mergeIn <= 0;
    if (doMerge) this._mergeIn = MERGE_INTERVAL;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.landed = 0;
      d.age += dt;
      if (d.pickupIn > 0) d.pickupIn = Math.max(0, d.pickupIn - dt);

      if (d.age >= DESPAWN_SECONDS) {
        d.dead = true;
        this.despawned++;
        this._removeAt(i);
        continue;
      }

      this._physics(d, dt, world);

      if (player && collect && d.pickupIn <= 0) {
        const took = this._tryCollect(d, dt, player, collect);
        if (took) {
          this._removeAt(i);
          continue;
        }
      }
    }

    if (doMerge) this._merge();
  }

  /**
   * The hardest landing that happened in the last `update`, as an impact
   * speed, or 0 for none.
   *
   * One number for the whole population rather than one event per drop: a
   * broken furnace spills five things at once and they all land within a few
   * frames of each other, and five overlapping thuds is a bang. Minecraft
   * has the same problem and solves it the same way — one sound, at the
   * volume of the biggest impact.
   */
  loudestLanding() {
    let best = 0;
    for (const d of this.items) {
      if (d.landed > best) best = d.landed;
    }
    return best >= LAND_SOUND_SPEED ? best : 0;
  }

  _removeAt(i) {
    const last = this.items.length - 1;
    if (i !== last) this.items[i] = this.items[last];
    this.items.pop();
  }

  /**
   * One drop's motion for one step.
   *
   * Axis at a time against the world, the same way the player moves, because
   * anything else lets a fast drop tunnel through a floor — and a drop that
   * falls through the floor is a drop you dug for and cannot have.
   */
  _physics(d, dt, world) {
    const cell = world.get(Math.floor(d.x), Math.floor(d.y + DROP_HEIGHT * 0.5), Math.floor(d.z));
    d.inWater = isWater(cell);

    if (d.inWater) {
      // Water: sinks slowly, and everything is damped. Minecraft actually
      // floats items up to the surface; sinking is chosen here because the
      // alternative is a diamond bobbing on top of the sea a hundred blocks
      // out where you cannot reach it.
      d.vy -= WATER_SINK * dt;
      const k = Math.min(1, WATER_DRAG * dt);
      d.vx -= d.vx * k;
      d.vy -= d.vy * k;
      d.vz -= d.vz * k;
    } else {
      d.vy -= DROP_GRAVITY * dt;
      const k = Math.min(1, DROP_DRAG * dt);
      d.vx -= d.vx * k;
      d.vz -= d.vz * k;
    }

    // ---- x ----
    if (d.vx !== 0) {
      const nx = d.x + d.vx * dt;
      if (this._blocked(world, nx + Math.sign(d.vx) * DROP_RADIUS, d.y, d.z)) {
        d.vx = 0;
      } else {
        d.x = nx;
      }
    }
    // ---- z ----
    if (d.vz !== 0) {
      const nz = d.z + d.vz * dt;
      if (this._blocked(world, d.x, d.y, nz + Math.sign(d.vz) * DROP_RADIUS)) {
        d.vz = 0;
      } else {
        d.z = nz;
      }
    }
    // ---- y ----
    d.onGround = false;
    if (d.vy !== 0) {
      const ny = d.y + d.vy * dt;
      if (d.vy < 0 && this._blocked(world, d.x, ny, d.z)) {
        d.y = Math.floor(ny) + 1;
        // Recorded before the bounce eats it. Water swallows the sound, which
        // is also why a drop thrown into a lake is quiet.
        if (!d.inWater && d._canLand) {
          d.landed = -d.vy;
          d._canLand = false;
        }
        // A bounce that keeps a tenth of the impact, so a block dropped from
        // a cliff settles rather than jittering on the spot forever.
        d.vy = -d.vy * BOUNCE;
        if (Math.abs(d.vy) < 0.4) d.vy = 0;
        d.onGround = true;
      } else if (d.vy > 0 && this._blocked(world, d.x, ny + DROP_HEIGHT, d.z)) {
        d.vy = 0;
      } else {
        d.y = ny;
        // Airborne and moving fast enough that the next impact will be a real
        // one: arm the sound again. The threshold is what stops a drop
        // resting on the ground with a hair of numerical drift re-arming
        // itself every frame and buzzing.
        if (Math.abs(d.vy) > LAND_SOUND_SPEED) d._canLand = true;
      }
    } else {
      d.onGround = this._blocked(world, d.x, d.y - 1e-3, d.z);
    }

    if (d.onGround && !d.inWater) {
      const k = Math.min(1, GROUND_FRICTION * dt);
      d.vx -= d.vx * k;
      d.vz -= d.vz * k;
      if (Math.abs(d.vx) < 0.01) d.vx = 0;
      if (Math.abs(d.vz) < 0.01) d.vz = 0;
    }
  }

  _blocked(world, x, y, z) {
    return world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  /**
   * Fly toward the player and, if close enough, be collected.
   * Returns true when the drop is gone.
   */
  _tryCollect(d, dt, player, collect) {
    const px = player.pos.x;
    const py = player.pos.y + (player.height ?? 1.8) * 0.4;
    const pz = player.pos.z;
    const dx = px - d.x;
    const dy = py - d.y;
    const dz = pz - d.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > MAGNET_RADIUS) return false;

    if (dist <= PICKUP_RADIUS) {
      const took = collect(d);
      if (took >= d.count) {
        d.dead = true;
        return true;
      }
      if (took > 0) d.count -= took;
      return false;
    }

    // Inside the magnet ring: move toward the player rather than teleporting,
    // because the little rush of items coming to you is half of what makes
    // picking things up feel good.
    //
    // This moves the *position*, not the velocity, and that is deliberate.
    // Adding velocity is the obvious implementation and it does not work: an
    // item resting on the ground is under a friction of 6/s, which eats the
    // pull almost as fast as it is applied, so a drop at your feet crawls in
    // at a few centimetres a second while one falling through the air shoots
    // over. Minecraft moves the entity directly for the same reason. The
    // velocity is damped alongside so that an item flying in does not keep
    // its old momentum and sail past you.
    const step = Math.min(dist, MAGNET_SPEED * dt);
    const k = step / dist;
    d.x += dx * k;
    d.y += dy * k;
    d.z += dz * k;
    const damp = Math.min(1, 8 * dt);
    d.vx -= d.vx * damp;
    d.vy -= d.vy * damp;
    d.vz -= d.vz * damp;
    return false;
  }

  /**
   * Fold nearby drops of the same thing together.
   *
   * A wall you mined is thirty separate stacks of one, and thirty entities
   * where one would do is thirty times the physics and thirty draw calls'
   * worth of instances. Tools are never merged — each carries its own
   * durability, and folding two half-worn pickaxes into a stack of two would
   * throw one of those numbers away, exactly as the inventory's sort refuses
   * to.
   */
  _merge() {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.durability !== undefined || a.count >= STACK_MAX) continue;
      for (let j = items.length - 1; j > i; j--) {
        const b = items[j];
        if (b.id !== a.id || b.durability !== undefined) continue;
        if (Math.abs(a.x - b.x) > MERGE_RADIUS) continue;
        if (Math.abs(a.y - b.y) > MERGE_RADIUS) continue;
        if (Math.abs(a.z - b.z) > MERGE_RADIUS) continue;
        const room = STACK_MAX - a.count;
        if (room <= 0) break;
        const move = Math.min(room, b.count);
        a.count += move;
        b.count -= move;
        // The merged drop takes the younger one's age, so combining two piles
        // does not make the result despawn on the older one's clock.
        a.age = Math.min(a.age, b.age);
        if (b.count <= 0) {
          b.dead = true;
          this._removeAt(j);
        }
      }
    }
  }

  /**
   * Drops within `radius` of a point, for the debug screen and for anything
   * that wants to clear a region (a blast, a chunk unloading).
   */
  near(x, y, z, radius) {
    const r2 = radius * radius;
    return this.items.filter((d) => {
      const dx = d.x - x;
      const dy = d.y - y;
      const dz = d.z - z;
      return dx * dx + dy * dy + dz * dz <= r2;
    });
  }

  /**
   * Throw away everything further than `radius` from the player.
   *
   * The world streams; an item dropped forty chunks back is in a chunk that
   * no longer has any block data, so its physics is falling through an empty
   * world. Minecraft keeps entities only in loaded chunks and so does this.
   */
  evictOutside(x, z, radius) {
    const r2 = radius * radius;
    let removed = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      const dx = d.x - x;
      const dz = d.z - z;
      if (dx * dx + dz * dz > r2) {
        d.dead = true;
        this._removeAt(i);
        removed++;
      }
    }
    return removed;
  }

  /**
   * How high a drop rides above its own position this instant, and how far it
   * has turned. Pure, so the renderer holds no state of its own and a paused
   * game freezes the spin along with everything else.
   */
  static bob(drop, clock) {
    return {
      lift: Math.sin(clock * BOB_RATE + drop.phase) * BOB_HEIGHT,
      spin: (clock * SPIN_RATE + drop.phase) % (Math.PI * 2),
    };
  }
}
