// Voxel ray marching (Amanatides & Woo DDA) used for block targeting.
// Pure math on plain {x, y, z} objects so it can be unit-tested in Node.

import { REACH } from './constants.js';

/**
 * March a ray through the voxel grid and return the first block hit.
 *
 * Returns { x, y, z, nx, ny, nz, dist } where (x, y, z) is the hit block and
 * (nx, ny, nz) is the face normal the ray entered through — so the adjacent
 * cell for placement is (x + nx, y + ny, z + nz). Returns null on a miss.
 *
 * `fluids` says what water does to the ray, and there are three answers
 * because there are three things asking:
 *
 *   false      water is not there. Block targeting: you break and build
 *              *through* the sea, and a crosshair that snagged on the surface
 *              would make the shallows unusable.
 *   true       any water stops it. A full bucket, which can be poured into a
 *              stream or the shallow edge of a spread as happily as onto the
 *              ground.
 *   'source'   only a *source* stops it, and flowing water is as transparent
 *              as air. An empty bucket can only fill from a source, so this is
 *              the ray that finds it: the sheet of flow running over the sea,
 *              or the stream you are standing in, is not the thing you are
 *              pointing at and should not be what you get.
 *
 * The result carries `throughWater`, true when the ray passed through water
 * that did not stop it, so a caller can tell "nothing there" from "nothing
 * there but flow" and say so.
 *
 * With water stopping the ray at all, a ray that *starts* inside water ignores
 * the cell it started in. Otherwise every use of a bucket while swimming would
 * fill from the block your own head is in, whatever you were looking at.
 */
export function raycastVoxel(world, origin, dir, maxDist = REACH, { fluids = false } = {}) {
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
  let throughWater = false;

  // A generous iteration cap: at most ~3 cell crossings per block of reach.
  for (let i = 0; i < 3 * maxDist + 9; i++) {
    if (world.inBounds(ix, iy, iz)) {
      if (world.isSolid(ix, iy, iz)) {
        return { x: ix, y: iy, z: iz, nx, ny, nz, dist: t, throughWater };
      }
      // Water only counts once the ray has *entered* a cell. The cell the ray
      // starts in is the one the camera is already inside, and a bucket used
      // while swimming should fill from what you are looking at rather than
      // from your own head. Solids need no such rule: you are never inside one.
      if (fluids && i > 0 && world.isWaterAt(ix, iy, iz)) {
        if (fluids !== 'source' || world.isWaterSourceAt(ix, iy, iz)) {
          return { x: ix, y: iy, z: iz, nx, ny, nz, dist: t, throughWater };
        }
        // Flow the ray is allowed through — but remember that it was there.
        throughWater = true;
      }
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
