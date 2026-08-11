// The chunk mesher: hidden-face culling, chunk-seam culling against
// neighbours, and atlas UVs that land inside the right tile.
import { World, GRASS, AIR } from '../src/world.js';
import { meshChunk, tileU, FACES } from '../src/blocks.js';
import { atlasTile, ATLAS_TILES } from '../src/textures.js';
import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_MIN_Y, WORLD_SEED } from '../src/constants.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

const quads = (buf) => buf.pos.length / 18; // 6 verts x 3 floats

// "block x,y,z + face index" for every quad in a buffer, recovered from the
// quad's normal and its lowest corner.
const NORMAL_FACE = { '1,0,0': 0, '-1,0,0': 1, '0,1,0': 2, '0,-1,0': 3, '0,0,1': 4, '0,0,-1': 5 };
function faceSet(buf) {
  const out = new Set();
  for (let q = 0; q < buf.pos.length; q += 18) {
    const f = NORMAL_FACE[`${buf.n[q]},${buf.n[q + 1]},${buf.n[q + 2]}`];
    let x = Infinity;
    let y = Infinity;
    let z = Infinity;
    for (let v = 0; v < 18; v += 3) {
      x = Math.min(x, buf.pos[q + v]);
      y = Math.min(y, buf.pos[q + v + 1]);
      z = Math.min(z, buf.pos[q + v + 2]);
    }
    // A +x face sits on the far side of its block, likewise +y and +z.
    if (f === 0) x -= 1;
    if (f === 2) y -= 1;
    if (f === 4) z -= 1;
    out.add(`${x},${y},${z},${f}`);
  }
  return out;
}
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
  // Vertices are chunk-local horizontally and layer-indexed vertically, so
  // all three fit in a byte; the mesh is positioned at the chunk origin and
  // the world floor to put them back where they belong.
  let localXZ = true;
  let localY = true;
  for (let i = 0; i < buf.pos.length; i += 3) {
    if (buf.pos[i] > CHUNK_SIZE || buf.pos[i + 2] > CHUNK_SIZE) localXZ = false;
    if (buf.pos[i + 1] > WORLD_HEIGHT) localY = false;
  }
  assert('vertices are chunk-local horizontally', localXZ);
  assert('vertices are layer-indexed vertically', localY);
  assert('the flat surface meshes at its layer', buf.pos[1] === 3 - WORLD_MIN_Y + 1,
    buf.pos[1]);
  assert('the chunk origin is returned', buf.x0 === -3 * CHUNK_SIZE && buf.z0 === -2 * CHUNK_SIZE,
    `${buf.x0},${buf.z0}`);
  assert('positions are packed as bytes', buf.pos instanceof Uint8Array);
  assert('normals are packed as signed bytes', buf.n instanceof Int8Array);
}

// Shell meshing: distant chunks skip their caves. That is only safe if every
// face you could actually see is still built, so this checks it directly —
// flood-fill the air that reaches the outside, then require every face
// touching it to be present in the shell mesh.
{
  const w = new World(WORLD_SEED);
  const cx = 2;
  const cz = 3;
  const chunk = w.chunk(cx, cz);
  const deepFaces = faceSet(meshChunk(w, cx, cz, true));
  const shellFaces = faceSet(meshChunk(w, cx, cz, false));

  assert('shell mesh is a subset of the deep one',
    [...shellFaces].every((f) => deepFaces.has(f)));
  assert('shell mesh is smaller (there are caves down there)',
    shellFaces.size < deepFaces.size, `${shellFaces.size} < ${deepFaces.size}`);

  // Air connected to the sky — that, and only that, is what a player outside
  // the terrain can see into. The chunk's own sides are treated as closed:
  // cave air touching them is not "outside", it is just the same cave
  // continuing into the neighbour.
  const S = CHUNK_SIZE;
  const outside = new Uint8Array(S * S * WORLD_HEIGHT);
  const idx = (x, y, z) => (y * S + z) * S + x;
  const solid = (x, y, z) => chunk.blocks[y * S * S + z * S + x] !== 0;
  const stack = [];
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const y = WORLD_HEIGHT - 1;
      if (!solid(x, y, z)) {
        outside[idx(x, y, z)] = 1;
        stack.push(x, y, z);
      }
    }
  }
  const STEPS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (stack.length) {
    const z = stack.pop();
    const y = stack.pop();
    const x = stack.pop();
    for (const [dx, dy, dz] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || nx >= S || nz < 0 || nz >= S || ny < 0 || ny >= WORLD_HEIGHT) continue;
      if (outside[idx(nx, ny, nz)] || solid(nx, ny, nz)) continue;
      outside[idx(nx, ny, nz)] = 1;
      stack.push(nx, ny, nz);
    }
  }

  let visible = 0;
  let missing = 0;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        if (!solid(x, y, z)) continue;
        for (let f = 0; f < STEPS.length; f++) {
          const [dx, dy, dz] = STEPS[f];
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (nx < 0 || nx >= S || nz < 0 || nz >= S || ny < 0 || ny >= WORLD_HEIGHT) continue;
          if (!outside[idx(nx, ny, nz)]) continue;
          visible++;
          if (!shellFaces.has(`${x},${y},${z},${f}`)) missing++;
        }
      }
    }
  }
  assert('the flood fill actually found the outside', visible > 1000, visible);
  assert('no visible face is missing from the shell mesh', missing === 0,
    `${missing} of ${visible}`);
  assert('the caves it skipped are real geometry',
    deepFaces.size - shellFaces.size > 500, deepFaces.size - shellFaces.size);
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
