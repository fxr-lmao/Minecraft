// Verify flat world generation: layer counts, heights, borders, open sky.
import { World } from '../src/world.js';
import { WORLD_SIZE, WORLD_LAYERS } from '../src/constants.js';

const w = new World();
let grass = 0, dirt = 0, bedrock = 0;
for (const b of w.solidBlocks()) {
  if (b.id === 1) grass++;
  else if (b.id === 2) dirt++;
  else if (b.id === 8) bedrock++;
}
const total = WORLD_SIZE * WORLD_SIZE * WORLD_LAYERS;
const checks = [
  ['total blocks', grass + dirt + bedrock === total, `${grass + dirt + bedrock}/${total}`],
  ['grass count (top layer)', grass === WORLD_SIZE * WORLD_SIZE, grass],
  ['dirt count (2 layers)', dirt === 2 * WORLD_SIZE * WORLD_SIZE, dirt],
  ['bedrock count', bedrock === WORLD_SIZE * WORLD_SIZE, bedrock],
  ['heightAt center = 3', w.heightAt(64, 64) === 3, w.heightAt(64, 64)],
  ['isSolid(0,0,0) bedrock', w.isSolid(0, 0, 0)],
  ['air above surface', !w.isSolid(64, 4, 64)],
  ['out-of-bounds is solid (border)', w.isSolid(-1, 3, 3) && w.isSolid(128, 3, 3)],
];
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}
process.exit(checks.every((c) => c[1]) ? 0 : 1);
