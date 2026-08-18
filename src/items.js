// Things you carry that are not blocks.
//
// Until now the inventory held block ids and nothing else, and `placeBlock`
// could take any stack and hand it straight to `world.setBlock`. That works
// right up until the first item that is not a block — a bucket — because a
// bucket in a cell of the world would be a solid block you could stand on.
//
// So items live in their own range of ids, above every block, and the world
// never sees them. `isItem` is the whole of the type system: the placement
// path checks it and branches to `useItem` instead of putting anything in the
// world. The ids still share one number line with blocks because the
// inventory, the save file and the hotbar all store a single id per stack,
// and splitting that into a (kind, id) pair would touch all three for no gain
// anyone can see.
//
// The behaviour is here rather than in main.js because it is the interesting
// part and it is pure: give it a world and a target and it tells you what to
// change. No THREE, no DOM, so the rules are unit-tested in Node.

import { AIR, WATER, isWater, isWaterSource, isOpaque } from './terrain.js';

/**
 * Where the item ids start. Blocks run 1..21 today (water's eight levels take
 * 13..21), so there is a lot of daylight between the two ranges — deliberately,
 * because an id that lands in the wrong range is a block you can walk through
 * or an item you can build a house out of, and neither fails loudly.
 */
export const ITEM_BASE = 200;

/** True for anything that goes in a hand rather than in the world. */
export const isItem = (id) => id >= ITEM_BASE;

export const BUCKET = 200;
export const WATER_BUCKET = 201;

/** Item ids, in the order their textures are packed into the atlas. */
export const ITEM_IDS = [BUCKET, WATER_BUCKET];

export const ITEM_NAMES = {
  [BUCKET]: 'Bucket',
  [WATER_BUCKET]: 'Water Bucket',
};

/**
 * A bucket holds one source block and nothing else.
 *
 * Minecraft's rule, and it is worth stating because the alternative is
 * tempting and wrong: an empty bucket fills from a *source* only, never from
 * flowing water. Scooping a stream would be pointless — the level you took
 * would be replaced from upstream on the next tick, so the bucket would be a
 * tap that never runs dry and the stream would never notice. Sources are the
 * only water that is really *there*.
 */
export function canFillFrom(id) {
  return isWaterSource(id);
}

/**
 * Where a bucket of water would go, given what the crosshair is on.
 *
 * Two cases. Looking at a solid block, the water goes in front of its face,
 * like placing any other block. Looking at water — at a stream, at the shallow
 * edge of a spread — it goes *into* that cell, replacing it, because the
 * alternative is that you cannot fill a pond you have already half filled.
 *
 * Returns null when there is nowhere sensible for it to go.
 */
export function waterTarget(world, hit) {
  if (!hit) return null;
  const at = world.get(hit.x, hit.y, hit.z);
  if (isWater(at)) {
    // Already a source: nothing to do, and pretending otherwise would eat
    // the bucket.
    if (isWaterSource(at)) return null;
    return { x: hit.x, y: hit.y, z: hit.z };
  }
  const x = hit.x + hit.nx;
  const y = hit.y + hit.ny;
  const z = hit.z + hit.nz;
  if (!world.inBounds(x, y, z)) return null;
  const into = world.get(x, y, z);
  if (isOpaque(into)) return null; // a solid neighbour is not a place for water
  if (isWaterSource(into)) return null;
  return { x, y, z };
}

/**
 * Use a bucket on whatever the crosshair found.
 *
 * `hit` is a raycast result that was allowed to stop at fluid — see
 * `raycastVoxel(..., { fluids: true })` — because an empty bucket has to be
 * able to aim at the sea, which a solid-only ray goes straight through.
 *
 * Returns null when nothing happens, or:
 *   { item, x, y, z, block, message }
 * where `item` is what the bucket becomes and `block` is what the cell
 * becomes. The caller does the writing, so this stays pure and the rules stay
 * testable.
 */
export function useBucket(world, hit, id) {
  if (id === BUCKET) {
    if (!hit) return null;
    const at = world.get(hit.x, hit.y, hit.z);
    if (!canFillFrom(at)) {
      return isWater(at)
        ? { message: 'Flowing water runs through your fingers' }
        : null;
    }
    return {
      item: WATER_BUCKET,
      x: hit.x,
      y: hit.y,
      z: hit.z,
      block: AIR,
      message: 'Filled the bucket',
    };
  }

  if (id === WATER_BUCKET) {
    const spot = waterTarget(world, hit);
    if (!spot) return null;
    return {
      item: BUCKET,
      x: spot.x,
      y: spot.y,
      z: spot.z,
      block: WATER,
      message: 'Poured out the bucket',
    };
  }

  return null;
}

/** Does using this item need the raycast to be able to see water? */
export function needsFluidAim(id) {
  return id === BUCKET || id === WATER_BUCKET;
}
