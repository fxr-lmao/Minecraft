// Procedural terrain for the infinite world: four biomes, blended.
//
// Everything here is a pure function of (x, z) and a seed, so any chunk can
// be regenerated from scratch at any time. That is what makes streaming
// safe: a chunk can be thrown away when you walk far enough from it and
// rebuilt byte-identically when you come back. Player edits are stored
// separately and replayed on top.
//
// Coherence is the whole game with biomes. Two things keep the seams clean:
//
//   1. Biomes are *weights*, not a choice. Every column gets a weight for
//      each biome from slow noise fields, and the terrain height is the
//      weighted average of what each biome wants. A mountain next to plains
//      therefore ramps down into it rather than ending in a cliff.
//   2. The surface block follows the same fields, so the ground cover
//      changes exactly where the shape does — sand appears as the land
//      flattens into desert, snow only on ground the mountain weight
//      actually raised.

import { WORLD_MIN_Y, WORLD_MAX_Y, toLayer } from './constants.js';

/**
 * Sea level, as in Minecraft. There is no water yet, but this is what the
 * terrain is built around: the plains sit a few blocks above it, and anything
 * at or below gets sand, so shorelines read as beaches.
 */
export const SEA_LEVEL = 62;

/** Columns at or below this height get sand regardless of biome. */
export const SAND_LEVEL = SEA_LEVEL + 1;

/**
 * Stone turns to deepslate below here. The boundary is jittered per column so
 * it reads as a ragged transition rather than a drawn line, the same way
 * Minecraft fades stone into deepslate over a few layers.
 */
export const DEEPSLATE_LEVEL = 0;
const DEEPSLATE_FADE = 8; // how many layers the jitter spreads over

/** The floor is ragged for a few layers, like Minecraft's bedrock. */
const BEDROCK_FADE = 4;

// block ids (see textures.js BLOCK_DEFS)
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 6;
export const BEDROCK = 8;
export const SNOW = 9;
export const LOG = 10;
export const LEAVES = 11;
export const DEEPSLATE = 12;
export const AIR = 0;

/**
 * Water. Minecraft stores a level 0-7 alongside the block; here the level is
 * folded into the id, because the block array is one byte per cell and a
 * parallel level array would cost another 255 KB per chunk for a field that
 * is zero almost everywhere.
 *
 *   13        a source — the sea. Permanent: it never drains.
 *   14..21    flowing, levels 0..7, thinning by one per block travelled
 *
 * Flowing level 0 is deliberately a different block from a source even though
 * they look and spread identically. It is what water becomes at the foot of a
 * fall, and it has to reach the same seven blocks a source does — but unlike
 * a source it dries up when whatever was feeding it stops.
 */
export const WATER = 13;
export const WATER_FLOW = 14;
export const WATER_LEVELS = 7;
export const WATER_LAST = WATER_FLOW + WATER_LEVELS;

/**
 * Ice: water's other state, and the only block here that the world is not
 * *told* about. It is written transiently, like flowing water, because it is
 * the same kind of fact — a consequence of where you are rather than a
 * decision anyone made — so a frozen lake costs nothing in the save file and
 * freezes again by itself when the chunk comes back.
 *
 * The id sits past the flowing levels because those own 14..21, and it is an
 * ordinary opaque block from every other point of view: you walk on it, it
 * hides what is under it, and water treats it as ground.
 */
export const ICE = 22;
export const isIce = (id) => id === ICE;

export const isWater = (id) => id >= WATER && id <= WATER_LAST;
/** 0 at full strength, up to 7 at the far edge of a spread. */
export const waterLevel = (id) => (id === WATER ? 0 : id - WATER_FLOW);
/** The flowing block for a level. Sources only ever come from generation. */
export const waterId = (level) => WATER_FLOW + level;
/** Everything you cannot walk through and cannot see through. */
export const isOpaque = (id) => id !== AIR && !isWater(id);
/** A permanent block of water — the sea, and pools that Minecraft refills. */
export const isWaterSource = (id) => id === WATER;

/**
 * Minecraft counts water the other way up, as an *amount* from 8 (a full
 * source) down to 1 (the last block of a spread), with 0 meaning dry. Both
 * spellings are useful — levels index the block ids, amounts are what the
 * flow arithmetic is written in — so here is the conversion, in both
 * directions.
 */
export const WATER_MAX_AMOUNT = 8;
export const waterAmount = (id) => (isWater(id) ? WATER_MAX_AMOUNT - waterLevel(id) : 0);
export const waterIdForAmount = (amount) =>
  (amount <= 0 ? AIR : waterId(WATER_MAX_AMOUNT - Math.min(amount, WATER_MAX_AMOUNT)));

/**
 * How tall a water block stands, as Minecraft draws it: amount/9, so a source
 * is 8/9 of a block and every level of flow takes another ninth off. Water
 * with water on top of it fills its cell completely, so a column has no
 * seams in it.
 *
 * This is only the *cell's own* height. What actually gets drawn is an
 * average of the four cells meeting at each corner — see water-mesh.js —
 * which is what turns a staircase of levels into a sloping surface.
 */
export function waterHeight(id, aboveIsWater) {
  if (aboveIsWater) return 1;
  return waterAmount(id) / 9;
}

export const BIOMES = ['ocean', 'plains', 'forest', 'desert', 'mountains'];

/** 2D integer hash -> [0, 1). Deterministic across machines. */
export function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Smooth 0..1 ramp between two edges (either order). */
export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  return smooth(clamp01((x - edge0) / (edge1 - edge0)));
}

/** Value noise sampled at a continuous (x, z). */
function valueNoise(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  const u = smooth(xf);
  const v = smooth(zf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** 3D integer hash -> [0, 1). */
export function hash3(ix, iy, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 1442695041)
    + Math.imul(iz, 668265263) + Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in 3D, sampled at a continuous point. */
function valueNoise3(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const w = smooth(z - zi);
  let acc = 0;
  for (let dz = 0; dz <= 1; dz++) {
    const wz = dz ? w : 1 - w;
    for (let dy = 0; dy <= 1; dy++) {
      const wy = dy ? v : 1 - v;
      for (let dx = 0; dx <= 1; dx++) {
        const wx = dx ? u : 1 - u;
        acc += hash3(xi + dx, yi + dy, zi + dz, seed) * wx * wy * wz;
      }
    }
  }
  return acc;
}

/** Fractal noise: 3 octaves, each half the amplitude and double the frequency. */
export function fbm(x, z, seed) {
  let total = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    total += valueNoise(x * freq, z * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / norm;
}

/**
 * How much each biome claims this column. Always sums to 1, and every weight
 * varies smoothly, which is what stops biome borders from being cliffs.
 *
 * Two slow fields decide it: `relief` raises mountains, and `moisture`
 * separates the lowlands into desert (dry), plains (middling) and forest
 * (wet).
 */
export function biomeWeights(x, z, seed) {
  const relief = fbm(x * 0.0016, z * 0.0016, seed + 991);
  const moisture = fbm(x * 0.0021, z * 0.0021, seed + 5501);

  // The same relief field that raises mountains at the top end drops the sea
  // floor at the bottom, so a coastline is just where it crosses sea level —
  // the land ramps down into the water instead of ending at a wall.
  const mountains = smoothstep(0.54, 0.72, relief);
  const ocean = smoothstep(0.42, 0.30, relief);
  const land = Math.max(0, 1 - mountains - ocean);
  const desert = land * smoothstep(0.50, 0.34, moisture);
  const forest = land * smoothstep(0.52, 0.70, moisture);
  const plains = Math.max(0, land - desert - forest);
  return { ocean, plains, forest, desert, mountains };
}

// ------------------------------------------------------------- climate
//
// Minecraft keeps a temperature per biome and freezes water below 0.15, on a
// scale where a desert is 2.0 and a snowy plain is 0.0. The same number
// decides whether rain falls as snow, which is why the mountain tops here are
// white: they are the part of the world that is already below freezing.
//
// Two things set it. The biome mix gives the ground temperature, blended by
// weight so a coast warms up gradually rather than at a line; and height
// takes it away again, because air cools as you climb. Minecraft's own lapse
// rate is a rounding error — 0.05 per 40 blocks, so a mountain would be
// 0.15 colder at its peak than at its foot — and it leans on cold *biomes*
// instead. There are none here, so the rate does the work: it is the reason
// the snow line and the ice line are the same line.

/** Below this, exposed water turns to ice. Minecraft's number. */
export const FREEZING_POINT = 0.15;

/** Ground temperature per biome, on Minecraft's scale. */
export const BIOME_TEMPERATURE = {
  ocean: 0.5,
  plains: 0.8,
  forest: 0.7,
  desert: 2.0,
  // Cold at any height, like Minecraft's snowy slopes, and colder still up
  // top once the lapse rate is applied. It is the only biome here that
  // freezes at all.
  mountains: 0.0,
};

/** Where the air starts to cool, and by how much per block above it. */
export const LAPSE_BASE_Y = 80;
export const LAPSE_RATE = 0.005;

/**
 * Temperature for a column whose biome weights the caller already has —
 * chunk generation has them, and so does anything asking about a lot of
 * columns at once.
 */
export function temperatureWith(w, y) {
  let t = 0;
  for (const name of BIOMES) t += BIOME_TEMPERATURE[name] * w[name];
  return t - Math.max(0, y - LAPSE_BASE_Y) * LAPSE_RATE;
}

/**
 * How cold it is at a point. Mountain ground sits at freezing, so water
 * freezes wherever the mountains clearly win the column, and higher up the
 * lapse rate lets a thinner mountain weight do it: at the snow line, 120,
 * everything mountainous is 0.2 below freezing.
 *
 * Nothing else comes close. Plains would have to reach y = 210 and the world
 * stops at 190, which is the intended answer — the sea does not freeze off a
 * beach in summer.
 */
export function temperatureAt(x, y, z, seed) {
  return temperatureWith(biomeWeights(x, z, seed), y);
}

/** The whole question in one word, for the callers that only want the yes. */
export const isFreezing = (t) => t < FREEZING_POINT;

/** The biome with the largest weight, for the debug screen. */
export function dominantBiome(weights) {
  let best = 'plains';
  let bestW = -1;
  for (const name of BIOMES) {
    if (weights[name] > bestW) {
      bestW = weights[name];
      best = name;
    }
  }
  return best;
}

// Per-biome terrain shape: a base height and how much the shared detail and
// hill noise move it. Mountains are tall and rough, desert is low and smooth.
// Heights are Minecraft's: sea level 62, plains in the mid 60s, mountains
// topping out around 150.
const SHAPE = {
  ocean:     { base: 46, hills: 7.0, detail: 2.5 },
  plains:    { base: 66, hills: 4.0, detail: 1.5 },
  forest:    { base: 68, hills: 6.0, detail: 2.5 },
  desert:    { base: 64, hills: 4.0, detail: 2.0 },
  mountains: { base: 108, hills: 46.0, detail: 6.0 },
};

/** Terrain is clamped to this band — well inside the world either way. */
const TERRAIN_MIN = 40;
const TERRAIN_MAX = 170;

/**
 * Surface height at (x, z): the y of the topmost solid block.
 * The same detail/hill noise is shared by every biome and only its amplitude
 * is blended, so the terrain flows continuously across biome borders.
 */
export function surfaceHeight(x, z, seed) {
  return surfaceHeightWith(x, z, seed, biomeWeights(x, z, seed));
}

/**
 * The same thing when the caller already has the weights. Chunk generation
 * needs both for every column, and computing them twice was a third of its
 * cost — the weights are four octaves of noise.
 */
export function surfaceHeightWith(x, z, seed, w) {
  const detail = (fbm(x * 0.06, z * 0.06, seed) - 0.5) * 2; // -1..1
  const hills = (fbm(x * 0.022, z * 0.022, seed + 331) - 0.5) * 2;
  // fBm clusters around its midpoint; push the hill term outwards so the
  // land actually rolls instead of hovering at one height.
  const shaped = Math.sign(hills) * Math.abs(hills) ** 0.65;

  let base = 0;
  let hillAmp = 0;
  let detailAmp = 0;
  for (const name of BIOMES) {
    const weight = w[name];
    if (weight === 0) continue;
    base += SHAPE[name].base * weight;
    hillAmp += SHAPE[name].hills * weight;
    detailAmp += SHAPE[name].detail * weight;
  }
  const h = base + shaped * hillAmp + detail * detailAmp;
  return Math.max(TERRAIN_MIN, Math.min(TERRAIN_MAX, Math.round(h)));
}

/** Surface and subsurface block for a column, given its biome mix. */
export function surfaceBlocks(h, w) {
  if (h <= SAND_LEVEL) return { top: SAND, filler: SAND };
  // Snow caps and bare rock belong to ground the mountain weight lifted, so
  // they are gated on both the weight and the height it produced.
  if (w.mountains > 0.5) {
    if (h >= 120) return { top: SNOW, filler: STONE };
    if (h >= 95) return { top: STONE, filler: STONE };
  }
  if (w.desert > 0.5) return { top: SAND, filler: SAND };
  return { top: GRASS, filler: DIRT };
}

// ------------------------------------------------------------------ caves
//
// Evaluating 3D noise per block is far too slow — a chunk is 144k cells — so
// the noise is sampled on a lattice every CAVE_STEP blocks and interpolated
// between, which is the same trick Minecraft uses for its own cave noise.
// Lattice points sit on world coordinates, so tunnels line up exactly across
// chunk borders no matter which chunk is generated first.
//
// Two independent fields are carved where *both* sit near their midpoint.
// The intersection of two iso-surfaces is a line rather than a volume, and
// that is what turns blobby noise into winding tunnels.

export const CAVE_STEP = 4; // horizontal lattice spacing, in blocks
/**
 * Vertical lattice spacing. Minecraft samples its cave noise on a 4 x 8 x 4
 * lattice for the same reason: the y axis is where the loop spends its time,
 * and tunnels are wider than they are tall anyway, so it is the cheapest axis
 * to sample coarsely. Halving the samples here halves the cost of carving.
 */
export const CAVE_STEP_Y = 8;
export const CAVE_CEILING_DEPTH = 3; // rock kept between a cave and the sky
const CAVE_FREQ = 0.031; // tunnel scale
const CAVE_THRESHOLD = 0.08; // how close to the midpoint gets carved
const CAVE_CEILING = CAVE_CEILING_DEPTH;
/**
 * Caves stop here however high the ground goes. Mountains now reach 150, and
 * carving all of that would cost a third again per chunk for tunnels sealed
 * inside a peak. Minecraft's caves cluster below sea level too.
 */
const CAVE_MAX_Y = 70;
// Flattens tunnels into wider, lower passages. Kept near 1 so that at a
// vertical lattice step of 8 the noise is still sampled several times per
// feature — squashing it further would alias into visible banding.
const CAVE_SQUASH = 1.05;

/** One cave field at a lattice point. */
function caveField(gx, gy, gz, seed, which) {
  const f = CAVE_FREQ * CAVE_STEP;
  const fy = CAVE_FREQ * CAVE_STEP_Y * CAVE_SQUASH;
  return valueNoise3(gx * f, gy * fy, gz * f, seed + (which ? 7717 : 2281));
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Is (x, y, z) inside a cave? The slow path — used one cell at a time. */
export function caveAt(x, y, z, seed) {
  const gx = Math.floor(x / CAVE_STEP);
  const gy = Math.floor(y / CAVE_STEP_Y);
  const gz = Math.floor(z / CAVE_STEP);
  const tx = x / CAVE_STEP - gx;
  const ty = y / CAVE_STEP_Y - gy;
  const tz = z / CAVE_STEP - gz;
  for (let which = 0; which < 2; which++) {
    const c = (dx, dy, dz) => caveField(gx + dx, gy + dy, gz + dz, seed, which);
    const v = lerp(
      lerp(lerp(c(0, 0, 0), c(1, 0, 0), tx), lerp(c(0, 0, 1), c(1, 0, 1), tx), tz),
      lerp(lerp(c(0, 1, 0), c(1, 1, 0), tx), lerp(c(0, 1, 1), c(1, 1, 1), tx), tz),
      ty
    );
    if (Math.abs(v - 0.5) >= CAVE_THRESHOLD) return false;
  }
  return true;
}

// ------------------------------------------------------------- stone types

/** The y below which this column's stone is deepslate. */
export function deepslateTop(x, z, seed) {
  return DEEPSLATE_LEVEL - Math.floor(hash2(x, z, seed + 6421) * DEEPSLATE_FADE);
}

/** Bedrock is solid at the very bottom and ragged for a few layers above. */
function isBedrock(x, y, z, seed) {
  if (y <= WORLD_MIN_Y) return true;
  const above = y - WORLD_MIN_Y;
  if (above >= BEDROCK_FADE) return false;
  return hash3(x, y, z, seed + 8863) < 1 - above / BEDROCK_FADE;
}

/** Stone, or deepslate if this is deep enough. */
function rockAt(x, y, z, seed) {
  return y <= deepslateTop(x, z, seed) ? DEEPSLATE : STONE;
}

/** Which block sits at (x, y, z) in freshly generated terrain (no trees). */
export function generatedBlock(x, y, z, seed) {
  if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return y < WORLD_MIN_Y ? BEDROCK : AIR;
  if (isBedrock(x, y, z, seed)) return BEDROCK;
  const h = surfaceHeight(x, z, seed);
  if (y > h) return y <= SEA_LEVEL ? WATER : AIR;
  if (y <= Math.min(h - CAVE_CEILING, CAVE_MAX_Y) && caveAt(x, y, z, seed)) return AIR;
  const w = biomeWeights(x, z, seed);
  const { top, filler } = surfaceBlocks(h, w);
  if (y === h) return top;
  if (y >= h - 3) return filler;
  return rockAt(x, y, z, seed);
}

/**
 * Fill a column from the bedrock floor up to the surface at height `h`.
 * Indices are layers (y - WORLD_MIN_Y) so they stay non-negative.
 */
function fillColumn(blocks, col, area, wx, wz, h, top, filler, seed) {
  const dsTop = deepslateTop(wx, wz, seed);
  const hi = toLayer(h);
  // Everything from the ground up to sea level is ocean. Generated water is
  // always a source, which is what makes the sea permanent: flow can drain a
  // channel you dig, but never the sea feeding it.
  for (let y = h + 1; y <= SEA_LEVEL; y++) {
    blocks[toLayer(y) * area + col] = WATER;
  }
  for (let layer = 0; layer <= hi; layer++) {
    const y = layer + WORLD_MIN_Y;
    let id;
    if (isBedrock(wx, y, wz, seed)) id = BEDROCK;
    else if (y === h) id = top;
    else if (y >= h - 3) id = filler;
    else id = y <= dsTop ? DEEPSLATE : STONE;
    blocks[layer * area + col] = id;
  }
}

/**
 * Superflat generation: every column the same height. Used by the headless
 * tests, where hills would make "walk forward for five seconds" untestable.
 * No caves — the point of it is ground you can predict.
 */
export function generateFlatChunk(blocks, heights, surface, size, height, surfaceY) {
  blocks.fill(0);
  const h = Math.max(WORLD_MIN_Y, Math.min(surfaceY, WORLD_MAX_Y));
  const area = size * size;
  const hi = toLayer(h);
  for (let col = 0; col < area; col++) {
    for (let layer = 0; layer <= hi; layer++) {
      const y = layer + WORLD_MIN_Y;
      let id;
      if (y <= WORLD_MIN_Y) id = BEDROCK;
      else if (y === h) id = GRASS;
      else if (y >= h - 3) id = DIRT;
      else id = y <= DEEPSLATE_LEVEL ? DEEPSLATE : STONE;
      blocks[layer * area + col] = id;
    }
  }
  // Solid all the way down, so the first air is the layer above the surface.
  heights.fill(hi + 1);
  surface.fill(hi);
  return h;
}

// ------------------------------------------------------------------ trees

export const TREE_RADIUS = 2; // canopy half-width, in blocks
const TREE_SPACING = 3; // one candidate trunk every N blocks in each axis

/**
 * Is there a tree trunk rooted at this column, and how tall?
 * Candidates sit on a coarse lattice with a hashed jitter so the result is a
 * pure function of position — a chunk regenerated later grows exactly the
 * same forest, and trees straddling a chunk border agree from both sides.
 */
export function treeAt(x, z, seed) {
  if (((x % TREE_SPACING) + TREE_SPACING) % TREE_SPACING !== 0) return 0;
  if (((z % TREE_SPACING) + TREE_SPACING) % TREE_SPACING !== 0) return 0;
  const w = biomeWeights(x, z, seed);
  if (w.forest < 0.55) return 0;
  const roll = hash2(x, z, seed + 9173);
  // denser in the heart of the forest, thinning out at its edges
  if (roll > 0.16 + (w.forest - 0.55) * 0.5) return 0;
  const h = surfaceHeight(x, z, seed);
  if (h <= SAND_LEVEL) return 0;
  const { top } = surfaceBlocks(h, w);
  if (top !== GRASS) return 0;
  // reject steep ground so trees do not hang off cliffs
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (Math.abs(surfaceHeight(x + dx, z + dz, seed) - h) > 1) return 0;
  }
  return 4 + Math.floor(hash2(x, z, seed + 4231) * 3); // 4..6 blocks of trunk
}

/**
 * Write the tree rooted at (tx, tz) into a chunk's block array, clipped to
 * that chunk. Called for every candidate trunk within TREE_RADIUS of the
 * chunk, including ones rooted in neighbours, so canopies cross borders
 * seamlessly.
 */
export function carveTree(blocks, tx, tz, trunk, x0, z0, size, height, seed) {
  const area = size * size;
  const groundY = surfaceHeight(tx, tz, seed);
  const topY = groundY + trunk;
  let maxY = WORLD_MIN_Y;

  const put = (x, y, z, id, overwrite) => {
    const layer = toLayer(y);
    if (layer < 1 || layer >= height) return;
    const lx = x - x0;
    const lz = z - z0;
    if (lx < 0 || lx >= size || lz < 0 || lz >= size) return;
    const i = layer * area + lz * size + lx;
    if (!overwrite && blocks[i] !== AIR) return;
    blocks[i] = id;
    if (y > maxY) maxY = y;
  };

  // canopy: a 5x5 slab with the corners knocked off, then a 3x3 cap
  for (let dy = -1; dy <= 0; dy++) {
    for (let dz = -TREE_RADIUS; dz <= TREE_RADIUS; dz++) {
      for (let dx = -TREE_RADIUS; dx <= TREE_RADIUS; dx++) {
        if (Math.abs(dx) === TREE_RADIUS && Math.abs(dz) === TREE_RADIUS) continue;
        put(tx + dx, topY + dy, tz + dz, LEAVES, false);
      }
    }
  }
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
      put(tx + dx, topY + 1, tz + dz, LEAVES, false);
    }
  }
  // trunk last so it wins where it overlaps the canopy
  for (let y = groundY + 1; y <= topY; y++) put(tx, y, tz, LOG, true);
  return maxY;
}

/**
 * Fill one chunk column-by-column, then grow its trees. Much faster than
 * calling generatedBlock per cell because the height and biome (the
 * expensive parts) are computed once per column. Fills `heights` with each
 * column's terrain surface and returns the highest solid y; the mesher uses
 * both to skip the buried rock below and the empty sky above.
 */
export function generateChunk(blocks, heights, surface, chunkX, chunkZ, size, height, seed) {
  blocks.fill(0);
  let maxY = WORLD_MIN_Y;
  const area = size * size;
  const x0 = chunkX * size;
  const z0 = chunkZ * size;
  const ground = new Int16Array(area); // world y, before trees or caves

  for (let lz = 0; lz < size; lz++) {
    for (let lx = 0; lx < size; lx++) {
      const wx = x0 + lx;
      const wz = z0 + lz;
      const weights = biomeWeights(wx, wz, seed);
      const h = Math.min(surfaceHeightWith(wx, wz, seed, weights), WORLD_MAX_Y);
      const { top, filler } = surfaceBlocks(h, weights);
      const col = lz * size + lx;
      fillColumn(blocks, col, area, wx, wz, h, top, filler, seed);
      ground[col] = h;
      surface[col] = toLayer(h);
      // Nothing is hollow yet, so the first air sits just above the surface.
      heights[col] = toLayer(h) + 1;
      // The sea stands above the ground it covers, so in a coastal chunk it
      // is the sea, not the sea floor, that decides how high to scan.
      const colTop = h < SEA_LEVEL ? SEA_LEVEL : h;
      if (colTop > maxY) maxY = colTop;
    }
  }

  carveCaves(blocks, heights, ground, x0, z0, size, area, seed);

  // Trees rooted just outside the chunk still drop leaves inside it, so the
  // scan is widened by the canopy radius.
  for (let wz = z0 - TREE_RADIUS; wz < z0 + size + TREE_RADIUS; wz++) {
    for (let wx = x0 - TREE_RADIUS; wx < x0 + size + TREE_RADIUS; wx++) {
      const trunk = treeAt(wx, wz, seed);
      if (!trunk) continue;
      const treeTop = carveTree(blocks, wx, wz, trunk, x0, z0, size, height, seed);
      if (treeTop > maxY) maxY = treeTop;
    }
  }
  return maxY;
}

/**
 * Hollow out the tunnels, and record how deep each column is now hollow.
 *
 * `heights[col]` is the layer below which the column is guaranteed solid —
 * the mesher trusts it to skip buried rock without checking. Caves are
 * exactly what invalidates that, so the lowest carved layer is written back.
 */
function carveCaves(blocks, heights, ground, x0, z0, size, area, seed) {
  // Lattice covering the chunk plus one point past each edge, from the
  // bedrock fade up to the highest column that can be carved at all.
  let maxCarveY = WORLD_MIN_Y;
  for (let col = 0; col < area; col++) {
    const top = Math.min(ground[col] - CAVE_CEILING, CAVE_MAX_Y);
    if (top > maxCarveY) maxCarveY = top;
  }
  const minCarveY = WORLD_MIN_Y + BEDROCK_FADE;
  if (maxCarveY < minCarveY) return;

  const g0x = Math.floor(x0 / CAVE_STEP);
  const g0z = Math.floor(z0 / CAVE_STEP);
  const g0y = Math.floor(minCarveY / CAVE_STEP_Y);
  const nx = Math.floor(size / CAVE_STEP) + 2;
  const nz = nx;
  // +3, not +2: g0y floors the *bottom* of the range, so the top cell can sit
  // one lattice cell higher than the span alone suggests, and it still needs
  // its upper corner.
  const ny = Math.floor((maxCarveY - minCarveY) / CAVE_STEP_Y) + 3;

  const fieldA = new Float32Array(nx * ny * nz);
  const fieldB = new Float32Array(nx * ny * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = (iz * ny + iy) * nx + ix;
        fieldA[i] = caveField(g0x + ix, g0y + iy, g0z + iz, seed, 0);
        fieldB[i] = caveField(g0x + ix, g0y + iy, g0z + iz, seed, 1);
      }
    }
  }

  // Interpolating all three axes per block was the whole cost of generation.
  // Within one column the x/z weights never change, so each lattice level
  // collapses to a single number and a block is one lerp between two of them.
  //
  // Those two numbers also bound every block in the cell: the interpolation
  // cannot leave the range they span. When both sit outside the carving band
  // on the same side, the four blocks between them are skipped untouched —
  // and that rejects most of the underground before it costs anything.
  const LO = 0.5 - CAVE_THRESHOLD;
  const HI = 0.5 + CAVE_THRESHOLD;
  const layerStride = nx * ny;

  const bilinear = (field, ix, iy, iz, tx, tz) => {
    const i = (iz * ny + iy) * nx + ix;
    const j = i + layerStride; // the same point one lattice step in z
    return lerp(
      lerp(field[i], field[i + 1], tx),
      lerp(field[j], field[j + 1], tx),
      tz
    );
  };
  const spans = (a, b) => !((a > HI && b > HI) || (a < LO && b < LO));

  for (let lz = 0; lz < size; lz++) {
    const wz = z0 + lz;
    const gz = Math.floor(wz / CAVE_STEP);
    const iz = gz - g0z;
    const tz = wz / CAVE_STEP - gz;
    for (let lx = 0; lx < size; lx++) {
      const wx = x0 + lx;
      const gx = Math.floor(wx / CAVE_STEP);
      const ix = gx - g0x;
      const tx = wx / CAVE_STEP - gx;
      const col = lz * size + lx;
      const ceiling = Math.min(ground[col] - CAVE_CEILING, CAVE_MAX_Y);

      let y = minCarveY;
      while (y <= ceiling) {
        const gy = Math.floor(y / CAVE_STEP_Y);
        const iy = gy - g0y;
        // Last y still inside this lattice cell.
        const yStop = Math.min(ceiling, (gy + 1) * CAVE_STEP_Y - 1);
        if (iy < 0 || iy + 1 >= ny) {
          y = yStop + 1;
          continue;
        }
        const a0 = bilinear(fieldA, ix, iy, iz, tx, tz);
        const a1 = bilinear(fieldA, ix, iy + 1, iz, tx, tz);
        if (!spans(a0, a1)) {
          y = yStop + 1;
          continue;
        }
        const b0 = bilinear(fieldB, ix, iy, iz, tx, tz);
        const b1 = bilinear(fieldB, ix, iy + 1, iz, tx, tz);
        if (!spans(b0, b1)) {
          y = yStop + 1;
          continue;
        }
        for (; y <= yStop; y++) {
          const ty = y / CAVE_STEP_Y - gy;
          const a = a0 + (a1 - a0) * ty;
          if (a < LO || a > HI) continue;
          const b = b0 + (b1 - b0) * ty;
          if (b < LO || b > HI) continue;

          const layer = toLayer(y);
          blocks[layer * area + col] = AIR;
          if (layer < heights[col]) heights[col] = layer;
        }
      }
    }
  }
}

/**
 * Pick somewhere pleasant to start: grass rather than sand or bare rock, and
 * flat enough that you are not spawned on a cliff edge. Searches outward
 * from the origin and always terminates (the fallback is the origin).
 */
export function findSpawn(seed, maxRadius = 400) {
  for (let r = 0; r <= maxRadius; r += 6) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const x = Math.round(Math.cos(ang) * r);
      const z = Math.round(Math.sin(ang) * r);
      const h = surfaceHeight(x, z, seed);
      if (h <= SAND_LEVEL + 1) continue;
      const w = biomeWeights(x, z, seed);
      if (surfaceBlocks(h, w).top !== GRASS) continue;
      if (treeAt(x, z, seed)) continue; // not inside a trunk
      const flat = [[2, 0], [-2, 0], [0, 2], [0, -2]]
        .every(([dx, dz]) => Math.abs(surfaceHeight(x + dx, z + dz, seed) - h) <= 1);
      if (flat) return { x: x + 0.5, z: z + 0.5, h };
    }
  }
  return { x: 0.5, z: 0.5, h: surfaceHeight(0, 0, seed) };
}
