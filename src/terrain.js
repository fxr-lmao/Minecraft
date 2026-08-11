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

/** Columns at or below this height get sand regardless of biome. */
export const SAND_LEVEL = 4;

// block ids (see textures.js BLOCK_DEFS)
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 6;
export const BEDROCK = 8;
export const SNOW = 9;
export const LOG = 10;
export const LEAVES = 11;
export const AIR = 0;

export const BIOMES = ['plains', 'forest', 'desert', 'mountains'];

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

  const mountains = smoothstep(0.54, 0.72, relief);
  const low = 1 - mountains;
  const desert = low * smoothstep(0.50, 0.34, moisture);
  const forest = low * smoothstep(0.52, 0.70, moisture);
  const plains = Math.max(0, low - desert - forest);
  return { plains, forest, desert, mountains };
}

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
const SHAPE = {
  plains:    { base: 14, hills: 3.5, detail: 1.2 },
  forest:    { base: 16, hills: 5.0, detail: 2.0 },
  desert:    { base: 12, hills: 3.0, detail: 1.5 },
  mountains: { base: 30, hills: 17.0, detail: 4.0 },
};

/**
 * Surface height at (x, z): the y of the topmost solid block.
 * The same detail/hill noise is shared by every biome and only its amplitude
 * is blended, so the terrain flows continuously across biome borders.
 */
export function surfaceHeight(x, z, seed) {
  const w = biomeWeights(x, z, seed);
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
  return Math.max(2, Math.min(60, Math.round(h)));
}

/** Surface and subsurface block for a column, given its biome mix. */
export function surfaceBlocks(h, w) {
  if (h <= SAND_LEVEL) return { top: SAND, filler: SAND };
  // Snow caps and bare rock belong to ground the mountain weight lifted, so
  // they are gated on both the weight and the height it produced.
  if (w.mountains > 0.5) {
    if (h >= 38) return { top: SNOW, filler: STONE };
    if (h >= 30) return { top: STONE, filler: STONE };
  }
  if (w.desert > 0.5) return { top: SAND, filler: SAND };
  return { top: GRASS, filler: DIRT };
}

/** Which block sits at (x, y, z) in freshly generated terrain (no trees). */
export function generatedBlock(x, y, z, seed) {
  if (y === 0) return BEDROCK;
  const h = surfaceHeight(x, z, seed);
  if (y > h) return AIR;
  const w = biomeWeights(x, z, seed);
  const { top, filler } = surfaceBlocks(h, w);
  if (y === h) return top;
  if (y >= h - 3) return filler;
  return STONE;
}

/** Fill a column of `blocks` from bedrock up to the surface at height `h`. */
function fillColumn(blocks, col, area, h, top, filler) {
  for (let y = 0; y <= h; y++) {
    let id;
    if (y === 0) id = BEDROCK;
    else if (y === h) id = top;
    else if (y >= h - 3) id = filler;
    else id = STONE;
    blocks[y * area + col] = id;
  }
}

/**
 * Superflat generation: every column the same height. Used by the headless
 * tests, where hills would make "walk forward for five seconds" untestable.
 */
export function generateFlatChunk(blocks, heights, size, height, surfaceY) {
  blocks.fill(0);
  const h = Math.max(0, Math.min(surfaceY, height - 1));
  const area = size * size;
  for (let col = 0; col < area; col++) fillColumn(blocks, col, area, h, GRASS, DIRT);
  heights.fill(h);
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
  let maxY = 0;

  const put = (x, y, z, id, overwrite) => {
    if (y < 1 || y >= height) return;
    const lx = x - x0;
    const lz = z - z0;
    if (lx < 0 || lx >= size || lz < 0 || lz >= size) return;
    const i = y * area + lz * size + lx;
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
export function generateChunk(blocks, heights, chunkX, chunkZ, size, height, seed) {
  blocks.fill(0);
  let maxY = 0;
  const area = size * size;
  const x0 = chunkX * size;
  const z0 = chunkZ * size;

  for (let lz = 0; lz < size; lz++) {
    for (let lx = 0; lx < size; lx++) {
      const wx = x0 + lx;
      const wz = z0 + lz;
      const h = Math.min(surfaceHeight(wx, wz, seed), height - 1);
      const { top, filler } = surfaceBlocks(h, biomeWeights(wx, wz, seed));
      const col = lz * size + lx;
      fillColumn(blocks, col, area, h, top, filler);
      // Terrain columns are solid from bedrock to here, which lets the
      // mesher skip everything buried underneath.
      heights[col] = h;
      if (h > maxY) maxY = h;
    }
  }

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
