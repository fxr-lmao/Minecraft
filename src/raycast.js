// Voxel ray marching (Amanatides & Woo DDA) used for block targeting.
// Pure math on plain {x, y, z} objects so it can be unit-tested in Node.

import { REACH } from './constants.js';

/**
 * March a ray through the voxel grid and return the first solid block hit.
 *
 * Returns { x, y, z, nx, ny, nz, dist } where (x, y, z) is the hit block and
 * (nx, ny, nz) is the face normal the ray entered through — so the adjacent
 * cell for placement is (x + nx, y + ny, z + nz). Returns null on a miss.
 */
export function raycastVoxel(world, origin, dir, maxDist = REACH) {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;

  let ix = Math.floor(origin.x);
  let iy = Math.floor(origin.y);
  let iz = Math.floor(origin.z);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = dx !== 0 ? (stepX > 0 ? ix + 1 - origin.x : origin.x - ix) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (stepY > 0 ? iy + 1 - origin.y : origin.y - iy) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (stepZ > 0 ? iz + 1 - origin.z : origin.z - iz) * tDeltaZ : Infinity;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  // A generous iteration cap: at most ~3 cell crossings per block of reach.
  for (let i = 0; i < 3 * maxDist + 9; i++) {
    if (world.inBounds(ix, iy, iz) && world.isSolid(ix, iy, iz)) {
      return { x: ix, y: iy, z: iz, nx, ny, nz, dist: t };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      if (t > maxDist) return null;
      ix += stepX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      if (t > maxDist) return null;
      iy += stepY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tMaxZ;
      if (t > maxDist) return null;
      iz += stepZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

/**
 * Would a 1x1x1 block at (bx, by, bz) overlap the player's AABB?
 * Placement is refused when it would trap the player inside a block.
 */
export function blockIntersectsPlayer(bx, by, bz, pos, width, height) {
  const half = width / 2;
  return (
    bx + 1 > pos.x - half && bx < pos.x + half &&
    by + 1 > pos.y && by < pos.y + height &&
    bz + 1 > pos.z - half && bz < pos.z + half
  );
}
