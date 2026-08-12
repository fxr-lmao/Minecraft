// Flowing water: Minecraft's fluid rules, block for block.
//
// The first version of this file computed a cell's level as its distance from
// the nearest thing feeding it — a shortest-path relaxation. It gave the right
// numbers for the easy cases (seven blocks from a source, reset by a fall) and
// it converged for the same reason breadth-first search does, but it was the
// wrong shape, because it was a *pull*: every cell asked its neighbours what
// it should be. Real water is a *push*. A block of water decides where to send
// itself, and that decision is the interesting part:
//
//   water on flat ground spreads in every direction,
//   water three blocks from a hole goes to the hole and nowhere else.
//
// You cannot get the second behaviour by pulling, and it is most of what makes
// Minecraft's water feel like water — dig a channel and the sea *finds* it.
//
// So this is the push model, following FlowingFluid:
//
//   getNewLiquid    what a cell should hold given what is around it. Falling
//                   water arrives at full strength; otherwise one less than
//                   the fullest neighbour; two sources and something solid
//                   underneath make a new source, which is why a pool you dig
//                   out of the sea never drains.
//   spread          down if it can, sideways otherwise. Water over a drop
//                   falls instead of spreading, which is what stops a
//                   waterfall from smearing into a curtain.
//   getSpread       of the four ways out, which ones are worth taking —
//                   ranked by
//   getSlopeDistance  how far you would have to walk that way to find a hole,
//                   searching up to four blocks ahead. Ties spread to every
//                   direction that ties, so flat ground still floods evenly.
//
// Two things keep it cheap:
//
//   * Only cells next to a change are ever looked at. The sea is millions of
//     blocks of water that cost exactly nothing, because nothing is happening
//     to them.
//   * Results are written *transiently*. Flowing water is a consequence of the
//     terrain, not a decision anyone made, so it is never recorded as a player
//     edit: a flooded cavern adds nothing to the save file and simply refills
//     from its source the next time something disturbs it.

import {
  AIR, WATER, WATER_MAX_AMOUNT,
  isWater, isOpaque, isWaterSource, waterAmount, waterIdForAmount, waterId,
} from './terrain.js';

const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];
/** Index of the direction facing back the way you came. */
const OPPOSITE = [1, 0, 3, 2];

/**
 * How much a block of water loses per block travelled. One in the overworld,
 * two in the Nether — which is why lava spreads four blocks there and seven
 * here off the same arithmetic.
 */
export const DROP_OFF = 1;

/** How far ahead the search for a hole looks. Minecraft's number. */
export const SLOPE_FIND_DISTANCE = 4;

/** How often the flow advances. Minecraft moves water every 5 ticks. */
export const FLOW_INTERVAL_MS = 250;

export class WaterFlow {
  /**
   * @param {object} world
   * @param {{radius?: number, workBudget?: number}} [opts]
   *   `radius` in blocks from the player — water you cannot see is not worth
   *   simulating; `workBudget` caps how much *looking* one step may do, so a
   *   dam bursting spreads over several steps instead of stalling a frame.
   */
  constructor(world, opts = {}) {
    this.world = world;
    this.radius = opts.radius ?? 96;
    this.workBudget = opts.workBudget ?? 24000;
    /** Cells to re-examine, as "x,y,z". */
    this.pending = new Set();
    /** Cells changed by the last step, for the debug screen. */
    this.lastChanged = 0;
    this._work = 0;
    /** Per-spread memo of "is there a hole under this cell", as MC does. */
    this._holes = new Map();
  }

  /** True once the water has nothing left to think about. */
  get settled() {
    return this.pending.size === 0;
  }

  /** Something happened here: this cell and its neighbours may need to flow. */
  touch(x, y, z) {
    this.pending.add(`${x},${y},${z}`);
    this.pending.add(`${x},${y + 1},${z}`);
    this.pending.add(`${x},${y - 1},${z}`);
    for (let d = 0; d < 4; d++) this.pending.add(`${x + DX[d]},${y},${z + DZ[d]}`);
  }

  // ------------------------------------------------------------- the rules

  /**
   * What this cell should hold, given what is around it right now.
   *
   * Sources are not asked — they answer for themselves and never drain — so
   * this is only ever the truth for a cell that is flowing or empty.
   */
  getNewLiquid(x, y, z) {
    const world = this.world;
    this._work++;

    let strongest = 0;
    let sources = 0;
    for (let d = 0; d < 4; d++) {
      const side = world.get(x + DX[d], y, z + DZ[d]);
      if (!isWater(side)) continue;
      if (isWaterSource(side)) sources++;
      const amount = waterAmount(side);
      if (amount > strongest) strongest = amount;
    }

    // Two sources side by side, on something that will hold them, make a
    // third. This is Minecraft's infinite water, and the reason a channel cut
    // from the sea stays full instead of thinning to a trickle: past two
    // blocks wide, the channel *is* sea.
    if (sources >= 2) {
      const below = world.get(x, y - 1, z);
      if (isOpaque(below) || isWaterSource(below)) return WATER;
    }

    // Water landing from above arrives at full strength, however thin it was
    // when it went over the edge. That is what gives a stream another seven
    // blocks of reach at the bottom of every drop.
    if (isWater(world.get(x, y + 1, z))) return waterId(0);

    return waterIdForAmount(strongest - DROP_OFF);
  }

  /** Can water move into this cell at all? Only air will take it. */
  canSpreadTo(x, y, z) {
    return this.world.get(x, y, z) === AIR;
  }

  /**
   * Can the search walk through this cell while looking for a hole? Air can,
   * and so can water that is only flowing — a stream will happily run along
   * its own shallow end to reach a drop. A source will not: it is already as
   * full as it can be and nothing is going to move through it.
   */
  canPassThrough(x, y, z) {
    const id = this.world.get(x, y, z);
    return !isOpaque(id) && !isWaterSource(id);
  }

  /** Would water put here fall out the bottom? */
  isWaterHole(x, y, z) {
    const key = `${x},${y},${z}`;
    const hit = this._holes.get(key);
    if (hit !== undefined) return hit;
    const below = this.world.get(x, y - 1, z);
    const hole = !isOpaque(below);
    this._holes.set(key, hole);
    return hole;
  }

  /**
   * How many blocks away the nearest drop is, if you set off from here in any
   * direction other than back the way you came. 1000 means "no drop within
   * range", and since every direction that ties for the minimum gets water,
   * 1000 everywhere is exactly the flat-ground case: spread evenly.
   */
  getSlopeDistance(x, y, z, depth, skip) {
    let best = 1000;
    for (let d = 0; d < 4; d++) {
      if (d === skip) continue;
      const nx = x + DX[d];
      const nz = z + DZ[d];
      if (!this.canPassThrough(nx, y, nz)) continue;
      this._work++;
      if (this.isWaterHole(nx, y, nz)) return depth;
      if (depth < SLOPE_FIND_DISTANCE) {
        const found = this.getSlopeDistance(nx, y, nz, depth + 1, OPPOSITE[d]);
        if (found < best) best = found;
      }
    }
    return best;
  }

  /**
   * Which of the four directions this cell should push into, and what they
   * would become. Every direction that ties for the shortest walk to a drop
   * wins; a direction with a longer walk gets nothing at all.
   *
   * Note what is *not* checked here: whether the direction can actually take
   * any water. A direction already full of water still competes, and usually
   * wins, and then quietly receives nothing — which is the point. Drop that
   * and a source beside a hole sends its first block of water at the hole and
   * then, finding that way occupied, spreads in every other direction
   * instead. Ranking a direction and filling it are two different questions.
   *
   * Written into `outDirs` / `outIds` and returned as a count, because this
   * runs for every frontier cell of a flood and has no business allocating.
   */
  getSpread(x, y, z, outDirs, outIds) {
    let best = 1000;
    let n = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const nz = z + DZ[d];
      if (!this.canPassThrough(nx, y, nz)) continue;
      const id = this.getNewLiquid(nx, y, nz);
      if (id === AIR) continue;

      const slope = this.isWaterHole(nx, y, nz)
        ? 0
        : this.getSlopeDistance(nx, y, nz, 1, OPPOSITE[d]);
      if (slope < best) {
        n = 0; // a shorter way exists: everything found so far is off the list
        best = slope;
      }
      if (slope <= best) {
        outDirs[n] = d;
        outIds[n] = id;
        n++;
      }
    }
    return n;
  }

  /** How many of the four neighbours are sources — three lets a fall spread. */
  sourceNeighbours(x, y, z) {
    let n = 0;
    for (let d = 0; d < 4; d++) {
      if (isWaterSource(this.world.get(x + DX[d], y, z + DZ[d]))) n++;
    }
    return n;
  }

  /** Is this water falling — that is, is there more of it directly above? */
  isFalling(x, y, z, id) {
    return !isWaterSource(id) && isWater(this.world.get(x, y + 1, z));
  }

  // ------------------------------------------------------------ the pushing

  /** Move water into a cell and wake everything around it. */
  spreadTo(x, y, z, id, changed) {
    if (!this.world.setBlockTransient(x, y, z, id)) return changed;
    this.touch(x, y, z);
    return changed + 1;
  }

  /**
   * One block of water decides where to send itself: down if there is
   * anywhere to go, sideways otherwise.
   *
   * The "otherwise" is load-bearing. Water standing over a hole does not also
   * spread sideways, which is what keeps a waterfall a column rather than a
   * sheet — the exception being water fed by three or more sources, which has
   * more than it can push through one hole and spills as well.
   */
  spread(x, y, z, id, changed) {
    const canFall = this.canSpreadTo(x, y - 1, z);
    if (canFall) {
      changed = this.spreadTo(x, y - 1, z, this.getNewLiquid(x, y - 1, z), changed);
      if (this.sourceNeighbours(x, y, z) < 3) return changed;
    } else if (!isWaterSource(id) && this.isWaterHole(x, y, z)) {
      // Sitting on water that is itself about to move: wait for it.
      return changed;
    }
    return this.spreadToSides(x, y, z, id, changed);
  }

  spreadToSides(x, y, z, id, changed) {
    // Is there anything left to give? Falling water always has seven ninths
    // to hand on however thin it was on the way down, which is the rule that
    // gives the foot of a waterfall the same reach as a source. What each
    // neighbour actually receives is worked out from its own surroundings,
    // in getNewLiquid; this only decides whether to bother asking.
    let amount = waterAmount(id) - DROP_OFF;
    if (this.isFalling(x, y, z, id)) amount = WATER_MAX_AMOUNT - DROP_OFF;
    if (amount <= 0) return changed;

    const n = this.getSpread(x, y, z, SPREAD_DIRS, SPREAD_IDS);
    for (let i = 0; i < n; i++) {
      const d = SPREAD_DIRS[i];
      const tx = x + DX[d];
      const tz = z + DZ[d];
      if (!this.canSpreadTo(tx, y, tz)) continue; // won a race it had already won
      changed = this.spreadTo(tx, y, tz, SPREAD_IDS[i], changed);
    }
    return changed;
  }

  // ------------------------------------------------------------- the ticking

  /**
   * One cell's turn: settle what it holds, then let it push. Cells that are
   * not water do nothing — air is filled by its neighbours spreading into it,
   * never by deciding to fill itself, which is the whole difference between
   * this and the relaxation it replaced.
   */
  tickCell(x, y, z, changed) {
    let id = this.world.get(x, y, z);
    if (!isWater(id)) return changed;
    // The hole memo is only good for as long as the terrain is: one cell's
    // turn cannot make anything solid, so it holds for exactly that long.
    this._holes.clear();

    if (!isWaterSource(id)) {
      const want = this.getNewLiquid(x, y, z);
      if (want !== id) {
        if (!this.world.setBlockTransient(x, y, z, want)) return changed;
        this.touch(x, y, z);
        changed++;
        if (!isWater(want)) return changed; // it dried up; nothing left to push
        id = want;
      }
    }
    return this.spread(x, y, z, id, changed);
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
    let changed = 0;
    this._work = 0;

    for (const key of batch) {
      if (this._work >= this.workBudget) {
        // Out of budget: put the rest back for the next step rather than
        // dropping it, or a large flood would stop halfway.
        this.pending.add(key);
        continue;
      }
      const comma = key.indexOf(',');
      const comma2 = key.indexOf(',', comma + 1);
      const x = +key.slice(0, comma);
      const y = +key.slice(comma + 1, comma2);
      const z = +key.slice(comma2 + 1);
      const dx = x - px;
      const dy = y - py;
      const dz = z - pz;
      if (dx * dx + dy * dy + dz * dz > r2) continue; // too far to matter
      changed = this.tickCell(x, y, z, changed);
    }

    this.lastChanged = changed;
    return changed;
  }
}

// Scratch for one cell's spread decision. Four directions is the most there
// can ever be, and reusing them keeps a flood from allocating per cell.
const SPREAD_DIRS = new Int8Array(4);
const SPREAD_IDS = new Int16Array(4);
