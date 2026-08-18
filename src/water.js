// Where the water is: Minecraft's fluid rules, block for block, and then
// what happens when it gets cold enough to stop.
//
// The first half of the file is the flow. The second is freezing, which turns
// out to be the same kind of fact — a consequence of where the water is and
// what the world is like there, rather than anything anyone decided — and so
// is written the same transient way, and never saved.
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
  AIR, WATER, WATER_MAX_AMOUNT, ICE, FREEZING_POINT,
  isWater, isOpaque, isWaterSource, isIce, waterAmount, waterIdForAmount, waterId,
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
    /** The freeze pass, if one has attached itself — see `touch`. */
    this.ice = null;
  }

  /** True once the water has nothing left to think about. */
  get settled() {
    return this.pending.size === 0;
  }

  /** Something happened here: this cell and its neighbours may need to flow. */
  touch(x, y, z) {
    // The freeze pass, if there is one, wants to hear about exactly the same
    // cells: water that has just arrived somewhere cold is the case it is
    // most often waiting for.
    if (this.ice) this.ice.touch(x, y, z);
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

// ---------------------------------------------------------------- freezing
//
// The other thing water does: it stops.
//
// Minecraft's rule is four lines in `Biome.shouldFreeze` and every one of
// them earns its place:
//
//   cold enough    the biome's temperature, adjusted for height, below 0.15
//   a source       flowing water never freezes, only a full block does
//   dark enough    light below 10, which is what stops a torch beside a pond
//                  from being decorative
//   at an edge     at least one of the four neighbours is not water
//
// The last one is the interesting one, and it is the reason a frozen lake
// looks like a frozen lake. Ice can only form where the water meets
// something that is not water, so freezing starts at the bank and works
// inwards — and it *does* work inwards, because a cell that just froze is
// exactly what makes the next one an edge. Drop that rule and an ocean turns
// to ice in a single sheet from the middle out.
//
// Two of the four are translated rather than copied. There is no light
// engine here, so "dark enough" becomes "under open sky", which is a
// different rule that happens to draw the line in the same place for the only
// case either of them was ever about: it is what makes roofing a pond thaw
// it. And the temperature comes from the biome mix and the height (see
// terrain.js), because this world has no snowy biome — the mountains are the
// cold place, and the snow line and the ice line are the same line.
//
// Finding the water is the part Minecraft does not have to think about. It
// random-ticks every loaded chunk, sixteen cubes at a time; here there are
// three ways in, in descending order of how much anyone cares:
//
//   touch      anything the flow disturbed. Pouring a bucket out on a peak
//              should freeze while you are still standing there watching it,
//              and this is the path that does it.
//   frontier   the water beside ice that has just formed, so a sheet grows
//              without waiting to be found again.
//   prospect   a few random columns a step, for water nothing has touched.
//              Slow on purpose: it is the background, not the mechanism.
//
// And, like the flow, none of it is ever recorded. Ice is a consequence of
// where the water is and how cold it is there, so it is written transiently:
// a frozen lake adds nothing to the save file and freezes over again by
// itself the next time you come back to it.

/** How often the freeze looks at the water. */
export const FREEZE_INTERVAL_MS = 1000;

export class Freeze {
  /**
   * @param {object} world
   * @param {WaterFlow} [flow] the flow to wake when ice takes water away or
   *   gives it back, and the thing that tells this pass where to look: it
   *   forwards every cell it touches.
   * @param {object} [opts]
   */
  constructor(world, flow = null, opts = {}) {
    this.world = world;
    this.flow = flow;
    if (flow) flow.ice = this;
    /** How far out to prospect, and how far out ice is still ours to watch. */
    this.radius = opts.radius ?? 48;
    this.forget = opts.forget ?? 96;
    /** Random columns tried per step. */
    this.samples = opts.samples ?? 8;
    /** Cells that may change per step — the ice sheet's growth rate. */
    this.budget = opts.budget ?? 16;
    /** Cells that may be *looked at* per step, change or no change. */
    this.lookBudget = opts.lookBudget ?? 512;
    /** Ice re-examined per step, for thawing. */
    this.reviewBudget = opts.reviewBudget ?? 24;
    /** Cap on the backlog, so a flood cannot grow one without bound. */
    this.maxPending = opts.maxPending ?? 20000;
    /**
     * How many steps a hole chopped in the ice is left alone for.
     *
     * Minecraft closes one up too, but it gets there by random ticks — a
     * particular block waits minutes for its turn — while this pass goes
     * looking, and goes looking hardest at exactly the cell that just
     * changed. Without the delay a hole would freeze over inside a second,
     * which would make cutting one pointless: no filling a bucket from it,
     * and no getting under the ice.
     */
    this.refreezeDelay = opts.refreezeDelay ?? 15;
    this.random = opts.random ?? Math.random;
    /** Cells worth another look. */
    this.pending = new Set();
    /** Every cell we have frozen, so the thaw has something to walk. */
    this.frozen = new Set();
    /** Cells changed by the last step, for the debug screen. */
    this.lastChanged = 0;
    /** Cell -> the step number it may freeze again on. */
    this._chipped = new Map();
    this._step = 0;
    this._cursor = null;
  }

  /** Something happened here — the flow forwards every cell it touches. */
  touch(x, y, z) {
    if (this.pending.size >= this.maxPending) return;
    this.pending.add(`${x},${y},${z}`);
  }

  // ------------------------------------------------------------- the rules

  /** Is it below freezing at this exact block? */
  isCold(x, y, z) {
    return this.world.temperatureAt(x, y, z) < FREEZING_POINT;
  }

  /**
   * Is there open sky above this cell? The top solid block in the column
   * answers it: for water that is the ground underneath, for ice it is the
   * ice itself, and for either of them with something built over the top it
   * is that something.
   */
  seesSky(x, y, z) {
    return this.world.heightAt(x, z) <= y;
  }

  /** Is this cell the edge of the water — is any neighbour not water? */
  atEdge(x, y, z) {
    for (let d = 0; d < 4; d++) {
      if (!isWater(this.world.get(x + DX[d], y, z + DZ[d]))) return true;
    }
    return false;
  }

  /** Should this block of water turn to ice? */
  canFreeze(x, y, z) {
    if (!isWaterSource(this.world.get(x, y, z))) return false;
    if (!this.isCold(x, y, z)) return false;
    if (!this.atEdge(x, y, z)) return false;
    return this.seesSky(x, y, z);
  }

  /** Should this block of ice turn back into water? */
  canThaw(x, y, z) {
    if (!isIce(this.world.get(x, y, z))) return false;
    return !this.seesSky(x, y, z) || !this.isCold(x, y, z);
  }

  // ------------------------------------------------------------ the doing

  freeze(x, y, z) {
    if (!this.world.setBlockTransient(x, y, z, ICE)) return false;
    this.frozen.add(`${x},${y},${z}`);
    // The water below has lost its lid and the water beside it has lost a
    // neighbour: both are the flow's business, not ours.
    if (this.flow) this.flow.touch(x, y, z);
    // Whatever was water beside this is now at an edge, by definition.
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const nz = z + DZ[d];
      if (isWater(this.world.get(nx, y, nz))) this.touch(nx, y, nz);
    }
    return true;
  }

  /** Back to a source: it is the block it froze from. */
  thaw(x, y, z) {
    if (!this.world.setBlockTransient(x, y, z, WATER)) return false;
    this.frozen.delete(`${x},${y},${z}`);
    if (this.flow) this.flow.touch(x, y, z);
    return true;
  }

  /**
   * Chip a block of ice out. Minecraft leaves the water it was made of —
   * carrying ice away needs Silk Touch, which there is none of here — and
   * leaves nothing at all if there is no floor to hold the water, which is
   * how you get rid of it: break the block underneath first.
   */
  chip(x, y, z) {
    if (!isIce(this.world.get(x, y, z))) return false;
    const below = this.world.get(x, y - 1, z);
    const left = isOpaque(below) || isWater(below) ? WATER : AIR;
    this.world.setBlockTransient(x, y, z, left);
    this.frozen.delete(`${x},${y},${z}`);
    this._chipped.set(`${x},${y},${z}`, this._step + this.refreezeDelay);
    if (this.flow) this.flow.touch(x, y, z);
    return true;
  }

  // ----------------------------------------------------------- the looking

  /**
   * The top of the open water in a column, if it has any.
   *
   * `heightAt` is the top *solid* block and water sits on top of the ground
   * rather than in it, so any water in the column starts one block above
   * that. Which settles the sky question at the same time: a pond with
   * something built over it has that roof as its top solid block, and the
   * water underneath is never even looked at.
   */
  surfaceWater(x, z) {
    let y = this.world.heightAt(x, z) + 1;
    if (!isWater(this.world.get(x, y, z))) return null;
    while (isWater(this.world.get(x, y + 1, z))) y++;
    return y;
  }

  /** A few random columns near the player, for water nothing has disturbed. */
  prospect(px, pz) {
    for (let i = 0; i < this.samples; i++) {
      const x = px + Math.round((this.random() * 2 - 1) * this.radius);
      const z = pz + Math.round((this.random() * 2 - 1) * this.radius);
      const y = this.surfaceWater(x, z);
      if (y !== null) this.touch(x, y, z);
    }
  }

  /**
   * A rolling second look at the ice we have made, which is the only way a
   * thaw is ever noticed: nothing touches a block that someone built a roof
   * over three blocks above.
   *
   * It doubles as the bookkeeping. Ice is transient, so a chunk that was
   * evicted and generated again has none of it, and the entries for it are
   * dropped here rather than kept for a world that has forgotten them.
   */
  review(px, pz) {
    let changed = 0;
    for (let i = 0; i < this.reviewBudget && this.frozen.size > 0; i++) {
      if (!this._cursor) this._cursor = this.frozen.values();
      const next = this._cursor.next();
      if (next.done) { this._cursor = null; break; } // one lap a step, at most
      const key = next.value;
      parseKey(key, CELL);
      const [x, y, z] = CELL;
      // Distance first: asking the world about a cell it has evicted would
      // generate the chunk again just to answer.
      if (Math.abs(x - px) > this.forget || Math.abs(z - pz) > this.forget
          || !isIce(this.world.get(x, y, z))) {
        this.frozen.delete(key);
        continue;
      }
      if (this.canThaw(x, y, z) && this.thaw(x, y, z)) changed++;
    }
    return changed;
  }

  /**
   * One cell's turn. Water may freeze, ice may thaw, and anything else is a
   * cell that has changed since it was pending — which is most of them, in a
   * flood, and costs one lookup to find out.
   */
  examine(x, y, z, px, py, pz) {
    const id = this.world.get(x, y, z);
    if (isIce(id)) return this.canThaw(x, y, z) && this.thaw(x, y, z);
    if (!isWaterSource(id)) return false;
    // A hole someone chopped, still within its grace period.
    if (this._chipped.size > 0 && this._chipped.has(`${x},${y},${z}`)) return false;
    // Not over the player's own head. Minecraft would happily seal you in;
    // Minecraft also gives you a block to break your way out with, and the
    // ice here cannot be carried, so being trapped under it is a longer
    // afternoon than it sounds.
    if (x === px && z === pz && (y === py || y === py + 1)) return false;
    return this.canFreeze(x, y, z) && this.freeze(x, y, z);
  }

  /**
   * Advance the freeze one step around (px, py, pz). Returns how many cells
   * changed.
   */
  step(px, py, pz) {
    this._step++;
    for (const [key, until] of this._chipped) {
      // A hole coming out of its grace period puts itself back up for
      // consideration, because nothing else is going to: it was dropped from
      // the backlog the first time it was looked at and turned down.
      if (until <= this._step) {
        this._chipped.delete(key);
        this.pending.add(key);
      }
    }
    let changed = this.review(px, pz);
    this.prospect(px, pz);

    let looked = 0;
    const r2 = this.radius * this.radius;
    for (const key of this.pending) {
      if (changed >= this.budget || looked >= this.lookBudget) break;
      // Deleting as we go: a cell that has had its turn is either settled or
      // has put itself back through a neighbour. Cells added by a freeze
      // *during* this loop are visited by it, which is what lets a small
      // sheet finish in one step instead of one cell a second.
      this.pending.delete(key);
      looked++;
      parseKey(key, CELL);
      const dx = CELL[0] - px;
      const dz = CELL[2] - pz;
      if (dx * dx + dz * dz > r2) continue; // too far to be worth a look
      if (this.examine(CELL[0], CELL[1], CELL[2], px, py, pz)) changed++;
    }

    this.lastChanged = changed;
    return changed;
  }
}

/** Scratch for one cell, so walking a set of keys allocates nothing. */
const CELL = [0, 0, 0];

/**
 * "x,y,z" back into three numbers. The flow parses inline because it does
 * this tens of thousands of times a step; the freeze does it tens of times,
 * and can afford to be read.
 */
function parseKey(key, out) {
  const a = key.indexOf(',');
  const b = key.indexOf(',', a + 1);
  out[0] = +key.slice(0, a);
  out[1] = +key.slice(a + 1, b);
  out[2] = +key.slice(b + 1);
  return out;
}
