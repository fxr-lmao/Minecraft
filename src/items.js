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
/**
 * Tools. There is no crafting yet, so these are given rather than made — but
 * what they *do* is the real rule (see mining.js): the right tool is not
 * merely faster, it is the difference between a vein you can take and a vein
 * you can only look at.
 */
export const PICKAXE = 202;
export const SHOVEL = 203;

// Crafting-era items: sticks and the tool tiers, which the crafting table
// makes from planks and stone. Wooden tools are slower than the iron ones
// you start with, stone sits between them — which is what makes the starter
// kit still feel like a gift, and the furnace worth building (cobblestone
// smelts into the stone the mid tier needs).
export const STICKS = 204;
export const WOOD_PICKAXE = 205;
export const WOOD_SHOVEL = 206;
export const STONE_PICKAXE = 207;
export const STONE_SHOVEL = 208;

/**
 * Axes and swords, and the materials the higher tiers are made of.
 *
 * The two new shapes are here because the two old ones had between them
 * covered only half of what a tool is for. A pickaxe is the answer to stone
 * and an axe is the answer to wood, and until there was one, chopping a tree
 * was three seconds a log by hand whatever you were carrying — which made the
 * forest the one part of the world that a hotbar full of tools could not help
 * you with. The sword is the other half again: it is not a digging tool at
 * all, so it wants its own rules rather than an entry in the speed table.
 *
 * The materials are the reason the tiers now have a ladder instead of a
 * ceiling. Coal and raw iron come out of the ore they were always in, the
 * furnace turns raw iron into an ingot, and diamonds come out whole — so an
 * iron pickaxe is finally something you *make* rather than something the
 * starter kit gave you, and the diamond tier exists at all.
 */
export const WOOD_AXE = 209;
export const STONE_AXE = 210;
export const IRON_AXE = 211;
export const WOOD_SWORD = 212;
export const STONE_SWORD = 213;
export const IRON_SWORD = 214;
export const COAL = 215;
export const RAW_IRON = 216;
export const IRON_INGOT = 217;
export const DIAMOND = 218;
export const DIAMOND_PICKAXE = 219;
export const DIAMOND_SHOVEL = 220;
export const DIAMOND_AXE = 221;
export const DIAMOND_SWORD = 222;
/**
 * The other three things the ground gives you.
 *
 * Gold and redstone were in the world from the day the ore generator went in
 * and had nowhere to go: you dug them, you got the ore block back, and the
 * only thing to do with an ore block was put it down again somewhere else.
 * Now gold smelts into an ingot like iron does and redstone comes out as dust
 * — neither has anything to build yet, which is honest: they are what the
 * mine pays you in, and a diamond is what it pays you in when it is being
 * generous.
 */
export const RAW_GOLD = 223;
export const GOLD_INGOT = 224;
export const REDSTONE = 225;
/**
 * What the mobs you kill are worth carrying.
 *
 * Gunpowder is the point of the creeper: the TNT recipe has wanted five of
 * it since the crafting table went in, and had a stick standing in for it
 * because there was no way to get any. Now there is, and it is the honest
 * one — the only source of gunpowder in Minecraft is creepers, which means
 * the only way to arm yourself with TNT is to go and fight the thing that
 * explodes. Rotten flesh is the other half of the bargain: mostly junk, as
 * it is in Minecraft, but *real* junk — the zombie drops it, it stacks, it
 * sits in a chest, and it is what most of the night's work actually pays.
 */
export const GUNPOWDER = 226;
export const ROTTEN_FLESH = 227;

/** Item ids, in the order their textures are packed into the atlas. */
export const ITEM_IDS = [
  BUCKET, WATER_BUCKET, PICKAXE, SHOVEL, STICKS,
  WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL,
  WOOD_AXE, STONE_AXE, IRON_AXE,
  WOOD_SWORD, STONE_SWORD, IRON_SWORD,
  COAL, RAW_IRON, IRON_INGOT, DIAMOND,
  DIAMOND_PICKAXE, DIAMOND_SHOVEL, DIAMOND_AXE, DIAMOND_SWORD,
  RAW_GOLD, GOLD_INGOT, REDSTONE,
  GUNPOWDER, ROTTEN_FLESH,
];

/**
 * Which shape a tool is, for anything that has to know without caring about
 * the tier — the mining rules, the durability table, and above all the
 * three-dimensional model, which is one mesh per *shape* and a palette per
 * tier rather than fourteen separate models.
 */
export const SHAPE_PICKAXE = 'pickaxe';
export const SHAPE_SHOVEL = 'shovel';
export const SHAPE_AXE = 'axe';
export const SHAPE_SWORD = 'sword';
export const SHAPE_BUCKET = 'bucket';
export const SHAPE_STICK = 'stick';
export const SHAPE_LUMP = 'lump';

/** Tier names, in the order they get better. */
export const TIER_WOOD = 'wood';
export const TIER_STONE = 'stone';
export const TIER_IRON = 'iron';
export const TIER_DIAMOND = 'diamond';

/** Every tool: what shape it is and what it is made of. */
export const TOOL_KINDS = {
  [WOOD_PICKAXE]: { shape: SHAPE_PICKAXE, tier: TIER_WOOD },
  [STONE_PICKAXE]: { shape: SHAPE_PICKAXE, tier: TIER_STONE },
  [PICKAXE]: { shape: SHAPE_PICKAXE, tier: TIER_IRON },
  [DIAMOND_PICKAXE]: { shape: SHAPE_PICKAXE, tier: TIER_DIAMOND },
  [WOOD_SHOVEL]: { shape: SHAPE_SHOVEL, tier: TIER_WOOD },
  [STONE_SHOVEL]: { shape: SHAPE_SHOVEL, tier: TIER_STONE },
  [SHOVEL]: { shape: SHAPE_SHOVEL, tier: TIER_IRON },
  [DIAMOND_SHOVEL]: { shape: SHAPE_SHOVEL, tier: TIER_DIAMOND },
  [WOOD_AXE]: { shape: SHAPE_AXE, tier: TIER_WOOD },
  [STONE_AXE]: { shape: SHAPE_AXE, tier: TIER_STONE },
  [IRON_AXE]: { shape: SHAPE_AXE, tier: TIER_IRON },
  [DIAMOND_AXE]: { shape: SHAPE_AXE, tier: TIER_DIAMOND },
  [WOOD_SWORD]: { shape: SHAPE_SWORD, tier: TIER_WOOD },
  [STONE_SWORD]: { shape: SHAPE_SWORD, tier: TIER_STONE },
  [IRON_SWORD]: { shape: SHAPE_SWORD, tier: TIER_IRON },
  [DIAMOND_SWORD]: { shape: SHAPE_SWORD, tier: TIER_DIAMOND },
};

/**
 * What an item looks like in three dimensions, for the held model. Anything
 * not in here is a flat sprite, which is the right answer for a lump of coal
 * and the wrong one for a bucket.
 */
export const ITEM_SHAPES = {
  ...Object.fromEntries(Object.entries(TOOL_KINDS).map(([id, k]) => [id, k.shape])),
  [BUCKET]: SHAPE_BUCKET,
  [WATER_BUCKET]: SHAPE_BUCKET,
  [STICKS]: SHAPE_STICK,
  [COAL]: SHAPE_LUMP,
  [RAW_IRON]: SHAPE_LUMP,
  [IRON_INGOT]: SHAPE_LUMP,
  [DIAMOND]: SHAPE_LUMP,
  [RAW_GOLD]: SHAPE_LUMP,
  [GOLD_INGOT]: SHAPE_LUMP,
  [REDSTONE]: SHAPE_LUMP,
  [GUNPOWDER]: SHAPE_LUMP,
  [ROTTEN_FLESH]: SHAPE_LUMP,
};

/** The shape of an item, or null for a block (which is a cube already). */
export const itemShape = (id) => ITEM_SHAPES[id] ?? null;

/** The tool's shape/tier pair, or null if it is not a tool. */
export const toolKind = (id) => TOOL_KINDS[id] ?? null;

/** Is this a sword? Swords are the one tool that is not for digging. */
export const isSword = (id) => TOOL_KINDS[id]?.shape === SHAPE_SWORD;

/** Is this an axe? */
export const isAxe = (id) => TOOL_KINDS[id]?.shape === SHAPE_AXE;

/**
 * Is this a raw material — something you carry, smelt or build with, but
 * never swing? Used by the model to keep lumps flat.
 */
export const MATERIALS = [
  COAL, RAW_IRON, IRON_INGOT, DIAMOND, RAW_GOLD, GOLD_INGOT, REDSTONE,
  GUNPOWDER, ROTTEN_FLESH,
];
export const isMaterial = (id) => MATERIALS.includes(id);

/**
 * What each ore gives up when it is broken.
 *
 * Minecraft's split, and it is a real design decision rather than a table:
 * coal, redstone and diamond come out *finished* — there is nothing a furnace
 * can do to a diamond — while iron and gold come out raw and have to be
 * smelted. That is the whole reason a furnace is worth building past the
 * first stack of glass, and the reason an iron pickaxe is a journey rather
 * than a recipe.
 *
 * Keyed by ore id, with the deepslate twins mapping to the same drop, because
 * a deepslate diamond is a diamond that happened to be deeper down.
 */
export const ORE_DROPS = {
  23: COAL, 28: COAL,             // coal ore, deepslate coal ore
  24: RAW_IRON, 29: RAW_IRON,     // iron
  25: RAW_GOLD, 30: RAW_GOLD,     // gold
  26: REDSTONE, 31: REDSTONE,     // redstone
  27: DIAMOND, 32: DIAMOND,       // diamond
};

/** What an ore drops, or null if it is not an ore. */
export const oreDrop = (id) => ORE_DROPS[id] ?? null;

export const ITEM_NAMES = {
  [BUCKET]: 'Bucket',
  [WATER_BUCKET]: 'Water Bucket',
  [PICKAXE]: 'Iron Pickaxe',
  [SHOVEL]: 'Iron Shovel',
  [STICKS]: 'Sticks',
  [WOOD_PICKAXE]: 'Wooden Pickaxe',
  [WOOD_SHOVEL]: 'Wooden Shovel',
  [STONE_PICKAXE]: 'Stone Pickaxe',
  [STONE_SHOVEL]: 'Stone Shovel',
  [WOOD_AXE]: 'Wooden Axe',
  [STONE_AXE]: 'Stone Axe',
  [IRON_AXE]: 'Iron Axe',
  [WOOD_SWORD]: 'Wooden Sword',
  [STONE_SWORD]: 'Stone Sword',
  [IRON_SWORD]: 'Iron Sword',
  [COAL]: 'Coal',
  [RAW_IRON]: 'Raw Iron',
  [IRON_INGOT]: 'Iron Ingot',
  [DIAMOND]: 'Diamond',
  [DIAMOND_PICKAXE]: 'Diamond Pickaxe',
  [DIAMOND_SHOVEL]: 'Diamond Shovel',
  [DIAMOND_AXE]: 'Diamond Axe',
  [DIAMOND_SWORD]: 'Diamond Sword',
  [RAW_GOLD]: 'Raw Gold',
  [GOLD_INGOT]: 'Gold Ingot',
  [REDSTONE]: 'Redstone Dust',
  [GUNPOWDER]: 'Gunpowder',
  [ROTTEN_FLESH]: 'Rotten Flesh',
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
 * `fluidAim` below and `raycastVoxel` — because a bucket has to be able to aim
 * at the sea, which a solid-only ray goes straight through.
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
      // Either the ray stopped on flowing water (it does not, with a
      // source-seeking aim, but the rule holds however it got here) or it went
      // *through* some on its way to whatever it did hit. Both are the same
      // disappointment and deserve the same sentence: there was water, and
      // none of it was yours to take.
      return isWater(at) || hit.throughWater
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

/**
 * What water should do to this item's aiming ray — the `fluids` mode for
 * `raycastVoxel`, and false for anything that aims at blocks.
 *
 * The two buckets want different things and it took using one to notice.
 * A full bucket is looking for somewhere to put water, and the shallow flowing
 * edge of a pond is somewhere: it stops at any water. An empty one is looking
 * for water it can actually take, which is only ever a source — so flowing
 * water is transparent to it, and a stream running over the sea, or a
 * waterfall in front of a pool, no longer stands between the bucket and the
 * thing it is being pointed at.
 */
export function fluidAim(id) {
  if (id === BUCKET) return 'source';
  if (id === WATER_BUCKET) return true;
  return false;
}
