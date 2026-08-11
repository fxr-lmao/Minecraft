// The chunk mesher: hidden-face culling, chunk-seam culling against
// neighbours, and atlas UVs that land inside the right tile.
import { World, GRASS, AIR } from '../src/world.js';
import { meshChunk, tileU, FACES } from '../src/blocks.js';
import { atlasTile, ATLAS_TILES } from '../src/textures.js';
import { CHUNK_SIZE } from '../src/constants.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

const quads = (buf) => buf.pos.length / 18; // 6 verts x 3 floats
const withNormal = (buf, n) => {
  let c = 0;
  for (let i = 0; i < buf.n.length; i += 3) {
    if (buf.n[i] === n[0] && buf.n[i + 1] === n[1] && buf.n[i + 2] === n[2]) c++;
  }
  return c / 6;
};

// A flat chunk surrounded by flat chunks: only the top faces are exposed.
{
  const w = new World(1, { flat: 3 });
  const buf = meshChunk(w, 0, 0);
  const expected = CHUNK_SIZE * CHUNK_SIZE;
  assert('flat chunk emits only its top faces', quads(buf) === expected, quads(buf));
  assert('all of them face up', withNormal(buf, [0, 1, 0]) === expected, withNormal(buf, [0, 1, 0]));
  assert('no downward faces (the world is sealed below)', withNormal(buf, [0, -1, 0]) === 0);
  assert('no side faces against identical neighbours',
    withNormal(buf, [1, 0, 0]) + withNormal(buf, [-1, 0, 0]) === 0);
  assert('culling is doing real work',
    quads(buf) < CHUNK_SIZE * CHUNK_SIZE * 4 * 6, quads(buf));
}

// Digging a hole exposes the four walls and the floor beneath it.
{
  const w = new World(1, { flat: 3 });
  const before = quads(meshChunk(w, 0, 0));
  w.setBlock(10, 3, 10, AIR);
  const after = quads(meshChunk(w, 0, 0));
  // -1 top face removed, +4 side walls, +1 floor top = net +4
  assert('a one-block hole adds four faces', after - before === 4, after - before);
}

// A tower adds sides and a top, and pushes the chunk's scan height up.
{
  const w = new World(1, { flat: 3 });
  const before = quads(meshChunk(w, 0, 0));
  for (let y = 4; y < 10; y++) w.setBlock(16, y, 16, GRASS);
  const after = quads(meshChunk(w, 0, 0));
  assert('a 6-block tower adds 24 sides (its top replaces the ground top)',
    after - before === 24, after - before);
}

// Faces on a chunk seam are culled against the neighbouring chunk.
{
  const w = new World(1, { flat: 3 });
  const plain = quads(meshChunk(w, 0, 0));
  // put a block just outside chunk (0,0), against its +x edge, at ground level
  w.setBlock(CHUNK_SIZE, 4, 5, GRASS);
  const withNeighbour = quads(meshChunk(w, 0, 0));
  assert('a neighbour block does not change this chunk', withNeighbour === plain,
    `${plain} -> ${withNeighbour}`);

  // now raise our own edge column: its +x face must be exposed to the
  // neighbouring chunk's air, and hidden where the neighbour is solid
  const edge = quads(meshChunk(w, 0, 0));
  w.setBlock(CHUNK_SIZE - 1, 4, 5, GRASS); // directly beside the neighbour block
  const joined = quads(meshChunk(w, 0, 0));
  // The new block exposes top/-x/+z/-z = 4 faces; its +x face is hidden by
  // the neighbour across the seam, and it covers the ground top it sits on.
  assert('touching blocks across a seam hide their shared face',
    joined - edge === 3, joined - edge);
}

// Negative chunks mesh the same way.
{
  const w = new World(1, { flat: 3 });
  const buf = meshChunk(w, -3, -2);
  assert('negative chunks mesh', quads(buf) === CHUNK_SIZE * CHUNK_SIZE, quads(buf));
  // Vertices are chunk-local (so they fit in a byte); the chunk origin comes
  // back alongside them and is what the mesh gets positioned at.
  assert('vertices are chunk-local', buf.pos.every((v) => v >= 0 && v <= CHUNK_SIZE + 1));
  assert('the chunk origin is returned', buf.x0 === -3 * CHUNK_SIZE && buf.z0 === -2 * CHUNK_SIZE,
    `${buf.x0},${buf.z0}`);
  assert('positions are packed as bytes', buf.pos instanceof Uint8Array);
  assert('normals are packed as signed bytes', buf.n instanceof Int8Array);
}

// Atlas UVs
{
  assert('atlas has three tiles per block', ATLAS_TILES % 3 === 0 && ATLAS_TILES >= 27, ATLAS_TILES);
  assert('grass side/top/bottom are different tiles',
    new Set([atlasTile(1, 0), atlasTile(1, 1), atlasTile(1, 2)]).size === 3);
  assert('tile 0 starts at u=0', tileU(0, 0) === 0);
  assert('the last tile ends at u=1', Math.abs(tileU(ATLAS_TILES - 1, 1) - 1) < 1e-9);

  const w = new World(1, { flat: 3 });
  const buf = meshChunk(w, 0, 0);
  const grassTop = atlasTile(1, 1);
  const lo = tileU(grassTop, 0);
  const hi = tileU(grassTop, 1);
  // UVs are stored as normalised 16-bit ints, so a texel of slack is expected
  const tol = 2 / 65535;
  let inside = true;
  for (let i = 0; i < buf.uv.length; i += 2) {
    const u = buf.uv[i] / 65535;
    const v = buf.uv[i + 1] / 65535;
    if (u < lo - tol || u > hi + tol) inside = false;
    if (v < -tol || v > 1 + tol) inside = false;
  }
  assert('every UV lands inside the grass-top tile', inside);
  assert('UVs are packed as 16-bit ints', buf.uv instanceof Uint16Array);
}

// The face table itself (winding + tile column) is still sane.
{
  let ok = true;
  FACES.forEach((f) => {
    const a = [f.v[1][0] - f.v[0][0], f.v[1][1] - f.v[0][1], f.v[1][2] - f.v[0][2]];
    const b = [f.v[2][0] - f.v[0][0], f.v[2][1] - f.v[0][1], f.v[2][2] - f.v[0][2]];
    const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    if (!cross.every((c, k) => Math.abs(c - f.n[k]) < 1e-6)) ok = false;
    if (f.col < 0 || f.col > 2) ok = false;
  });
  assert('face winding matches the normals', ok);
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
