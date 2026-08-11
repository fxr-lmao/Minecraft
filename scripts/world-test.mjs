// The infinite chunked world: generation, negative coordinates, edits that
// survive a chunk being evicted and regenerated, and dirty-chunk tracking.
import { World, AIR, GRASS, STONE, BEDROCK, toChunk, toLocal, chunkKey } from '../src/world.js';
import { surfaceHeight, generatedBlock } from '../src/terrain.js';
import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_SEED } from '../src/constants.js';

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
  assert('bedrock at the bottom', w.get(5, 0, 5) === BEDROCK, w.get(5, 0, 5));
  assert('air well above the surface', w.get(5, WORLD_HEIGHT - 1, 5) === AIR);
  assert('above the world is air', w.get(5, WORLD_HEIGHT + 10, 5) === AIR);
  assert('below the world is sealed', w.get(5, -1, 5) === BEDROCK);

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
  assert('terrain stays in a sane band', min >= 2 && max <= 40, `${min}..${max}`);
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
  assert('edits above the world are refused', w.setBlock(5, WORLD_HEIGHT, 5, GRASS) === false);
  assert('edits below the world are refused', w.setBlock(5, -1, 5, GRASS) === false);
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

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
