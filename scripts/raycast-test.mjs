// Block targeting: the voxel DDA used for breaking/placing, the placement
// guard that stops you sealing yourself inside a block, and the third-person
// camera pull-in.
import { World, AIR, GRASS } from '../src/world.js';
import { raycastVoxel, blockIntersectsPlayer } from '../src/raycast.js';
import { lookVector, freeDistance } from '../src/view.js';
import { PLAYER_WIDTH, PLAYER_HEIGHT, REACH } from '../src/constants.js';

const world = new World(1, { flat: 3 }); // top grass layer at y = 3
const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

// straight down onto the grass
{
  const hit = raycastVoxel(world, { x: 64.5, y: 5.5, z: 64.5 }, { x: 0, y: -1, z: 0 }, REACH);
  assert('looking down hits the ground', hit && hit.y === 3, hit && `y=${hit.y}`);
  assert('ground hit gives the +y face', hit && hit.ny === 1, hit && `n=${hit.nx},${hit.ny},${hit.nz}`);
  assert('distance is measured', hit && Math.abs(hit.dist - 1.5) < 1e-6, hit && hit.dist.toFixed(3));
}

// looking up at the open sky
{
  const hit = raycastVoxel(world, { x: 64.5, y: 5.5, z: 64.5 }, { x: 0, y: 1, z: 0 }, REACH);
  assert('looking at the sky hits nothing', hit === null, hit);
}

// out of reach
{
  const hit = raycastVoxel(world, { x: 64.5, y: 20.5, z: 64.5 }, { x: 0, y: -1, z: 0 }, REACH);
  assert('ground further than the reach is not targetable', hit === null, hit);
}

// a pillar to the side gives the face you can build off
{
  const w2 = new World(1, { flat: 3 });
  w2.setBlock(66, 4, 64, GRASS);
  const hit = raycastVoxel(w2, { x: 64.5, y: 4.5, z: 64.5 }, { x: 1, y: 0, z: 0 }, REACH);
  assert('side hit finds the pillar', hit && hit.x === 66 && hit.y === 4, hit && `${hit.x},${hit.y},${hit.z}`);
  assert('side hit gives the -x face', hit && hit.nx === -1, hit && `n=${hit.nx},${hit.ny},${hit.nz}`);
  const px = hit.x + hit.nx;
  assert('placement cell is the empty neighbour', w2.get(px, hit.y, hit.z) === AIR, w2.get(px, hit.y, hit.z));
}

// diagonal rays land on the nearest block, not through corners
{
  const hit = raycastVoxel(world, { x: 64.5, y: 5.0, z: 64.5 }, { x: 0.6, y: -1, z: 0.3 }, REACH);
  assert('diagonal ray still lands on the ground', hit && hit.y === 3, hit && `y=${hit.y}`);
}

// placement guard
{
  const pos = { x: 64.5, y: 4, z: 64.5 }; // standing on the grass
  assert('cannot place inside your feet',
    blockIntersectsPlayer(64, 4, 64, pos, PLAYER_WIDTH, PLAYER_HEIGHT));
  assert('cannot place inside your head',
    blockIntersectsPlayer(64, 5, 64, pos, PLAYER_WIDTH, PLAYER_HEIGHT));
  assert('can place above your head',
    !blockIntersectsPlayer(64, 6, 64, pos, PLAYER_WIDTH, PLAYER_HEIGHT));
  assert('can place next to you',
    !blockIntersectsPlayer(65, 4, 64, pos, PLAYER_WIDTH, PLAYER_HEIGHT));
}

// third-person camera collision
{
  const eye = { x: 64.5, y: 5.62, z: 64.5 };
  const back = lookVector(0, 0); // facing -z, so the camera goes to +z
  const behind = { x: -back.x, y: -back.y, z: -back.z };
  assert('open space keeps the full camera distance',
    freeDistance(world, eye, behind, 4) === 4, freeDistance(world, eye, behind, 4));

  const straightDown = freeDistance(world, eye, { x: 0, y: -1, z: 0 }, 4);
  assert('camera stops above the ground', straightDown > 1 && straightDown < 1.6, straightDown.toFixed(2));

  const walled = new World(1, { flat: 3 });
  for (let y = 3; y < 8; y++) walled.setBlock(66, y, 64, GRASS);
  const dist = freeDistance(walled, eye, { x: 1, y: 0, z: 0 }, 4);
  assert('camera stops before a wall', dist > 1 && dist < 1.5, dist.toFixed(2));
}

// look vector matches the camera convention (yaw 0 faces -z)
{
  const f = lookVector(0, 0);
  assert('yaw 0 looks toward -z', Math.abs(f.z + 1) < 1e-9 && Math.abs(f.x) < 1e-9, `${f.x.toFixed(2)},${f.z.toFixed(2)}`);
  const up = lookVector(0, Math.PI / 2);
  assert('pitch +90 looks up', Math.abs(up.y - 1) < 1e-9, up.y.toFixed(2));
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
