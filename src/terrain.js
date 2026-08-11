// Procedural terrain for the infinite world.
//
// Everything here is a pure function of (x, z) and a seed, so any chunk can
// be regenerated from scratch at any time. That is what makes streaming
// safe: a chunk can be thrown away when you walk far enough from it and
// rebuilt byte-identically when you come back. Player edits are stored
// separately and replayed on top.
//
// The noise is a 3-octave value-noise fBm — cheap enough to generate a
// 32x32 chunk in well under a millisecond, which matters because chunks are
// generated on demand during collision checks, not just for rendering.

/** Columns at or below this height get sand instead of grass — lowlands. */
export const SAND_LEVEL = 4;

// block ids (see textures.js BLOCK_DEFS)
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 6;
export const BEDROCK = 8;
export const AIR = 0;

/** 2D integer hash -> [0, 1). Deterministic across machines. */
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

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
 * Surface height at (x, z): the y of the topmost solid block.
 * Gentle rolling hills — high enough to be interesting, low enough that the
 * world still reads as the flat one people already built on.
 */
export function surfaceHeight(x, z, seed) {
  // Three layers: bumps you walk over, hills you walk around, and regions
  // that decide whether you are in highlands or a valley at all. Without the
  // fastest layer the world is a smooth plain — you need relief inside the
  // render distance for the terrain to read as terrain.
  const detail = (fbm(x * 0.06, z * 0.06, seed) - 0.5) * 2; // -1..1
  const hills = (fbm(x * 0.022, z * 0.022, seed + 331) - 0.5) * 2;
  const region = (fbm(x * 0.005, z * 0.005, seed + 7717) - 0.5) * 2;
  // fBm clusters hard around its midpoint, so both slow layers are pushed
  // outwards; without this the whole world sits at one height.
  const spread = (v, p) => Math.sign(v) * Math.abs(v) ** p;
  const h = 16 + detail * 2.5 + spread(hills, 0.65) * 9 + spread(region, 0.7) * 11;
  return Math.max(2, Math.min(48, Math.round(h)));
}

/**
 * Pick somewhere pleasant to start: grass rather than a sand hollow, and
 * flat enough that you are not spawned on a cliff edge. Searches outward
 * from the origin and always terminates (the fallback is the origin).
 */
export function findSpawn(seed, maxRadius = 160) {
  for (let r = 0; r <= maxRadius; r += 4) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const x = Math.round(Math.cos(ang) * r);
      const z = Math.round(Math.sin(ang) * r);
      const h = surfaceHeight(x, z, seed);
      if (h <= SAND_LEVEL + 1) continue;
      const flat = [[2, 0], [-2, 0], [0, 2], [0, -2]]
        .every(([dx, dz]) => Math.abs(surfaceHeight(x + dx, z + dz, seed) - h) <= 1);
      if (flat) return { x: x + 0.5, z: z + 0.5, h };
    }
  }
  return { x: 0.5, z: 0.5, h: surfaceHeight(0, 0, seed) };
}

/** Which block sits at (x, y, z) in freshly generated terrain. */
export function generatedBlock(x, y, z, seed) {
  if (y === 0) return BEDROCK;
  const h = surfaceHeight(x, z, seed);
  if (y > h) return AIR;
  if (y === h) return h <= SAND_LEVEL ? SAND : GRASS;
  if (y >= h - 3) return h <= SAND_LEVEL ? SAND : DIRT;
  return STONE;
}

/** Fill a column of `blocks` from bedrock up to the surface at height `h`. */
function fillColumn(blocks, col, area, h, sandy) {
  for (let y = 0; y <= h; y++) {
    let id;
    if (y === 0) id = BEDROCK;
    else if (y === h) id = sandy ? SAND : GRASS;
    else if (y >= h - 3) id = sandy ? SAND : DIRT;
    else id = STONE;
    blocks[y * area + col] = id;
  }
}

/**
 * Superflat generation: every column the same height. Used by the headless
 * tests, where hills would make "walk forward for five seconds" untestable.
 */
export function generateFlatChunk(blocks, size, height, surfaceY) {
  blocks.fill(0);
  const h = Math.max(0, Math.min(surfaceY, height - 1));
  const area = size * size;
  for (let col = 0; col < area; col++) fillColumn(blocks, col, area, h, false);
  return h;
}

/**
 * Fill one chunk column-by-column. Much faster than calling generatedBlock
 * per cell because the height (the expensive part) is computed once per
 * column. Returns the highest solid y, which the mesher uses to skip the
 * empty sky above.
 */
export function generateChunk(blocks, chunkX, chunkZ, size, height, seed) {
  blocks.fill(0);
  let maxY = 0;
  const area = size * size;
  for (let lz = 0; lz < size; lz++) {
    for (let lx = 0; lx < size; lx++) {
      const wx = chunkX * size + lx;
      const wz = chunkZ * size + lz;
      const h = Math.min(surfaceHeight(wx, wz, seed), height - 1);
      fillColumn(blocks, lz * size + lx, area, h, h <= SAND_LEVEL);
      if (h > maxY) maxY = h;
    }
  }
  return maxY;
}
