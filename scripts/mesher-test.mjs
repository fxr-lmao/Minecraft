// Verify the face-culling mesher on the flat world:
// only exposed faces are emitted, with exactly the expected counts.
// Flat 128x128x4 world:
//   grass (top layer):   16384 top faces + 512 world-edge side faces = 16896
//   dirt (2 layers):     2 x 512 edge side faces = 1024
//   bedrock:             512 edge side faces
//   total:               18432 quads  (vs 393216 without culling)
import { World } from '../src/world.js';
import { collectFaces } from '../src/blocks.js';

const world = new World();
const buffers = collectFaces(world);

const quads = (id) => ((buffers.get(id)?.pos.length ?? 0) / 18) | 0; // 6 verts x 3 floats
const quadsWithNormal = (id, n) => {
  const buf = buffers.get(id);
  if (!buf) return 0;
  let c = 0;
  for (let i = 0; i < buf.n.length; i += 3) {
    if (buf.n[i] === n[0] && buf.n[i + 1] === n[1] && buf.n[i + 2] === n[2]) c++;
  }
  return (c / 6) | 0; // 6 vertices per quad
};

const grass = quads(1);
const dirt = quads(2);
const bedrock = quads(8);

const topFaces = quadsWithNormal(1, [0, 1, 0]);
const bottomFaces =
  quadsWithNormal(1, [0, -1, 0]) +
  quadsWithNormal(2, [0, -1, 0]) +
  quadsWithNormal(8, [0, -1, 0]);
const sideFacesX =
  quadsWithNormal(1, [1, 0, 0]) + quadsWithNormal(1, [-1, 0, 0]) +
  quadsWithNormal(2, [1, 0, 0]) + quadsWithNormal(2, [-1, 0, 0]) +
  quadsWithNormal(8, [1, 0, 0]) + quadsWithNormal(8, [-1, 0, 0]);
const sideFacesZ =
  quadsWithNormal(1, [0, 0, 1]) + quadsWithNormal(1, [0, 0, -1]) +
  quadsWithNormal(2, [0, 0, 1]) + quadsWithNormal(2, [0, 0, -1]) +
  quadsWithNormal(8, [0, 0, 1]) + quadsWithNormal(8, [0, 0, -1]);

const checks = [
  ['grass quads = 16896', grass === 16896, grass],
  ['dirt quads = 1024', dirt === 1024, dirt],
  ['bedrock quads = 512', bedrock === 512, bedrock],
  ['total quads = 18432', grass + dirt + bedrock === 18432, grass + dirt + bedrock],
  ['top faces = 16384', topFaces === 16384, topFaces],
  ['no bottom faces', bottomFaces === 0, bottomFaces],
  ['edge sides (x) = 1024', sideFacesX === 1024, sideFacesX],
  ['edge sides (z) = 1024', sideFacesZ === 1024, sideFacesZ],
];

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
}
process.exit(checks.every((c) => c[1]) ? 0 : 1);
