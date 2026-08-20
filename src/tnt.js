// TNT: a placed block that, when ignited, burns for a few seconds and then
// destroys everything around it. Minecraft's explosion in miniature —
// spherical falloff, drops for everything that survives, and no effect on
// bedrock, water or the world floor.
//
// The fuse is *transient*: it lives in a Map of lit blocks, is never saved,
// and a lit TNT block that gets unloaded simply does not exist when you come
// back (it has not exploded — the world is the same, which is what matters).
//
// The explosion itself is pure: give it a centre and a radius and it returns
// the list of (x, y, z, id) blocks that would be destroyed. The caller does
// the world writes, the drops and the effects, so this stays testable.

import { TNT, BEDROCK, AIR, isOpaque, isWater } from './terrain.js';

/** How long a lit fuse burns, in seconds (Minecraft: 4). */
export const FUSE_SECONDS = 4;

/** Blocks the blast cannot move. */
const INDESTRUCTIBLE = new Set([BEDROCK]);

/** How far from the charge a block can be and still be destroyed. */
export const BLAST_RADIUS = 3;

/**
 * Would an explosion at (cx, cy, cz) destroy the block at (bx, by, bz)?
 * Pure — the same maths as Minecraft's: distance over radius, squared,
 * with a chance that falls off so the edge of the blast is ragged rather
 * than a perfect sphere.
 */
export function blastStrength(cx, cy, cz, bx, by, bz, radius = BLAST_RADIUS) {
  const dx = bx + 0.5 - cx;
  const dy = by + 0.5 - cy;
  const dz = bz + 0.5 - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > radius * radius) return 0;
  const dist = Math.sqrt(d2);
  // Blocks very close are gone for sure; near the edge it is a lottery.
  const falloff = 1 - dist / radius;
  const chance = 0.35 + falloff * 0.65;
  return Math.random() < chance ? falloff : 0;
}

/**
 * The blocks an explosion would destroy. Returns an array of
 * { x, y, z, id, strength } sorted from the charge outward.
 */
export function blastBlocks(world, cx, cy, cz, radius = BLAST_RADIUS) {
  const out = [];
  const r = Math.ceil(radius);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let z = cz - r; z <= cz + r; z++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!world.inBounds(x, y, z)) continue;
        const id = world.get(x, y, z);
        if (id === AIR || isWater(id) || INDESTRUCTIBLE.has(id)) continue;
        const strength = blastStrength(cx, cy, cz, x, y, z, radius);
        if (strength > 0) out.push({ x, y, z, id, strength });
      }
    }
  }
  out.sort((a, b) => b.strength - a.strength);
  return out;
}

/** How much a block resists the blast, on Minecraft's scale (bedrock ∞). */
export function blockResistance(id) {
  if (id === BEDROCK) return Infinity;
  return 1;
}

/**
 * The lit-fuse bookkeeping: which TNT blocks are burning and how far along.
 * Not saved — transient state that dies with the page.
 */
export class FuseTracker {
  constructor() {
    /** Map<"x,y,z", secondsLeft> */
    this.map = new Map();
  }

  key(x, y, z) {
    return `${x},${y},${z}`;
  }

  light(x, y, z) {
    this.map.set(this.key(x, y, z), FUSE_SECONDS);
  }

  isLit(x, y, z) {
    return this.map.has(this.key(x, y, z));
  }

  /** How far along the fuse, 0..1 (for the flicker animation). */
  fraction(x, y, z) {
    const left = this.map.get(this.key(x, y, z));
    if (left === undefined) return 0;
    return 1 - left / FUSE_SECONDS;
  }

  /**
   * Advance fuses. Returns the positions that just exploded:
   * [{ x, y, z }, ...]. The caller handles the boom.
   */
  tick(dt) {
    const exploded = [];
    for (const [key, left] of this.map) {
      const next = left - dt;
      if (next <= 0) {
        const [x, y, z] = key.split(',').map(Number);
        exploded.push({ x, y, z });
        this.map.delete(key);
      } else {
        this.map.set(key, next);
      }
    }
    return exploded;
  }
}
