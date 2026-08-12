// Flowing water.
//
// A cell's level is its distance from whatever is feeding it, so the whole
// thing is a shortest-path relaxation rather than a fluid simulation:
//
//   a source                          level 0, and permanent
//   water directly above it           level 0 — a fall arrives at full
//                                     strength, which is why a stream that
//                                     drops off a ledge gets another seven
//                                     blocks of reach at the bottom
//   otherwise                         one more than the shallowest water
//                                     beside it, and nothing past 7 —
//                                     counting only neighbours that have
//                                     something under them, because water
//                                     over a drop falls instead of spreading
//
// That gives Minecraft's behaviour — seven blocks from a source, reset by
// every drop — out of one rule, and it converges for the same reason
// breadth-first search does.
//
// Two things keep it cheap. Only cells next to a change are ever looked at,
// and the results are written *transiently*: flowing water is not recorded as
// a player edit, so it costs nothing in the save file and is simply
// recomputed from the sources next time something disturbs it.

import { AIR, WATER, WATER_LEVELS, isWater, isOpaque, waterLevel, waterId } from './terrain.js';

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** How often the flow advances. Minecraft moves water every 5 ticks. */
export const FLOW_INTERVAL_MS = 250;

export class WaterFlow {
  /**
   * @param {object} world
   * @param {{radius?: number, budget?: number}} [opts] `radius` in blocks
   *   from the player — water out of sight is not worth simulating; `budget`
   *   caps how many cells one step may look at, so a big collapse spreads
   *   over several steps instead of stalling a frame.
   */
  constructor(world, opts = {}) {
    this.world = world;
    this.radius = opts.radius ?? 96;
    this.budget = opts.budget ?? 4096;
    /** Cells to re-evaluate, as "x,y,z". */
    this.pending = new Set();
    /** Cells changed by the last step, for the debug screen. */
    this.lastChanged = 0;
  }

  /** Something happened here: this cell and its neighbours may need to flow. */
  touch(x, y, z) {
    this.pending.add(`${x},${y},${z}`);
    this.pending.add(`${x},${y + 1},${z}`);
    this.pending.add(`${x},${y - 1},${z}`);
    for (const [dx, dz] of SIDES) this.pending.add(`${x + dx},${y},${z + dz}`);
  }

  /** What this cell should hold, given what is around it right now. */
  evaluate(x, y, z) {
    const world = this.world;
    const id = world.get(x, y, z);
    if (id === WATER) return WATER; // a source never drains
    if (isOpaque(id)) return id; // solid: not ours to change

    // Water arriving from above lands at full strength, whatever level it
    // was when it went over the edge.
    if (isWater(world.get(x, y + 1, z))) return waterId(0);

    let level = Infinity;
    for (const [dx, dz] of SIDES) {
      const side = world.get(x + dx, y, z + dz);
      if (!isWater(side)) continue;
      // Only water resting on solid ground spreads sideways; a falling
      // column does not. The test has to be "solid underneath" rather than
      // "not air", because once a fall reaches the bottom the cells above it
      // have water underneath and would start spreading at every height —
      // turning a waterfall into a curtain. A source always spreads.
      if (side !== WATER && !isOpaque(world.get(x + dx, y - 1, z + dz))) continue;
      const from = waterLevel(side) + 1;
      if (from < level) level = from;
    }
    if (level > WATER_LEVELS) return AIR;
    return waterId(level);
  }

  /**
   * Advance the flow one step around (px, py, pz). Returns how many cells
   * changed, which is zero once the water has settled.
   */
  step(px, py, pz) {
    if (this.pending.size === 0) {
      this.lastChanged = 0;
      return 0;
    }
    const batch = [...this.pending];
    this.pending.clear();

    const r2 = this.radius * this.radius;
    let looked = 0;
    let changed = 0;

    for (const key of batch) {
      if (looked >= this.budget) {
        // Out of budget: put the rest back for the next step rather than
        // dropping it, or a large flood would stop halfway.
        this.pending.add(key);
        continue;
      }
      const [x, y, z] = key.split(',').map(Number);
      const dx = x - px;
      const dy = y - py;
      const dz = z - pz;
      if (dx * dx + dy * dy + dz * dz > r2) continue; // too far to matter
      looked++;

      const want = this.evaluate(x, y, z);
      const have = this.world.get(x, y, z);
      if (want === have) continue;
      if (!this.world.setBlockTransient(x, y, z, want)) continue;
      changed++;
      this.touch(x, y, z);
    }

    this.lastChanged = changed;
    return changed;
  }
}
