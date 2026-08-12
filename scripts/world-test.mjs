// The infinite chunked world: generation, negative coordinates, edits that
// survive a chunk being evicted and regenerated, and dirty-chunk tracking.
import {
  World, AIR, GRASS, STONE, DEEPSLATE, BEDROCK, toChunk, toLocal, chunkKey,
} from '../src/world.js';
import {
  surfaceHeight, generatedBlock, biomeWeights, dominantBiome, surfaceBlocks,
  treeAt, findSpawn, BIOMES, SAND_LEVEL, SEA_LEVEL, LOG, LEAVES, SNOW, SAND as SANDID,
  deepslateTop, DEEPSLATE_LEVEL,
} from '../src/terrain.js';
import {
  CHUNK_SIZE, WORLD_HEIGHT, WORLD_MIN_Y, WORLD_MAX_Y, WORLD_SEED,
} from '../src/constants.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

// ------------------------------------------------------------ coordinates
{
  assert('chunk of 0 is 0', toChunk(0) === 0);
  assert('chunk of 31 is 0', toChunk(31) === 0, toChunk(31));
  assert('chunk of 32 is 1', toChunk(32) === 1, toChunk(32));
  assert('chunk of -1 is -1', toChunk(-1) === -1, toChunk(-1));
  assert('chunk of -32 is -1', toChunk(-32) === -1, toChunk(-32));
  assert('chunk of -33 is -2', toChunk(-33) === -2, toChunk(-33));
  assert('local of -1 is 31', toLocal(-1) === CHUNK_SIZE - 1, toLocal(-1));
  assert('local of -32 is 0', toLocal(-32) === 0, toLocal(-32));
  assert('local of 33 is 1', toLocal(33) === 1, toLocal(33));
}

// ------------------------------------------------------------- generation
{
  const w = new World(WORLD_SEED);
  assert('bedrock at the floor', w.get(5, WORLD_MIN_Y, 5) === BEDROCK, w.get(5, WORLD_MIN_Y, 5));
  assert('air at the build limit', w.get(5, WORLD_MAX_Y, 5) === AIR);
  assert('above the world is air', w.get(5, WORLD_MAX_Y + 10, 5) === AIR);
  assert('below the world is sealed', w.get(5, WORLD_MIN_Y - 1, 5) === BEDROCK);
  assert('the world spans 255 layers', WORLD_HEIGHT === 255, WORLD_HEIGHT);
  // The mesher packs vertex positions into bytes, and the top layer needs a
  // vertex one above it. Exceed this and geometry silently wraps.
  assert('layers still fit in a byte vertex', WORLD_HEIGHT <= 255, WORLD_HEIGHT);

  const h = w.heightAt(12, 34);
  assert('heightAt agrees with the terrain function',
    h === surfaceHeight(12, 34, WORLD_SEED), `${h} vs ${surfaceHeight(12, 34, WORLD_SEED)}`);
  assert('surface block is solid and the one above is air',
    w.isSolid(12, h, 34) && !w.isSolid(12, h + 1, 34));
  assert('column matches generatedBlock',
    w.get(12, h - 2, 34) === generatedBlock(12, h - 2, 34, WORLD_SEED), w.get(12, h - 2, 34));

  // terrain has relief but stays in a sane band
  const heights = [];
  for (let i = 0; i < 400; i++) heights.push(w.heightAt(i * 7, i * 13));
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  assert('terrain has hills', max - min >= 4, `${min}..${max}`);
  // Minecraft's elevations: plains a little above sea level, mountains high
  // enough to carry a snow cap.
  assert('terrain stays in a sane band', min >= 40 && max <= 170, `${min}..${max}`);
  // With oceans in the mix the lowest ground is a sea floor, not a plain, so
  // what matters is that both exist: ground well under the water, and a
  // typical column a little above it.
  const sorted = [...heights].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  assert('there is ground well below sea level', min <= SEA_LEVEL - 8, `${min} vs sea ${SEA_LEVEL}`);
  assert('the typical column sits above sea level',
    median > SEA_LEVEL && median < SEA_LEVEL + 20, `${median} vs sea ${SEA_LEVEL}`);
}

// -------------------------------------------------------------- infinity
{
  const w = new World(WORLD_SEED);
  const far = 1_000_000;
  assert('far away chunks generate', w.isSolid(far, w.heightAt(far, far), far));
  assert('negative coordinates generate', w.isSolid(-far, w.heightAt(-far, -far), -far));
  assert('deterministic: same column twice',
    w.heightAt(-4321, 8765) === surfaceHeight(-4321, 8765, WORLD_SEED));
  const other = new World(WORLD_SEED + 1);
  const differs = [0, 100, 200, 300].some((i) => other.heightAt(i, i) !== w.heightAt(i, i));
  assert('a different seed makes a different world', differs);
}

// ----------------------------------------------------------------- edits
{
  const w = new World(1, { flat: 3 });
  assert('flat worlds are flat', w.heightAt(0, 0) === 3 && w.heightAt(-500, 900) === 3);

  assert('placing returns true', w.setBlock(5, 10, 5, GRASS) === true);
  assert('placing the same block again is a no-op', w.setBlock(5, 10, 5, GRASS) === false);
  assert('block is there', w.get(5, 10, 5) === GRASS, w.get(5, 10, 5));
  assert('edit recorded', w.edits.size === 1, w.edits.size);
  assert('breaking works', w.setBlock(5, 3, 5, AIR) && w.get(5, 3, 5) === AIR);
  assert('edits above the build limit are refused', w.setBlock(5, WORLD_MAX_Y + 1, 5, GRASS) === false);
  assert('edits below the floor are refused', w.setBlock(5, WORLD_MIN_Y - 1, 5, GRASS) === false);
  assert('the build limit itself is buildable', w.setBlock(5, WORLD_MAX_Y, 5, GRASS) === true);
}

// edits survive eviction: the chunk is thrown away and regenerated
{
  const w = new World(1, { flat: 3 });
  w.setBlock(40, 12, 40, STONE);       // chunk (1,1)
  w.setBlock(-40, 9, -40, GRASS);      // chunk (-2,-2)
  assert('two chunks loaded at least', w.chunks.size >= 2, w.chunks.size);

  const dropped = w.evictOutside(0, 0, 0); // keep only chunk (0,0)
  assert('eviction drops distant chunks', dropped >= 2, dropped);
  assert('evicted chunks are gone', !w.hasChunk(1, 1) && !w.hasChunk(-2, -2));

  // touching them again regenerates and replays the edits
  assert('edit survives a regenerate (positive)', w.get(40, 12, 40) === STONE, w.get(40, 12, 40));
  assert('edit survives a regenerate (negative)', w.get(-40, 9, -40) === GRASS, w.get(-40, 9, -40));
  assert('terrain around the edit is intact', w.get(41, 3, 41) === GRASS, w.get(41, 3, 41));
}

// dirty tracking drives the re-meshing
{
  const w = new World(1, { flat: 3 });
  w.chunk(0, 0);
  w.consumeDirtyChunks();
  w.setBlock(10, 6, 10, GRASS); // interior of chunk (0,0)
  let dirty = w.consumeDirtyChunks();
  assert('an interior edit dirties one chunk', dirty.length === 1, JSON.stringify(dirty));
  assert('...and it is the right one', dirty[0][0] === 0 && dirty[0][1] === 0);

  w.chunk(-1, 0);
  w.consumeDirtyChunks();
  w.setBlock(0, 6, 10, GRASS); // on the seam between chunk -1 and 0
  dirty = w.consumeDirtyChunks();
  assert('a seam edit dirties both sides', dirty.length === 2, JSON.stringify(dirty));

  // chunks that are not loaded are never queued for meshing
  w.setBlock(5000, 6, 5000, GRASS);
  const far = w.consumeDirtyChunks();
  assert('edits load the chunk they touch', far.length === 1, JSON.stringify(far));
}

// the save/replay round trip
{
  const w = new World(1, { flat: 3 });
  w.setBlock(3, 8, 3, STONE);
  w.setBlock(-70, 5, 12, GRASS);
  const list = [...w.editList()];
  assert('editList exposes absolute coordinates', list.length === 2, JSON.stringify(list));
  const replayed = new World(1, { flat: 3 });
  replayed.applyEdits(list);
  assert('replaying rebuilds the same world',
    replayed.get(3, 8, 3) === STONE && replayed.get(-70, 5, 12) === GRASS);
  assert('chunk keys are stable', chunkKey(-3, 4) === '-3,4');
}

// ------------------------------------------------------------- biomes
{
  const seed = WORLD_SEED;
  // Weights are a partition of unity everywhere, which is what keeps biome
  // borders from being cliffs.
  let sumsOk = true;
  let negative = false;
  for (let i = 0; i < 4000; i++) {
    const x = (i * 137) % 6000 - 3000;
    const z = Math.floor(i / 40) * 71 - 3000;
    const w = biomeWeights(x, z, seed);
    const sum = BIOMES.reduce((acc, b) => acc + w[b], 0);
    if (Math.abs(sum - 1) > 1e-9) sumsOk = false;
    if (BIOMES.some((b) => w[b] < 0)) negative = true;
  }
  assert('biome weights always sum to 1', sumsOk);
  assert('no negative weights', !negative);

  // All four biomes actually occur, in sane proportions.
  const seen = Object.fromEntries(BIOMES.map((b) => [b, 0]));
  for (let i = 0; i < 8000; i++) {
    const x = (i * 53) % 5000 - 2500;
    const z = Math.floor(i / 60) * 43 - 2500;
    seen[dominantBiome(biomeWeights(x, z, seed))]++;
  }
  assert('every biome exists', BIOMES.every((b) => seen[b] > 100), JSON.stringify(seen));

  // Coherence: the ground rolls rather than jumping. Mountains legitimately
  // have cliffs now that they reach 150 — Minecraft's do — so this checks the
  // shape of the distribution instead of a flat ceiling: almost every step is
  // walkable, and nothing anywhere is a sheer wall.
  let worstStep = 0;
  let gentle = 0;
  let steps = 0;
  for (let i = 0; i < 8000; i++) {
    const x = (i * 31) % 4000 - 2000;
    const z = Math.floor(i / 40) * 53 - 2000;
    const step = Math.abs(surfaceHeight(x + 1, z, seed) - surfaceHeight(x, z, seed));
    worstStep = Math.max(worstStep, step);
    if (step <= 3) gentle++;
    steps++;
  }
  assert('almost every step is walkable', gentle / steps > 0.95,
    `${((gentle / steps) * 100).toFixed(1)}%`);
  assert('and nothing is a sheer wall', worstStep <= 12, worstStep);

  // Surface material follows the biome.
  const desertCol = (() => {
    for (let i = 0; i < 40000; i++) {
      const x = (i * 71) % 6000 - 3000;
      const z = Math.floor(i / 50) * 37 - 3000;
      const w = biomeWeights(x, z, seed);
      if (w.desert > 0.8) return { x, z, w };
    }
    return null;
  })();
  assert('deserts exist and are sand', desertCol &&
    surfaceBlocks(surfaceHeight(desertCol.x, desertCol.z, seed), desertCol.w).top === SANDID);

  const peak = (() => {
    let best = null;
    for (let i = 0; i < 40000; i++) {
      const x = (i * 91) % 6000 - 3000;
      const z = Math.floor(i / 50) * 29 - 3000;
      const h = surfaceHeight(x, z, seed);
      if (!best || h > best.h) best = { x, z, h, w: biomeWeights(x, z, seed) };
    }
    return best;
  })();
  assert('mountains reach snow line', peak.h >= 38, `highest ${peak.h}`);
  assert('peaks are snow-capped', surfaceBlocks(peak.h, peak.w).top === SNOW,
    surfaceBlocks(peak.h, peak.w).top);
}

// --------------------------------------------------------------- trees
{
  const seed = WORLD_SEED;
  const w = new World(seed);

  // find a tree and check it is made of wood and leaves and stands on grass
  let found = null;
  for (let x = -400; x < 400 && !found; x++) {
    for (let z = -400; z < 400; z++) {
      if (treeAt(x, z, seed)) { found = { x, z }; break; }
    }
  }
  assert('forests grow trees', found !== null, JSON.stringify(found));
  if (found) {
    const { x, z } = found;
    const ground = surfaceHeight(x, z, seed);
    assert('trunk is log', w.get(x, ground + 1, z) === LOG, w.get(x, ground + 1, z));
    assert('tree stands on the surface', w.get(x, ground, z) === 1, w.get(x, ground, z));
    let leaves = 0;
    for (let dy = 0; dy < 10; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (w.get(x + dx, ground + dy, z + dz) === LEAVES) leaves++;
        }
      }
    }
    assert('trees have a canopy', leaves > 12, leaves);

    // the same tree must appear identically after its chunk is thrown away
    const before = w.get(x, ground + 1, z);
    w.evictOutside(9999, 9999, 0);
    assert('trees survive a chunk regenerate', w.get(x, ground + 1, z) === before);
  }

  // canopies cross chunk borders without being clipped
  let straddler = null;
  for (let c = -20; c < 20 && !straddler; c++) {
    for (let z = -400; z < 400; z++) {
      const x = c * CHUNK_SIZE; // first column of a chunk
      if (treeAt(x, z, seed)) straddler = { x, z };
      if (straddler) break;
    }
  }
  if (straddler) {
    const { x, z } = straddler;
    const ground = surfaceHeight(x, z, seed);
    let left = 0;
    for (let dy = 0; dy < 10; dy++) {
      if (w.get(x - 1, ground + dy, z) === LEAVES) left++;
    }
    assert('canopy spills into the neighbouring chunk', left > 0, left);
  } else {
    assert('canopy spills into the neighbouring chunk', true, 'no straddling tree found');
  }
}

// spawn lands somewhere sensible
{
  const spawn = findSpawn(WORLD_SEED);
  const h = surfaceHeight(Math.floor(spawn.x), Math.floor(spawn.z), WORLD_SEED);
  const w = biomeWeights(Math.floor(spawn.x), Math.floor(spawn.z), WORLD_SEED);
  assert('spawn is above the sand line', h > SAND_LEVEL, h);
  assert('spawn is on grass', surfaceBlocks(h, w).top === 1, surfaceBlocks(h, w).top);
  assert('spawn is not inside a tree', treeAt(Math.floor(spawn.x), Math.floor(spawn.z), WORLD_SEED) === 0);
}

// ---------------------------------------------------------------- caves
{
  const w = new World(WORLD_SEED);

  // There are caves, and they are underground rather than everywhere.
  let cave = 0;
  let deep = 0;
  for (let x = 0; x < 64; x++) {
    for (let z = 0; z < 64; z++) {
      for (let y = -60; y < 0; y += 2) {
        deep++;
        if (w.get(x, y, z) === AIR) cave++;
      }
    }
  }
  const fraction = cave / deep;
  assert('caves exist underground', fraction > 0.02, `${(fraction * 100).toFixed(1)}%`);
  assert('caves do not hollow out the world', fraction < 0.25, `${(fraction * 100).toFixed(1)}%`);

  // A cave crossing a chunk border must line up from both sides. Chunk 0 and
  // chunk -1 are generated independently; the noise lattice is world-aligned
  // so the column either side of x = 0 has to agree.
  //
  // This is block-for-block rather than air-vs-solid on purpose: the two are
  // separate implementations of the same lattice — chunk generation
  // precomputes it, generatedBlock interpolates a cell at a time — and any
  // drift between them would show up in the world as a seam.
  let mismatches = 0;
  let firstBad = null;
  for (let x = -34; x < 34; x += 3) {
    for (let z = -34; z < 34; z += 3) {
      for (let y = WORLD_MIN_Y; y <= 60; y += 7) {
        const direct = generatedBlock(x, y, z, WORLD_SEED);
        const chunked = w.get(x, y, z);
        if (direct !== chunked) {
          mismatches++;
          firstBad ??= `${x},${y},${z}: ${chunked} vs ${direct}`;
        }
      }
    }
  }
  assert('chunked and direct generation agree block for block',
    mismatches === 0, firstBad ?? '');

  // Nothing is carved right under the surface, which is what keeps the
  // terrain shell watertight for the mesher.
  let brokeSurface = false;
  for (let x = 0; x < 48; x++) {
    for (let z = 0; z < 48; z++) {
      const h = surfaceHeight(x, z, WORLD_SEED);
      for (let y = h - 2; y <= h; y++) if (w.get(x, y, z) === AIR) brokeSurface = true;
    }
  }
  assert('caves never break through to the sky', !brokeSurface);
}

// ------------------------------------------------------------ stone types
{
  const w = new World(WORLD_SEED);
  let stoneHigh = 0;
  let deepLow = 0;
  let deepHigh = 0;
  for (let x = 0; x < 40; x++) {
    for (let z = 0; z < 40; z++) {
      if (w.get(x, 8, z) === STONE) stoneHigh++;
      if (w.get(x, 8, z) === DEEPSLATE) deepHigh++;
      if (w.get(x, -20, z) === DEEPSLATE) deepLow++;
    }
  }
  assert('stone above the transition', stoneHigh > 0, stoneHigh);
  assert('no deepslate well above the transition', deepHigh === 0, deepHigh);
  assert('deepslate below the transition', deepLow > 1200, deepLow);

  // The boundary is jittered per column rather than being a flat plane.
  const tops = new Set();
  for (let x = 0; x < 40; x++) tops.add(deepslateTop(x, 7, WORLD_SEED));
  assert('the deepslate line is ragged', tops.size > 3, tops.size);
  assert('and sits around y=4', Math.max(...tops) === DEEPSLATE_LEVEL,
    `${Math.min(...tops)}..${Math.max(...tops)}`);
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
