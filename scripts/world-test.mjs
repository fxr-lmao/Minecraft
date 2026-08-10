// Verify flat world generation: layer counts, heights, borders, open sky,
// and that block edits flag the right chunks for re-meshing.
import { World, AIR, GRASS } from '../src/world.js';
import { WORLD_SIZE, WORLD_LAYERS, GROUND_LAYERS, CHUNK_SIZE } from '../src/constants.js';

const w = new World();
let grass = 0, dirt = 0, bedrock = 0;
for (const b of w.solidBlocks()) {
  if (b.id === 1) grass++;
  else if (b.id === 2) dirt++;
  else if (b.id === 8) bedrock++;
}
const total = WORLD_SIZE * WORLD_SIZE * GROUND_LAYERS;

// --- block edits ---
const edits = new World();
edits.setBlock(70, 6, 70, GRASS); // well inside chunk (2,2)
const placed = edits.get(70, 6, 70);
const dirtyAfterPlace = [...edits.dirtyChunks];
edits.consumeDirtyChunks();
edits.setBlock(70, 6, 70, AIR);
const broken = edits.get(70, 6, 70);
const dirtyAfterBreak = [...edits.dirtyChunks];
edits.consumeDirtyChunks();
// a block on a chunk seam also dirties the neighbouring chunk
edits.setBlock(CHUNK_SIZE, 5, 40, GRASS);
const seamChunks = [...edits.dirtyChunks].sort();

const checks = [
  ['total blocks', grass + dirt + bedrock === total, `${grass + dirt + bedrock}/${total}`],
  ['grass count (top layer)', grass === WORLD_SIZE * WORLD_SIZE, grass],
  ['dirt count (2 layers)', dirt === 2 * WORLD_SIZE * WORLD_SIZE, dirt],
  ['bedrock count', bedrock === WORLD_SIZE * WORLD_SIZE, bedrock],
  ['heightAt center = 3', w.heightAt(64, 64) === 3, w.heightAt(64, 64)],
  ['isSolid(0,0,0) bedrock', w.isSolid(0, 0, 0)],
  ['air above surface', !w.isSolid(64, 4, 64)],
  ['buildable headroom', WORLD_LAYERS > GROUND_LAYERS, `${WORLD_LAYERS} layers`],
  ['out-of-bounds is solid (border)', w.isSolid(-1, 3, 3) && w.isSolid(128, 3, 3)],
  ['setBlock places', placed === GRASS, placed],
  ['setBlock breaks', broken === AIR, broken],
  ['place marks one chunk dirty', dirtyAfterPlace.length === 1, dirtyAfterPlace.join(' ')],
  ['break marks one chunk dirty', dirtyAfterBreak.length === 1, dirtyAfterBreak.join(' ')],
  ['chunk seam dirties both chunks', seamChunks.length === 2, seamChunks.join(' ')],
  ['edits above the world are ignored', edits.setBlock(10, WORLD_LAYERS, 10, GRASS) === false],
];
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}
const passed = checks.filter((c) => c[1]).length;
console.log(`\n${passed}/${checks.length} passed`);
process.exit(checks.every((c) => c[1]) ? 0 : 1);
