// Fluid geometry: the half of water you actually look at.
//
// A voxel game draws every other block as a cube, and the obvious thing to do
// with water is the same — a box, shortened to match how much water is in the
// cell. That is what this used to do, and it looks terrible the moment water
// is anything other than a flat sea, because a spreading stream is a
// staircase of different levels and a box per level is a staircase of
// disconnected slabs with the floor showing through every joint.
//
// Minecraft does not draw water as boxes. It draws it as a *surface*, and the
// trick is a single idea:
//
//   the height of the surface is defined at the corners, not at the cells,
//   and a corner's height is the average of the four cells that touch it.
//
// Two neighbouring cells share two corners, so whatever heights they end up
// with, their two quads meet exactly along that edge. The staircase becomes a
// slope, the joints close, and — this is the part that matters — nothing has
// to be done about the joints at all. There is no seam to patch because two
// quads that agree on their shared corners have no seam.
//
// Everything else in here follows Minecraft's LiquidBlockRenderer and
// FlowingFluid.getFlow closely enough to be worth reading side by side:
//
//   * the ×10 weighting that keeps a full cell's corners from being dragged
//     down by a shallow one beside it,
//   * a flow vector per cell, from the height differences around it, which
//     picks the still or the flowing texture and rotates the flowing one so
//     the streaks run downhill,
//   * side faces from the corner heights down to the cell floor, inset a
//     thousandth of a block so they never z-fight the block they run past.
//
// Alongside the geometry it measures the things the *shader* needs and cannot
// work out for itself — how deep the water is, how close it is to the shore,
// how much each corner is allowed to bob, and whether it is churning. Four
// bytes a vertex, and between them they are the difference between a flat
// blue sheet and something that looks like water. See water-shader.js.
//
// No THREE and no DOM: this is arrays in, arrays out, so the tests can check
// the geometry directly.

import { CHUNK_SIZE, WORLD_HEIGHT, fromLayer } from './constants.js';
import { AIR, isWater, isOpaque, waterAmount } from './terrain.js';

const AREA = CHUNK_SIZE * CHUNK_SIZE;

/** Minecraft draws a cell holding `amount` ninths of water at amount/9. */
export const fluidOwnHeight = (id) => waterAmount(id) / 9;

/**
 * A cell at least this tall counts as full when corners are averaged. A
 * source is 8/9 ≈ 0.889 and clears it; one level of flow is 7/9 ≈ 0.778 and
 * does not. Minecraft's number, and the reason a sea keeps a flat surface
 * right up to the shore instead of sagging into every puddle beside it.
 */
const FULL_ENOUGH = 0.8;

/** The weight a full cell carries. Ten shallow cells to outvote one. */
const FULL_WEIGHT = 10;

/**
 * How broken the exposed edge of water that is *not* falling counts as. The
 * side of a pool that happens to have air beside it is water with a bit of a
 * ripple, not a cataract.
 */
export const STILL_EDGE_CHURN = 0.3;

/** Side faces sit this far inside the cell, so they never z-fight. */
const SIDE_INSET = 0.001;

/**
 * How far down a corner looks for more water, and the depth that counts as
 * "as deep as it gets" for colouring. Eight blocks: the shader has gone as
 * dark as it goes by then, and the ocean floor is rarely further than that
 * below the surface.
 */
export const DEPTH_SCALE = 8;

/** Which texture a face wants: the still tile or the flowing one. */
export const STILL = 0;
export const FLOWING = 1;

/** Corners of the chunk's grid: one more than there are cells, each way. */
const CORNERS = (CHUNK_SIZE + 1) * (CHUNK_SIZE + 1);

/** Two triangles from four corners: 0-1-2 and 0-2-3. */
const TRIANGLES = [0, 1, 2, 0, 2, 3];

/**
 * One growable pile of triangles. Positions are floats (fluid surfaces are
 * fractions of a block), normals are the usual -1/0/1, UVs are 16-bit
 * normalised — a thousandth of a texel, far finer than anything here needs —
 * and the shader's four extra channels are single bytes, which is 1/255 of
 * their range and finer than anything they drive.
 */
class QuadBuffer {
  constructor(quads = 1024) {
    this._alloc(quads);
    this.n3 = 0;
    this.n2 = 0;
    this.n4 = 0;
  }

  _alloc(quads) {
    this.cap = quads;
    this.pos = new Float32Array(quads * 18);
    this.nrm = new Int8Array(quads * 18);
    this.uv = new Uint16Array(quads * 12);
    this.dat = new Uint8Array(quads * 24);
  }

  reset() {
    this.n3 = 0;
    this.n2 = 0;
    this.n4 = 0;
  }

  _grow() {
    const { pos, nrm, uv, dat } = this;
    this._alloc(this.cap * 2);
    this.pos.set(pos);
    this.nrm.set(nrm);
    this.uv.set(uv);
    this.dat.set(dat);
  }

  /**
   * Write a quad from four corners wound counter-clockwise seen from
   * outside. `v` holds x,y,z per corner, `t` holds u,v, and `d` holds the
   * four shader channels; all three are scratch arrays owned by the mesher,
   * never allocated here.
   */
  quad(v, t, d, nx, ny, nz) {
    if (this.n3 + 18 > this.pos.length) this._grow();
    let i3 = this.n3;
    let i2 = this.n2;
    let i4 = this.n4;
    for (let k = 0; k < 6; k++) {
      const c = TRIANGLES[k];
      this.pos[i3] = v[c * 3];
      this.pos[i3 + 1] = v[c * 3 + 1];
      this.pos[i3 + 2] = v[c * 3 + 2];
      this.nrm[i3] = nx;
      this.nrm[i3 + 1] = ny;
      this.nrm[i3 + 2] = nz;
      i3 += 3;
      this.uv[i2] = t[c * 2] * 65535;
      this.uv[i2 + 1] = t[c * 2 + 1] * 65535;
      i2 += 2;
      this.dat[i4] = d[c * 4] * 255;
      this.dat[i4 + 1] = d[c * 4 + 1] * 255;
      this.dat[i4 + 2] = d[c * 4 + 2] * 255;
      this.dat[i4 + 3] = d[c * 4 + 3] * 255;
      i4 += 4;
    }
    this.n3 = i3;
    this.n2 = i2;
    this.n4 = i4;
  }

  /** A copy trimmed to what was actually written. */
  take() {
    return {
      pos: this.pos.slice(0, this.n3),
      n: this.nrm.slice(0, this.n3),
      uv: this.uv.slice(0, this.n2),
      data: this.dat.slice(0, this.n4),
    };
  }
}

/**
 * Builds the water surface for one chunk.
 *
 * Used from the block mesher: `begin` once per chunk, `cell` for every water
 * block found during its column scan, `end` to collect the geometry. Faces
 * are sorted into two buckets as they are made — still water and flowing
 * water are different textures, and a chunk pays for the second one only if
 * it actually contains a current.
 *
 * Everything is in the mesher's coordinates: chunk-local x/z and *layers*
 * (y − WORLD_MIN_Y), matching the opaque geometry, so both meshes can hang
 * off the same chunk origin.
 */
export class FluidMesher {
  constructor() {
    this.buffers = [new QuadBuffer(), new QuadBuffer()];
    /**
     * Corner heights, memoised: every corner is shared by four cells, so
     * without this each one is worked out four times over.
     *
     * It is a grid rather than a map, stamped with the layer it was filled
     * for — a chunk of open sea asks for four thousand of these and a hash
     * lookup each was costing more than the arithmetic it saved. One entry
     * per (x, z) corner is enough because a column has a surface at one
     * layer almost always; a waterfall re-computes as it passes, which is
     * correct either way and rare enough not to matter.
     */
    this.cornerHeight = new Float32Array(CORNERS);
    this.cornerShore = new Float32Array(CORNERS);
    this.cornerDepth = new Float32Array(CORNERS);
    this.cornerLayer = new Int32Array(CORNERS).fill(-1);
    // Scratch for one quad, so emitting a face allocates nothing.
    this._v = new Float64Array(12);
    this._t = new Float64Array(8);
    this._d = new Float64Array(16); // four shader channels per corner
    this._h = new Float64Array(4); // the cell's four corner heights
    this._s = new Float64Array(4); // ...how near each of them is to land
    this._p = new Float64Array(4); // ...and how deep the water under it is
    // Bound once, because the corner and flow maths take a sampler and are
    // shared with the physics, which reads the world in absolute coordinates
    // rather than this chunk's.
    this._get = (x, y, z) => this.id(x, y, z);
  }

  begin(world, chunk, x0, z0) {
    this.world = world;
    this.chunk = chunk;
    this.x0 = x0;
    this.z0 = z0;
    this.cornerLayer.fill(-1);
    for (const b of this.buffers) b.reset();
  }

  end() {
    return {
      still: this.buffers[STILL].take(),
      flowing: this.buffers[FLOWING].take(),
    };
  }

  /**
   * The block at a chunk-local position, reaching into the neighbouring
   * chunk when the coordinate leaves this one. Same shape as the opaque
   * mesher's lookup, and the same reason: face culling and corner heights
   * both need to see across a chunk border or every border shows a seam.
   */
  id(lx, layer, lz) {
    if (layer < 0 || layer >= WORLD_HEIGHT) return AIR;
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      return this.chunk.blocks[layer * AREA + lz * CHUNK_SIZE + lx];
    }
    return this.world.get(this.x0 + lx, fromLayer(layer), this.z0 + lz);
  }

  /**
   * Look up one corner of the fluid grid and drop its height, its shore
   * fraction and its depth into slot `k` of the cell's four. The rule the
   * height follows is Minecraft's, and it is written out in full over
   * `fluidCornerInfo` below.
   */
  corner(cx, layer, cz, k) {
    const slot = cz * (CHUNK_SIZE + 1) + cx;
    if (this.cornerLayer[slot] !== layer) {
      fluidCornerInfo(this._get, cx, layer, cz, CORNER);
      this.cornerLayer[slot] = layer;
      this.cornerHeight[slot] = CORNER[0];
      this.cornerShore[slot] = CORNER[1];
      this.cornerDepth[slot] = CORNER[2];
    }
    this._h[k] = this.cornerHeight[slot];
    this._s[k] = this.cornerShore[slot];
    this._p[k] = this.cornerDepth[slot];
  }

  flow(lx, layer, lz, id, out) {
    return fluidFlow(this._get, lx, layer, lz, id, out);
  }

  /**
   * Emit the faces of one water cell. Returns the number of quads written,
   * which is zero for the overwhelming majority of them: a cell in the body
   * of the sea is surrounded by water and rock and shows nothing at all, and
   * finding that out costs six lookups before any of the corner arithmetic
   * happens.
   */
  cell(lx, layer, lz, id) {
    const above = this.id(lx, layer + 1, lz);
    const below = this.id(lx, layer - 1, lz);
    const drawTop = !isWater(above);
    const drawBottom = !isWater(below) && !isOpaque(below);

    // Which sides are exposed. Water hides behind rock and behind itself —
    // behind itself because the corner heights already made the two surfaces
    // continuous, so there is nothing for a face between them to cover.
    let sides = 0;
    for (let d = 0; d < 4; d++) {
      const side = this.id(lx + DX[d], layer, lz + DZ[d]);
      if (!isOpaque(side) && !isWater(side)) sides |= 1 << d;
    }
    if (!drawTop && !drawBottom && sides === 0) return 0;

    // The four corners, in Minecraft's order: north-west, south-west,
    // south-east, north-east, with north being -z and west -x. Each carries
    // its height, how much land it touches, and how deep the water is there.
    this.corner(lx, layer, lz, NW);
    this.corner(lx, layer, lz + 1, SW);
    this.corner(lx + 1, layer, lz + 1, SE);
    this.corner(lx + 1, layer, lz, NE);
    const h = this._h;

    // Is this water on its way down? Either it has water above it — it is a
    // column, and the top of that column is somewhere else — or it is
    // standing over nothing and about to be. Both are the face of a fall;
    // anything else showing a wall is the cut edge of water that is
    // essentially still, and the two should not be drawn the same way.
    const falling = isWater(above) || (!isWater(below) && !isOpaque(below));
    // Water *inside* a column is a special case of falling: it has no surface
    // of its own — the top of the column is somewhere else — so its walls
    // share their corners with nothing, and they are the one face that must
    // not ride the swell. A wall whose top edge bobs and whose bottom edge is
    // pinned to the floor of its cell pulses once per block, which is exactly
    // the venetian-blind banding a tall fall used to have.
    const column = isWater(above);

    let quads = 0;
    if (drawTop) quads += this._top(lx, layer, lz, id, h);
    if (drawBottom) quads += this._bottom(lx, layer, lz);
    if (sides) quads += this._sides(lx, layer, lz, h, sides, falling, column);
    return quads;
  }

  /**
   * Fill one corner's four shader channels: how deep the water is, how close
   * to land, how far it may bob, and how broken it is.
   *
   * The wave amplitude is read off the *corner* rather than the face, and
   * that is load-bearing: the top of a wall and the edge of the surface above
   * it are different quads that share a corner, so deriving the amplitude
   * from anything else would let them drift apart and open a crack the sea
   * floor shows through.
   */
  _channels(k, corner, churn) {
    const d = this._d;
    d[k * 4] = this._p[corner];
    d[k * 4 + 1] = this._s[corner];
    d[k * 4 + 2] = fluidWaveAmount(this._h[corner], this._s[corner]);
    d[k * 4 + 3] = churn;
  }

  /** The same four channels for every corner of a face that has no gradient. */
  _flatChannels(depth, shore, wave, churn) {
    const d = this._d;
    for (let k = 0; k < 4; k++) {
      d[k * 4] = depth;
      d[k * 4 + 1] = shore;
      d[k * 4 + 2] = wave;
      d[k * 4 + 3] = churn;
    }
  }

  /**
   * The surface. Four corners at four different heights, so it is a genuinely
   * sloped quad rather than a flat lid — which is the whole reason a stream
   * reads as running downhill instead of as a flight of stairs.
   */
  _top(lx, layer, lz, id, h) {
    const v = this._v;
    const t = this._t;
    const d = this._d;
    const y = layer;

    v[0] = lx; v[1] = y + h[NW]; v[2] = lz;
    v[3] = lx; v[4] = y + h[SW]; v[5] = lz + 1;
    v[6] = lx + 1; v[7] = y + h[SE]; v[8] = lz + 1;
    v[9] = lx + 1; v[10] = y + h[NE]; v[11] = lz;

    const speed = this.flow(lx, layer, lz, id, FLOW);
    // Moving water froths. The scale is generous on purpose: any flow at all
    // means this cell is being fed from somewhere, and a stream with no white
    // in it looks like a puddle that happens to be tilted.
    const churn = Math.min(1, speed * 2.5);
    this._channels(0, NW, churn);
    this._channels(1, SW, churn);
    this._channels(2, SE, churn);
    this._channels(3, NE, churn);
    if (speed === 0) {
      // Still: the texture lies flat across the block, and because it tiles
      // seamlessly the sea comes out as one unbroken sheet rather than a
      // grid of stamps.
      t[0] = 0; t[1] = 0;
      t[2] = 0; t[3] = 1;
      t[4] = 1; t[5] = 1;
      t[6] = 1; t[7] = 0;
      this.buffers[STILL].quad(v, t, d, 0, 1, 0);
      return 1;
    }

    // Flowing: sample a half-size patch of the flowing texture, rotated so
    // its streaks point the way the water is going. Quarter-block offsets
    // from the middle of the tile, spun by the flow angle.
    const angle = Math.atan2(FLOW[1], FLOW[0]) - Math.PI / 2;
    const s = Math.sin(angle) * 0.25;
    const c = Math.cos(angle) * 0.25;
    t[0] = 0.5 + (-c - s); t[1] = 0.5 + (-c + s);
    t[2] = 0.5 + (-c + s); t[3] = 0.5 + (c + s);
    t[4] = 0.5 + (c + s); t[5] = 0.5 + (c - s);
    t[6] = 0.5 + (c - s); t[7] = 0.5 + (-c - s);
    this.buffers[FLOWING].quad(v, t, d, 0, 1, 0);
    return 1;
  }

  /** The underside — only ever seen where water overhangs air. */
  _bottom(lx, layer, lz) {
    const v = this._v;
    const t = this._t;
    const d = this._d;
    const y = layer;
    v[0] = lx; v[1] = y; v[2] = lz + 1;
    v[3] = lx; v[4] = y; v[5] = lz;
    v[6] = lx + 1; v[7] = y; v[8] = lz;
    v[9] = lx + 1; v[10] = y; v[11] = lz + 1;
    t[0] = 0; t[1] = 1;
    t[2] = 0; t[3] = 0;
    t[4] = 1; t[5] = 0;
    t[6] = 1; t[7] = 1;
    // It sits on the floor of its cell, so it must not move; the water above
    // it is falling, so it is broken.
    const depth = (this._p[NW] + this._p[SW] + this._p[SE] + this._p[NE]) / 4;
    this._flatChannels(depth, 0, 0, 0.35);
    this.buffers[STILL].quad(v, t, d, 0, -1, 0);
    return 1;
  }

  /**
   * The exposed walls of the cell, each running from the two corner heights
   * along its top edge down to the cell floor. They always use the flowing
   * texture: a visible wall of water is a waterfall or the cut face of a
   * stream, and both are moving.
   *
   * `falling` is the difference between those two, and it is carried in the
   * churn channel. A curtain of falling water is broken all the way down; the
   * exposed edge of a pool is barely broken at all. They used to be given the
   * same number, which is a large part of why every fall in the game came out
   * as a sheet of white paper.
   */
  _sides(lx, layer, lz, h, mask, falling, column) {
    const v = this._v;
    const t = this._t;
    const c = this._d;
    const y = layer;
    let quads = 0;

    for (let d = 0; d < 4; d++) {
      if ((mask & (1 << d)) === 0) continue;
      const e = SIDE_EDGE[d];
      const hA = h[e.a];
      const hB = h[e.b];
      // A wall with no height is not a wall. This happens at the feather edge
      // of a spread, where both corners have already averaged down to zero.
      if (hA <= 0 && hB <= 0) continue;

      v[0] = lx + e.ax; v[1] = y + hA; v[2] = lz + e.az;
      v[3] = lx + e.bx; v[4] = y + hB; v[5] = lz + e.bz;
      v[6] = lx + e.bx; v[7] = y; v[8] = lz + e.bz;
      v[9] = lx + e.ax; v[10] = y; v[11] = lz + e.az;

      // v runs from the surface down to the middle of the tile, so a
      // shallower cell shows proportionally less of the texture and a
      // stack of them tiles into a continuous fall.
      t[0] = 0; t[1] = (1 - hA) * 0.5;
      t[2] = 1; t[3] = (1 - hB) * 0.5;
      t[4] = 1; t[5] = 0.5;
      t[6] = 0; t[7] = 0.5;

      // The top two corners of a wall are corners of the surface as well, so
      // they take their bob from the same place the surface quad does and the
      // two stay welded. The bottom two are standing on the floor of the cell
      // and never move at all.
      const churn = falling ? 1 : STILL_EDGE_CHURN;
      const lower = churn * 0.55;
      this._channels(0, e.a, churn);
      this._channels(1, e.b, churn);
      if (column) { c[2] = 0; c[6] = 0; } // mid-column: nothing here bobs
      c[8] = c[4]; c[9] = c[5]; c[10] = 0; c[11] = lower; // below e.b
      c[12] = c[0]; c[13] = c[1]; c[14] = 0; c[15] = lower; // below e.a

      this.buffers[FLOWING].quad(v, t, c, e.nx, 0, e.nz);
      quads++;
    }
    return quads;
  }
}

// -------------------------------------------------- the maths, on its own
// Both of these take a `get(x, y, z)` sampler rather than a world, because
// they are wanted in two coordinate systems: the mesher works chunk-locally
// in layers, the physics works in absolute world coordinates, and the maths
// only ever looks at offsets from the point it was handed.

/**
 * The height of the fluid surface at one corner of the grid, averaged over
 * the four cells that meet there. Minecraft's getWaterHeight:
 *
 *   * any of the four having fluid directly above it means the surface is
 *     full there — you are looking at the side of a column, not a top,
 *   * a cell that is nearly full counts ten times, so a sea beside a
 *     one-ninth puddle keeps its own height instead of splitting the
 *     difference,
 *   * air counts as height zero, which is what lets a stream taper off to
 *     nothing at its edge instead of ending in a wall,
 *   * a solid block is not counted at all, so water against a cliff stays
 *     level with itself rather than being dragged down by the rock.
 */
export function fluidCornerHeight(get, x, y, z) {
  fluidCornerInfo(get, x, y, z, CORNER_SCRATCH);
  return CORNER_SCRATCH[0];
}

/**
 * The same walk over the four cells, reporting everything it learns instead
 * of only the height. Writes three numbers into `out`:
 *
 *   [0] height — as above, Minecraft's rule exactly.
 *   [1] shore  — what fraction of the four cells is *not* water. Zero in open
 *                sea, a half along a straight coastline, and it is what the
 *                shader draws foam from: the band comes out one cell wide and
 *                fades, without anyone having to trace the coastline.
 *   [2] depth  — how much water is stacked under here, over DEPTH_SCALE, the
 *                mean over whichever of the four cells hold any. Shallow
 *                water is pale and you can see the sand; deep water is not.
 *
 * One pass rather than three because the walk is the expensive part: a chunk
 * of open sea asks for a thousand of these, and each one is already four
 * cells and a short climb down.
 */
export function fluidCornerInfo(get, x, y, z, out) {
  let total = 0;
  let weight = 0;
  let dry = 0;
  let depth = 0;
  let wet = 0;
  let column = false;
  for (let j = 0; j < 4; j++) {
    const cx = x - (j & 1);
    const cz = z - ((j >> 1) & 1);
    if (isWater(get(cx, y + 1, cz))) column = true; // a column, not a surface
    const id = get(cx, y, cz);
    if (isWater(id)) {
      const own = fluidOwnHeight(id);
      if (own >= FULL_ENOUGH) {
        total += own * FULL_WEIGHT;
        weight += FULL_WEIGHT;
      } else {
        total += own;
        weight += 1;
      }
      let down = 1;
      while (down < DEPTH_SCALE && isWater(get(cx, y - down, cz))) down++;
      depth += down;
      wet++;
    } else {
      dry++;
      if (!isOpaque(id)) weight += 1; // air: pulls the corner down to nothing
    }
  }
  out[0] = column ? 1 : (weight > 0 ? total / weight : 0);
  out[1] = dry / 4;
  out[2] = wet > 0 ? depth / wet / DEPTH_SCALE : 0;
  return out;
}

/**
 * How far a corner of the surface is allowed to ride the swell.
 *
 * Full water gets all of it. Anything thin gets less, because a cell holding
 * a ninth of a block is 0.111 deep and a wave with an amplitude of 0.054
 * would take the surface straight through the floor. Water against the shore
 * is pinned too: real water goes still where it runs out of depth, and more
 * to the point, a sheet that bobs at its own edge would show daylight under
 * itself every time it rose.
 */
export function fluidWaveAmount(height, shore) {
  const deep = Math.min(1, Math.max(0, height * 1.15));
  return deep * (1 - Math.min(1, shore) * 0.85);
}

/**
 * Which way the water is running, from the height differences around it.
 * Minecraft's FlowingFluid.getFlow, minus the falling-water special case,
 * which only rescales a vector that is about to be normalised anyway.
 *
 * Writes the unit vector into `out` and returns its length *before*
 * normalising, so a caller can tell still water — no current, draw the calm
 * texture, no push — from moving water without a second test.
 */
export function fluidFlow(get, x, y, z, id, out) {
  const own = fluidOwnHeight(id);
  let fx = 0;
  let fz = 0;
  for (let d = 0; d < 4; d++) {
    const dx = DX[d];
    const dz = DZ[d];
    const side = get(x + dx, y, z + dz);
    if (isOpaque(side)) continue; // a wall neither pushes nor pulls
    let diff = 0;
    if (isWater(side)) {
      diff = own - fluidOwnHeight(side);
    } else {
      // Open air beside us. Water below it means there is a drop here, and the
      // current should lean into it — that is what makes a stream aim at the
      // hole it is about to fall down rather than dribble sideways past it.
      const under = get(x + dx, y - 1, z + dz);
      if (isWater(under)) diff = own - (fluidOwnHeight(under) - 8 / 9);
    }
    if (diff !== 0) {
      fx += dx * diff;
      fz += dz * diff;
    }
  }
  const len = Math.hypot(fx, fz);
  out[0] = len > 0 ? fx / len : 0;
  out[1] = len > 0 ? fz / len : 0;
  return len;
}

// ---------------------------------------------------------------- tables

// Corner order, matching Minecraft's: north is -z, west is -x.
const NW = 0;
const SW = 1;
const SE = 2;
const NE = 3;

// Horizontal directions, in the order the side mask is packed.
const DX = [0, 0, -1, 1]; // north, south, west, east
const DZ = [-1, 1, 0, 0];

/**
 * Each side face, as the two corners along its top edge and where they sit.
 * The inset pulls the face a thousandth of a block into the cell: without it
 * a water wall shares a plane with whatever block it runs past, and the two
 * flicker against each other at a distance.
 */
const I = SIDE_INSET;
const SIDE_EDGE = [
  { a: NW, b: NE, ax: 0, az: I, bx: 1, bz: I, nx: 0, nz: -1 }, // north
  { a: SE, b: SW, ax: 1, az: 1 - I, bx: 0, bz: 1 - I, nx: 0, nz: 1 }, // south
  { a: SW, b: NW, ax: I, az: 1, bx: I, bz: 0, nx: -1, nz: 0 }, // west
  { a: NE, b: SE, ax: 1 - I, az: 0, bx: 1 - I, bz: 1, nx: 1, nz: 0 }, // east
];

/** Scratch for the flow vector, so sampling one allocates nothing. */
const FLOW = new Float64Array(2);

/** Scratch for one corner's [height, shore, depth]. */
const CORNER = new Float64Array(3);
/** A second one, so the height-only wrapper cannot tread on the mesher's. */
const CORNER_SCRATCH = new Float64Array(3);
