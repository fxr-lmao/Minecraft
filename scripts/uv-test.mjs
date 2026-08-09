// Verify the block geometry atlas UV remap: each face maps to its atlas column.
import { getBlockGeometry } from '../src/blocks.js';

const geo = getBlockGeometry();
const uv = geo.attributes.uv;
const index = geo.index;
const cols = [0, 0, 1, 2, 0, 0]; // +x,-x,+y,-y,+z,-z
const faceNames = ['+x', '-x', '+y', '-y', '+z', '-z'];
let ok = true;

for (const g of geo.groups) {
  let minU = Infinity, maxU = -Infinity;
  for (let j = g.start; j < g.start + g.count; j++) {
    const u = uv.getX(index.getX(j));
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
  }
  const expectLo = cols[g.materialIndex] / 3;
  const expectHi = (cols[g.materialIndex] + 1) / 3;
  const pass = Math.abs(minU - expectLo) < 1e-6 && Math.abs(maxU - expectHi) < 1e-6;
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  face ${faceNames[g.materialIndex]} -> u in [${minU.toFixed(3)}, ${maxU.toFixed(3)}]`);
}

console.log(ok ? 'UV atlas OK' : 'UV atlas BROKEN');
process.exit(ok ? 0 : 1);
