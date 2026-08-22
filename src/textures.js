// Block and item textures: the atlas, the icons, the water tiles, the
// destroy cracks and the HUD sprites.
//
// The previous version generated every block face as a noise field on a
// canvas — fast, and it looked fast. This version paints from hand-authored
// pixel maps (block-pixels.js) and hand-drawn item maps (item-sprites.js),
// because a texture is a picture of a thing and a picture is made of
// decisions, not distributions. The painting machinery is pixelart.js; this
// file is the catalogue: which map goes on which face of which id, how the
// atlas tiles are laid out, and how the icons are drawn.
//
// The layout the world depends on is unchanged: three tiles per definition
// — [side | top | bottom] — in ATLAS_DEFS order, with the water flow levels
// sharing the source's three tiles.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, clamp } from './utils.js';
import { WATER, isWater, CRAFTING_TABLE, FURNACE, GLASS, TNT } from './terrain.js';
import {
  BUCKET, WATER_BUCKET, PICKAXE, SHOVEL,
  STICKS, WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL, isItem,
  WOOD_AXE, STONE_AXE, IRON_AXE, DIAMOND_AXE,
  WOOD_SWORD, STONE_SWORD, IRON_SWORD, DIAMOND_SWORD,
  DIAMOND_PICKAXE, DIAMOND_SHOVEL,
  COAL, RAW_IRON, IRON_INGOT, DIAMOND, RAW_GOLD, GOLD_INGOT, REDSTONE,
  GUNPOWDER, ROTTEN_FLESH,
  RAW_BEEF, STEAK, RAW_PORKCHOP, COOKED_PORKCHOP,
  RAW_CHICKEN, COOKED_CHICKEN, RAW_MUTTON, COOKED_MUTTON,
  APPLE, BONE, ARROW, STRING, SPIDER_EYE, BOW, FEATHER,
  LEATHER, CARROT, POTATO, BAKED_POTATO, GOLDEN_APPLE,
  IRON_HELMET, IRON_CHESTPLATE, IRON_LEGGINGS, IRON_BOOTS,
  DIAMOND_HELMET, DIAMOND_CHESTPLATE, DIAMOND_LEGGINGS, DIAMOND_BOOTS,
  GOLD_HELMET, GOLD_CHESTPLATE, GOLD_LEGGINGS, GOLD_BOOTS,
  LEATHER_HELMET, LEATHER_CHESTPLATE, LEATHER_LEGGINGS, LEATHER_BOOTS,
} from './items.js';
import {
  HAFT, HEAD_WOOD, HEAD_STONE, HEAD_IRON, HEAD_DIAMOND, BUCKET_PALETTE,
  STICK_PX, PICKAXE_PX, SHOVEL_PX, AXE_PX, SWORD_PX,
  BUCKET_PX, WATER_BUCKET_PX,
  COAL_PX, RAW_IRON_PX, IRON_INGOT_PX, DIAMOND_PX,
  COAL_PALETTE, RAW_IRON_PALETTE, IRON_INGOT_PALETTE, DIAMOND_PALETTE,
  RAW_GOLD_PALETTE, GOLD_INGOT_PALETTE, REDSTONE_PALETTE, REDSTONE_PX,
  GUNPOWDER_PALETTE, GUNPOWDER_PX, ROTTEN_FLESH_PALETTE, ROTTEN_FLESH_PX,
  RAW_MEAT_PALETTE, COOKED_MEAT_PALETTE,
  CHICKEN_RAW_PALETTE, CHICKEN_COOKED_PALETTE, APPLE_PALETTE,
  STEAK_PX, PORKCHOP_PX, MUTTON_PX, CHICKEN_PX, APPLE_PX,
  BONE_PALETTE, BONE_PX, ARROW_PALETTE, ARROW_PX,
  STRING_PALETTE, STRING_PX, SPIDER_EYE_PALETTE, SPIDER_EYE_PX,
  BOW_PALETTE, BOW_PX, FEATHER_PALETTE, FEATHER_PX,
  ARMOUR_LEATHER, HELMET_PX, CHESTPLATE_PX, LEGGINGS_PX, BOOTS_PX,
  CARROT_PALETTE, CARROT_PX, LEATHER_PALETTE, LEATHER_PX,
  POTATO_PALETTE, BAKED_POTATO_PALETTE, POTATO_PX,
  GOLDEN_APPLE_PALETTE,
} from './item-sprites.js';
import {
  DIRT_PX, DIRT_PALETTE, GRASS_TOP_PX, GRASS_TOP_PALETTE,
  GRASS_SIDE_PX, GRASS_SIDE_PALETTE, STONE_PX, STONE_PALETTE,
  COBBLE_PX, COBBLE_PALETTE, PLANKS_PX, PLANKS_PALETTE,
  SAND_PX, SAND_PALETTE, BRICK_PX, BRICK_PALETTE,
  BEDROCK_PX, BEDROCK_PALETTE, SNOW_PX, SNOW_PALETTE,
  LOG_SIDE_PX, LOG_SIDE_PALETTE, LOG_TOP_PX, LOG_TOP_PALETTE,
  LEAVES_PX, LEAVES_PALETTE, DEEPSLATE_PX, DEEPSLATE_PALETTE,
  WATER_ICON_PX, WATER_ICON_PALETTE, ICE_PX, ICE_PALETTE,
  CRAFT_TOP_PX, CRAFT_TOP_PALETTE, CRAFT_SIDE_PX, CRAFT_SIDE_PALETTE,
  FURNACE_FRONT_PX, FURNACE_FRONT_PALETTE, FURNACE_SIDE_PX, FURNACE_SIDE_PALETTE,
  GLASS_PX, GLASS_PALETTE, TNT_SIDE_PX, TNT_SIDE_PALETTE, TNT_TOP_PX, TNT_TOP_PALETTE,
  ORE_PALETTES, LUMP_COAL_PX, LUMP_IRON_PX, LUMP_REDSTONE_PX, LUMP_DIAMOND_PX,
} from './block-pixels.js';
import {
  paintedCanvas, paintWithOutline, paintMap, resolveMap, stamp, paintCells,
} from './pixelart.js';

// The item-sprites exports are part of this module's public surface too —
// the tests and the old callers import them from here.
export {
  HAFT, HEAD_WOOD, HEAD_STONE, HEAD_IRON, HEAD_DIAMOND, BUCKET_PALETTE,
  STICK_PX, PICKAXE_PX, SHOVEL_PX, AXE_PX, SWORD_PX,
  BUCKET_PX, WATER_BUCKET_PX,
};

export const TEX_SIZE = 16;

// --------------------------------------------------------------- face recipes
//
// Every face is a function `(rand) => canvas`, where `rand` is the block's
// seeded RNG — same convention as before, so BLOCK_DEFS stays data and the
// painter stays dumb. The wobble seed is drawn from `rand` so each block of
// a kind paints an identical tile every load and every test.

const seedOf = (rand) => Math.floor(rand() * 0x7fffffff) || 1;

/** A face painted straight from a map. */
const mapFace = (rows, palette, wobble = 0.05) => (rand) =>
  paintedCanvas(TEX_SIZE, rows, palette, { seed: seedOf(rand), wobble });

/** A face with a darker tint applied to the whole map (furnace side, say). */
const tintFace = (rows, palette, tint, wobble = 0.05) => (rand) =>
  paintedCanvas(TEX_SIZE, rows, palette, { seed: seedOf(rand), wobble, tint });

/**
 * An ore face: the base rock painted from its map, then `count` lumps of
 * the mineral stamped onto it at seeded positions. The lumps are the
 * hand-drawn stamps from block-pixels.js, so a diamond lump is a diamond
 * whether it sits in stone or in deepslate.
 */
function oreFace(baseRows, basePalette, lumpRows, lumpPalette, count) {
  return (rand) => {
    let cells = resolveMap(baseRows, basePalette);
    const lump = resolveMap(lumpRows, lumpPalette);
    const lw = lumpRows[0].length;
    const lh = lumpRows.length;
    for (let i = 0; i < count; i++) {
      const x = 1 + Math.floor(rand() * (TEX_SIZE - lw - 1));
      const y = 1 + Math.floor(rand() * (TEX_SIZE - lh - 1));
      cells = stamp(cells, TEX_SIZE, TEX_SIZE, lump, lw, lh, x, y);
    }
    const cv = document.createElement('canvas');
    cv.width = cv.height = TEX_SIZE;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    paintCells(ctx, cells, TEX_SIZE, 0, 0, 1, seedOf(rand), 0.05);
    return cv;
  };
}

// The five minerals, on each of the two rocks.
const coalLump = (deep) => oreFace(
  deep ? DEEPSLATE_PX : STONE_PX,
  deep ? DEEPSLATE_PALETTE : STONE_PALETTE,
  LUMP_COAL_PX, deep ? ORE_PALETTES.coalDeep : ORE_PALETTES.coal, 5);
const ironLump = (deep) => oreFace(
  deep ? DEEPSLATE_PX : STONE_PX,
  deep ? DEEPSLATE_PALETTE : STONE_PALETTE,
  LUMP_IRON_PX, ORE_PALETTES.iron, 4);
const goldLump = (deep) => oreFace(
  deep ? DEEPSLATE_PX : STONE_PX,
  deep ? DEEPSLATE_PALETTE : STONE_PALETTE,
  LUMP_IRON_PX, ORE_PALETTES.gold, 4);
const redstoneLump = (deep) => oreFace(
  deep ? DEEPSLATE_PX : STONE_PX,
  deep ? DEEPSLATE_PALETTE : STONE_PALETTE,
  LUMP_REDSTONE_PX, ORE_PALETTES.redstone, 4);
const diamondLump = (deep) => oreFace(
  deep ? DEEPSLATE_PX : STONE_PX,
  deep ? DEEPSLATE_PALETTE : STONE_PALETTE,
  LUMP_DIAMOND_PX, ORE_PALETTES.diamond, 3);

// ------------------------------------------------------------------- blocks

/** Each entry: { id, name, side, top, bottom } — faces are (rand) => canvas. */
export const BLOCK_DEFS = [
  { id: 1, name: 'Grass Block', side: mapFace(GRASS_SIDE_PX, GRASS_SIDE_PALETTE), top: mapFace(GRASS_TOP_PX, GRASS_TOP_PALETTE), bottom: mapFace(DIRT_PX, DIRT_PALETTE) },
  { id: 2, name: 'Dirt', side: mapFace(DIRT_PX, DIRT_PALETTE), top: mapFace(DIRT_PX, DIRT_PALETTE), bottom: mapFace(DIRT_PX, DIRT_PALETTE) },
  { id: 3, name: 'Stone', side: mapFace(STONE_PX, STONE_PALETTE), top: mapFace(STONE_PX, STONE_PALETTE), bottom: mapFace(STONE_PX, STONE_PALETTE) },
  { id: 4, name: 'Cobblestone', side: mapFace(COBBLE_PX, COBBLE_PALETTE), top: mapFace(COBBLE_PX, COBBLE_PALETTE), bottom: mapFace(COBBLE_PX, COBBLE_PALETTE) },
  { id: 5, name: 'Oak Planks', side: mapFace(PLANKS_PX, PLANKS_PALETTE), top: mapFace(PLANKS_PX, PLANKS_PALETTE), bottom: mapFace(PLANKS_PX, PLANKS_PALETTE) },
  { id: 6, name: 'Sand', side: mapFace(SAND_PX, SAND_PALETTE), top: mapFace(SAND_PX, SAND_PALETTE), bottom: mapFace(SAND_PX, SAND_PALETTE) },
  { id: 7, name: 'Bricks', side: mapFace(BRICK_PX, BRICK_PALETTE), top: mapFace(BRICK_PX, BRICK_PALETTE), bottom: mapFace(BRICK_PX, BRICK_PALETTE) },
  { id: 8, name: 'Bedrock', side: mapFace(BEDROCK_PX, BEDROCK_PALETTE), top: mapFace(BEDROCK_PX, BEDROCK_PALETTE), bottom: mapFace(BEDROCK_PX, BEDROCK_PALETTE) },
  { id: 9, name: 'Snow Block', side: mapFace(SNOW_PX, SNOW_PALETTE), top: mapFace(SNOW_PX, SNOW_PALETTE), bottom: mapFace(SNOW_PX, SNOW_PALETTE) },
  { id: 10, name: 'Oak Log', side: mapFace(LOG_SIDE_PX, LOG_SIDE_PALETTE), top: mapFace(LOG_TOP_PX, LOG_TOP_PALETTE), bottom: mapFace(LOG_TOP_PX, LOG_TOP_PALETTE) },
  { id: 11, name: 'Leaves', side: mapFace(LEAVES_PX, LEAVES_PALETTE), top: mapFace(LEAVES_PX, LEAVES_PALETTE), bottom: mapFace(LEAVES_PX, LEAVES_PALETTE) },
  { id: 12, name: 'Deepslate', side: mapFace(DEEPSLATE_PX, DEEPSLATE_PALETTE), top: mapFace(DEEPSLATE_PX, DEEPSLATE_PALETTE), bottom: mapFace(DEEPSLATE_PX, DEEPSLATE_PALETTE) },
  { id: 13, name: 'Water', side: mapFace(WATER_ICON_PX, WATER_ICON_PALETTE), top: mapFace(WATER_ICON_PX, WATER_ICON_PALETTE), bottom: mapFace(WATER_ICON_PX, WATER_ICON_PALETTE) },
  // 14..21 are the flowing water levels, which share the source's tile.
  { id: 22, name: 'Ice', side: mapFace(ICE_PX, ICE_PALETTE), top: mapFace(ICE_PX, ICE_PALETTE), bottom: mapFace(ICE_PX, ICE_PALETTE) },
  { id: 23, name: 'Coal Ore', side: coalLump(false), top: coalLump(false), bottom: coalLump(false) },
  { id: 24, name: 'Iron Ore', side: ironLump(false), top: ironLump(false), bottom: ironLump(false) },
  { id: 25, name: 'Gold Ore', side: goldLump(false), top: goldLump(false), bottom: goldLump(false) },
  { id: 26, name: 'Redstone Ore', side: redstoneLump(false), top: redstoneLump(false), bottom: redstoneLump(false) },
  { id: 27, name: 'Diamond Ore', side: diamondLump(false), top: diamondLump(false), bottom: diamondLump(false) },
  { id: 28, name: 'Deepslate Coal Ore', side: coalLump(true), top: coalLump(true), bottom: coalLump(true) },
  { id: 29, name: 'Deepslate Iron Ore', side: ironLump(true), top: ironLump(true), bottom: ironLump(true) },
  { id: 30, name: 'Deepslate Gold Ore', side: goldLump(true), top: goldLump(true), bottom: goldLump(true) },
  { id: 31, name: 'Deepslate Redstone Ore', side: redstoneLump(true), top: redstoneLump(true), bottom: redstoneLump(true) },
  { id: 32, name: 'Deepslate Diamond Ore', side: diamondLump(true), top: diamondLump(true), bottom: diamondLump(true) },
  // Crafting-era blocks: player-placed only, ids 33+ (see blocks-extra.js).
  { id: CRAFTING_TABLE, name: 'Crafting Table', side: mapFace(CRAFT_SIDE_PX, CRAFT_SIDE_PALETTE), top: mapFace(CRAFT_TOP_PX, CRAFT_TOP_PALETTE), bottom: mapFace(PLANKS_PX, PLANKS_PALETTE) },
  { id: FURNACE, name: 'Furnace', side: mapFace(FURNACE_FRONT_PX, FURNACE_FRONT_PALETTE), top: mapFace(FURNACE_SIDE_PX, FURNACE_SIDE_PALETTE), bottom: mapFace(FURNACE_SIDE_PX, FURNACE_SIDE_PALETTE) },
  { id: GLASS, name: 'Glass', side: mapFace(GLASS_PX, GLASS_PALETTE), top: mapFace(GLASS_PX, GLASS_PALETTE), bottom: mapFace(GLASS_PX, GLASS_PALETTE) },
  { id: TNT, name: 'TNT', side: mapFace(TNT_SIDE_PX, TNT_SIDE_PALETTE), top: mapFace(TNT_TOP_PX, TNT_TOP_PALETTE), bottom: mapFace(TNT_TOP_PX, TNT_TOP_PALETTE) },
];

// -------------------------------------------------------------------- items

/**
 * An item face: the sprite painted with its one-texel outline rim, which is
 * what separates an icon from the world behind it at any scale. All six
 * faces of an item def are the same sprite — a flat thing has no sides.
 */
const spriteFace = (rows, palette) => (rand) => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  paintWithOutline(ctx, rows, palette, { seed: seedOf(rand), wobble: 0.03 });
  return cv;
};

/**
 * One item def, as a single-element array so it can be spread into the list.
 * The three faces are the same sprite — the same reason the original nine
 * entries repeat their face function three times, done here rather than at
 * every call site so a top face cannot end up holding a different picture
 * from its side.
 */
const itemDef = (id, name, rows, palette) => {
  const face = spriteFace(rows, palette);
  return [{ id, name, item: true, side: face, top: face, bottom: face }];
};

/** Tools: same shape map, tier palette. */
const toolDef = (id, name, rows, tier) => {
  const face = (rand) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = TEX_SIZE;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    paintWithOutline(ctx, rows, { ...HAFT, ...tier }, { seed: seedOf(rand), wobble: 0.03 });
    return cv;
  };
  return [{ id, name, item: true, side: face, top: face, bottom: face }];
};

export const ITEM_DEFS = [
  ...toolDef(PICKAXE, 'Iron Pickaxe', PICKAXE_PX, HEAD_IRON),
  ...toolDef(SHOVEL, 'Iron Shovel', SHOVEL_PX, HEAD_IRON),
  ...toolDef(STICKS, 'Sticks', STICK_PX, HAFT),
  ...toolDef(WOOD_PICKAXE, 'Wooden Pickaxe', PICKAXE_PX, HEAD_WOOD),
  ...toolDef(WOOD_SHOVEL, 'Wooden Shovel', SHOVEL_PX, HEAD_WOOD),
  ...toolDef(STONE_PICKAXE, 'Stone Pickaxe', PICKAXE_PX, HEAD_STONE),
  ...toolDef(STONE_SHOVEL, 'Stone Shovel', SHOVEL_PX, HEAD_STONE),
  // Axes: the answer to everything the forest is made of.
  ...toolDef(WOOD_AXE, 'Wooden Axe', AXE_PX, HEAD_WOOD),
  ...toolDef(STONE_AXE, 'Stone Axe', AXE_PX, HEAD_STONE),
  ...toolDef(IRON_AXE, 'Iron Axe', AXE_PX, HEAD_IRON),
  ...toolDef(DIAMOND_AXE, 'Diamond Axe', AXE_PX, HEAD_DIAMOND),
  // Swords: not a digging tool, except against leaves.
  ...toolDef(WOOD_SWORD, 'Wooden Sword', SWORD_PX, HEAD_WOOD),
  ...toolDef(STONE_SWORD, 'Stone Sword', SWORD_PX, HEAD_STONE),
  ...toolDef(IRON_SWORD, 'Iron Sword', SWORD_PX, HEAD_IRON),
  ...toolDef(DIAMOND_SWORD, 'Diamond Sword', SWORD_PX, HEAD_DIAMOND),
  // The diamond tier of the two original shapes.
  ...toolDef(DIAMOND_PICKAXE, 'Diamond Pickaxe', PICKAXE_PX, HEAD_DIAMOND),
  ...toolDef(DIAMOND_SHOVEL, 'Diamond Shovel', SHOVEL_PX, HEAD_DIAMOND),
  // Containers.
  ...itemDef(BUCKET, 'Bucket', BUCKET_PX, BUCKET_PALETTE),
  ...itemDef(WATER_BUCKET, 'Water Bucket', WATER_BUCKET_PX, BUCKET_PALETTE),
  // What the mine pays you in.
  ...itemDef(COAL, 'Coal', COAL_PX, COAL_PALETTE),
  ...itemDef(RAW_IRON, 'Raw Iron', RAW_IRON_PX, RAW_IRON_PALETTE),
  ...itemDef(IRON_INGOT, 'Iron Ingot', IRON_INGOT_PX, IRON_INGOT_PALETTE),
  ...itemDef(DIAMOND, 'Diamond', DIAMOND_PX, DIAMOND_PALETTE),
  ...itemDef(RAW_GOLD, 'Raw Gold', RAW_IRON_PX, RAW_GOLD_PALETTE),
  ...itemDef(GOLD_INGOT, 'Gold Ingot', IRON_INGOT_PX, GOLD_INGOT_PALETTE),
  ...itemDef(REDSTONE, 'Redstone Dust', REDSTONE_PX, REDSTONE_PALETTE),
  // What the night pays: a creeper's grey dust and a zombie's slab of
  // not-quite-meat. See mobs.js for where they come from.
  ...itemDef(GUNPOWDER, 'Gunpowder', GUNPOWDER_PX, GUNPOWDER_PALETTE),
  ...itemDef(ROTTEN_FLESH, 'Rotten Flesh', ROTTEN_FLESH_PX, ROTTEN_FLESH_PALETTE),
  // Food. Beef and mutton are one slab with a raw or a cooked palette;
  // porkchop has its own cut. Chicken is its own drumstick. The apple is
  // the one food the trees hand over.
  ...itemDef(RAW_BEEF, 'Raw Beef', STEAK_PX, RAW_MEAT_PALETTE),
  ...itemDef(STEAK, 'Steak', STEAK_PX, COOKED_MEAT_PALETTE),
  ...itemDef(RAW_PORKCHOP, 'Raw Porkchop', PORKCHOP_PX, RAW_MEAT_PALETTE),
  ...itemDef(COOKED_PORKCHOP, 'Cooked Porkchop', PORKCHOP_PX, COOKED_MEAT_PALETTE),
  ...itemDef(RAW_CHICKEN, 'Raw Chicken', CHICKEN_PX, CHICKEN_RAW_PALETTE),
  ...itemDef(COOKED_CHICKEN, 'Cooked Chicken', CHICKEN_PX, CHICKEN_COOKED_PALETTE),
  ...itemDef(RAW_MUTTON, 'Raw Mutton', MUTTON_PX, RAW_MEAT_PALETTE),
  ...itemDef(COOKED_MUTTON, 'Cooked Mutton', MUTTON_PX, COOKED_MEAT_PALETTE),
  ...itemDef(APPLE, 'Apple', APPLE_PX, APPLE_PALETTE),
  ...itemDef(GOLDEN_APPLE, 'Golden Apple', APPLE_PX, GOLDEN_APPLE_PALETTE),
  // Ranged combat: the skeleton's, the spider's, and the ones you build.
  ...itemDef(BONE, 'Bone', BONE_PX, BONE_PALETTE),
  ...itemDef(ARROW, 'Arrow', ARROW_PX, ARROW_PALETTE),
  ...itemDef(STRING, 'String', STRING_PX, STRING_PALETTE),
  ...itemDef(SPIDER_EYE, 'Spider Eye', SPIDER_EYE_PX, SPIDER_EYE_PALETTE),
  ...itemDef(BOW, 'Bow', BOW_PX, BOW_PALETTE),
  ...itemDef(FEATHER, 'Feather', FEATHER_PX, FEATHER_PALETTE),
  // The last few foods and the one hide.
  ...itemDef(LEATHER, 'Leather', LEATHER_PX, LEATHER_PALETTE),
  ...itemDef(CARROT, 'Carrot', CARROT_PX, CARROT_PALETTE),
  ...itemDef(POTATO, 'Potato', POTATO_PX, POTATO_PALETTE),
  ...itemDef(BAKED_POTATO, 'Baked Potato', POTATO_PX, BAKED_POTATO_PALETTE),
  // Armour, four shapes across four materials: leather is brown, iron and
  // gold and diamond borrow the tool palettes so a helmet's tier matches
  // the pickaxe of the same tier on the hotbar.
  ...itemDef(LEATHER_HELMET, 'Leather Cap', HELMET_PX, ARMOUR_LEATHER),
  ...itemDef(LEATHER_CHESTPLATE, 'Leather Tunic', CHESTPLATE_PX, ARMOUR_LEATHER),
  ...itemDef(LEATHER_LEGGINGS, 'Leather Pants', LEGGINGS_PX, ARMOUR_LEATHER),
  ...itemDef(LEATHER_BOOTS, 'Leather Boots', BOOTS_PX, ARMOUR_LEATHER),
  ...itemDef(IRON_HELMET, 'Iron Helmet', HELMET_PX, HEAD_IRON),
  ...itemDef(IRON_CHESTPLATE, 'Iron Chestplate', CHESTPLATE_PX, HEAD_IRON),
  ...itemDef(IRON_LEGGINGS, 'Iron Leggings', LEGGINGS_PX, HEAD_IRON),
  ...itemDef(IRON_BOOTS, 'Iron Boots', BOOTS_PX, HEAD_IRON),
  ...itemDef(GOLD_HELMET, 'Golden Helmet', HELMET_PX, GOLD_INGOT_PALETTE),
  ...itemDef(GOLD_CHESTPLATE, 'Golden Chestplate', CHESTPLATE_PX, GOLD_INGOT_PALETTE),
  ...itemDef(GOLD_LEGGINGS, 'Golden Leggings', LEGGINGS_PX, GOLD_INGOT_PALETTE),
  ...itemDef(GOLD_BOOTS, 'Golden Boots', BOOTS_PX, GOLD_INGOT_PALETTE),
  ...itemDef(DIAMOND_HELMET, 'Diamond Helmet', HELMET_PX, DIAMOND_PALETTE),
  ...itemDef(DIAMOND_CHESTPLATE, 'Diamond Chestplate', CHESTPLATE_PX, DIAMOND_PALETTE),
  ...itemDef(DIAMOND_LEGGINGS, 'Diamond Leggings', LEGGINGS_PX, DIAMOND_PALETTE),
  ...itemDef(DIAMOND_BOOTS, 'Diamond Boots', BOOTS_PX, DIAMOND_PALETTE),
];

/** Everything with a texture in the atlas: blocks first, then items. */
export const ATLAS_DEFS = [...BLOCK_DEFS, ...ITEM_DEFS];

/**
 * What you start with. Nine slots and more than nine things worth having,
 * so the list is a series of arguments about what earns one: the two tools
 * take theirs by force (without a pickaxe stone is seven and a half seconds
 * a block), and the bricks wait until there is somewhere to put them.
 */
export const STARTER_BLOCKS = [1, 2, 3, 5, 9, PICKAXE, SHOVEL, IRON_AXE, BUCKET];

/**
 * Build a 48x16 atlas canvas for a block: [side | top | bottom].
 * Also returns the individual faces (for inventory icons).
 */
function buildAtlas(block) {
  const rand = mulberry32(block.id * 7919 + 13);
  const side = block.side(rand);
  const top = block.top(rand);
  const bottom = block.bottom(rand);
  const cv = document.createElement('canvas');
  cv.width = TEX_SIZE * 3;
  cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.drawImage(side, 0, 0);
  ctx.drawImage(top, TEX_SIZE, 0);
  ctx.drawImage(bottom, TEX_SIZE * 2, 0);
  return { atlas: cv, side, top };
}

// ------------------------------------------------------------- inventory icons
//
// Minecraft draws block icons as an isometric cube: the top face as a
// rhombus with the two lit/shaded side faces below it. Each face is an
// affine transform mapping the 16x16 texture onto its parallelogram. Items
// are the sprite itself, scaled up — a bucket drawn as a cube would be a
// box with a picture of a bucket on three of its faces.

const ICON_SCALE = 3; // canvas pixels per texel -> 96x96 icon

function drawIconFace(ctx, img, m, shadeAmt) {
  const S = TEX_SIZE;
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.imageSmoothingEnabled = false;
  // Slight overdraw hides the hairline seams between the three faces.
  ctx.drawImage(img, 0, 0, S, S, -0.03, -0.03, S + 0.06, S + 0.06);
  ctx.restore();
  if (!shadeAmt) return;
  const pt = (u, v) => [m.a * u + m.c * v + m.e, m.b * u + m.d * v + m.f];
  const corners = [pt(0, 0), pt(S, 0), pt(S, S), pt(0, S)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${shadeAmt})`;
  ctx.fill();
  ctx.restore();
}

/** An item icon: the sprite, scaled up, with its outline already in it. */
function buildFlatIcon(face) {
  const q = TEX_SIZE * ICON_SCALE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = q * 2;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Inset a little so the sprite has the same visual weight as the cubes it
  // sits beside in the hotbar, which fill their tile corner to corner.
  const pad = q * 0.18;
  ctx.drawImage(face, pad, pad, q * 2 - pad * 2, q * 2 - pad * 2);
  return cv;
}

function buildIcon(side, top) {
  const q = TEX_SIZE * ICON_SCALE; // half-width of the cube (48)
  const cv = document.createElement('canvas');
  cv.width = q * 2;
  cv.height = q * 2;
  const ctx = cv.getContext('2d');
  const h = q / 2; // vertical drop of the isometric edges
  const k = ICON_SCALE; // texel -> canvas px along a face edge
  // top rhombus: (0,h) (q,0) (2q,h) (q,2h)
  drawIconFace(ctx, top, { a: k, b: -k / 2, c: k, d: k / 2, e: 0, f: h }, 0);
  // left face, darker: it is the side away from the light
  drawIconFace(ctx, side, { a: k, b: k / 2, c: 0, d: k, e: 0, f: h }, 0.30);
  // right face
  drawIconFace(ctx, side, { a: k, b: -k / 2, c: 0, d: k, e: q, f: 2 * h }, 0.14);
  return cv;
}

// -------------------------------------------------------------- world atlas
//
// Every block face lives in one texture so a whole chunk draws in a single
// call. Tile order is [side, top, bottom] per block, in BLOCK_DEFS order.
//
// Mipmaps are built by hand rather than by the GPU: an automatically
// generated mip level averages across tile boundaries, so at distance a
// stone block bleeds into its neighbour in the atlas. Downsampling each
// tile on its own and packing the results keeps every level clean.

export const ATLAS_TILES = ATLAS_DEFS.length * 3;

/** Tile index for a block id and face column (0 side, 1 top, 2 bottom). */
export function atlasTile(blockId, column) {
  // Every water level shares the source's tiles: eight ids, one appearance.
  const id = isWater(blockId) ? WATER : blockId;
  const i = ATLAS_DEFS.findIndex((b) => b.id === id);
  return (i < 0 ? 0 : i) * 3 + column;
}

function tileCanvases() {
  const tiles = [];
  for (const block of ATLAS_DEFS) {
    const rand = mulberry32(block.id * 7919 + 13);
    tiles.push(block.side(rand), block.top(rand), block.bottom(rand));
  }
  return tiles;
}

/**
 * Draw every tile side by side at `tileSize` pixels each.
 * The strip is written upside down because the texture is uploaded with
 * flipY off (DataTexture), and the face UVs put v = 1 at the top of a block.
 */
function packLevel(tiles, tileSize) {
  const cv = document.createElement('canvas');
  cv.width = tileSize * tiles.length;
  cv.height = tileSize;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = tileSize < TEX_SIZE; // box-filter when shrinking
  ctx.translate(0, tileSize);
  ctx.scale(1, -1);
  tiles.forEach((tile, i) => {
    ctx.drawImage(tile, 0, 0, TEX_SIZE, TEX_SIZE, i * tileSize, 0, tileSize, tileSize);
  });
  return ctx.getImageData(0, 0, cv.width, cv.height);
}

let atlasTexture = null;

/** The shared world texture: one tile strip with hand-built mipmaps. */
export function getAtlasTexture() {
  if (atlasTexture) return atlasTexture;
  const tiles = tileCanvases();

  const levels = [];
  for (let size = TEX_SIZE; size >= 1; size = size >> 1) {
    levels.push(packLevel(tiles, size));
  }

  const tex = new THREE.DataTexture(
    levels[0].data, levels[0].width, levels[0].height, THREE.RGBAFormat
  );
  tex.mipmaps = levels.map((img) => ({ data: img.data, width: img.width, height: img.height }));
  tex.generateMipmaps = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  atlasTexture = tex;
  return tex;
}

// ------------------------------------------------------------------- water
//
// Water gets its own two textures rather than a slot in the world atlas,
// for one reason: it moves. An atlas cannot scroll — shifting it would drag
// every other block's texture along with the water — but a texture of its
// own can be offset a little further every frame. They hold no colour, only
// light and shade around a mid grey: the colour of water depends on depth
// and view, so the shader works it out and these supply the hand-drawn
// pattern moving across the top of it.

/** Sum of sine harmonics, evaluated on a tile that wraps in both axes. */
function harmonics(x, y, terms) {
  let v = 0;
  for (const [kx, ky, phase, amp] of terms) {
    v += Math.sin(((kx * x + ky * y) / TEX_SIZE) * Math.PI * 2 + phase) * amp;
  }
  return v;
}

/** A grey tile: 128 is "no change", and the harmonics swing either side. */
function waterCanvas(terms) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const v = clamp(Math.round(128 + harmonics(x, y, terms) * 127), 0, 255);
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Calm water: broad, slow swells crossing each other. */
function stillWaterCanvas() {
  return waterCanvas([
    [1, 1, 0.0, 0.50],
    [2, -1, 1.7, 0.30],
    [1, -3, 4.1, 0.20],
    [3, 2, 2.4, 0.15],
  ]);
}

/** Moving water: streaks that run down the tile, the direction of travel. */
function flowingWaterCanvas() {
  return waterCanvas([
    [4, 0, 0.0, 0.55],
    [7, 0, 2.2, 0.25],
    [2, 0, 4.4, 0.30],
    [3, 1, 1.1, 0.18],
    [5, 2, 3.3, 0.12],
  ]);
}

let waterTextures = null;

/** The two world-water patterns, { still, flowing }. */
export function getWaterTextures() {
  if (waterTextures) return waterTextures;
  const make = (canvas) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  waterTextures = {
    still: make(stillWaterCanvas()),
    flowing: make(flowingWaterCanvas()),
  };
  return waterTextures;
}

// ----------------------------------------------------------------- breaking

const CRACK_STAGES = 10;

/** The whole crack, cell by cell, in the order it spreads — grown once. */
function crackCells() {
  const rand = mulberry32(4523);
  const cells = [];
  const seen = new Set();
  const mid = TEX_SIZE / 2;
  const key = (x, y) => y * TEX_SIZE + x;

  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= TEX_SIZE || y >= TEX_SIZE) return false;
    const k = key(x, y);
    if (!seen.has(k)) {
      seen.add(k);
      cells.push([x, y]);
    }
    return true;
  };

  // Eight arms out of the middle, stepping one cell at a time and
  // wandering, with the occasional fork — a web, not a starburst.
  const queue = [];
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rand() * 0.6;
    const r = 0.5 + rand() * 2.5;
    queue.push({ x: mid + Math.cos(a) * r, y: mid + Math.sin(a) * r, a, life: 14 });
  }

  while (queue.length) {
    const b = queue.shift();
    if (b.life <= 0) continue;
    b.a += (rand() - 0.5) * 1.1;
    // ...and then pulled a third of the way back toward straight-out, so a
    // wandering arm does not curl round on itself.
    const ox = b.x - mid;
    const oy = b.y - mid;
    if (ox || oy) {
      const outward = Math.atan2(oy, ox);
      b.a += (((outward - b.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.34;
    }
    const dx = Math.cos(b.a);
    const dy = Math.sin(b.a);
    const step = Math.abs(dx) > Math.abs(dy)
      ? [Math.sign(dx), rand() < 0.42 ? Math.sign(dy) : 0]
      : [rand() < 0.42 ? Math.sign(dx) : 0, Math.sign(dy)];
    b.x += step[0];
    b.y += step[1];
    if (!put(Math.round(b.x), Math.round(b.y))) continue;
    b.life--;
    if (b.life > 3 && rand() < 0.3) {
      queue.push({ x: b.x, y: b.y, a: b.a + (rand() < 0.5 ? 1.3 : -1.3), life: b.life - 3 });
    }
    queue.push(b);
  }
  return { cells, seen, key };
}

let crackAll = null;

function crackCanvas(stage) {
  if (!crackAll) crackAll = crackCells();
  const { cells, seen, key } = crackAll;
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const shown = Math.round(cells.length * (stage + 1) / CRACK_STAGES);

  const set = (x, y, v, a) => {
    if (x < 0 || y < 0 || x >= TEX_SIZE || y >= TEX_SIZE) return;
    const o = (y * TEX_SIZE + x) * 4;
    if (img.data[o + 3] >= a) return; // never lighten a cell already darkened
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    img.data[o + 3] = a;
  };

  // The lit side first, so a dark cell always wins a cell it shares; the
  // highlight is a chip of light here and there, not a second line.
  for (let i = 0; i < shown; i++) {
    const [x, y] = cells[i];
    if ((i * 2654435761) % 5 < 2 && !seen.has(key(x + 1, y + 1))) set(x + 1, y + 1, 232, 128);
  }
  for (let i = 0; i < shown; i++) set(cells[i][0], cells[i][1], 0, 205);
  ctx.putImageData(img, 0, 0);
  return cv;
}

let crackUrls = null;

/** The crack stages as data URLs, cheapest to newest — built once. */
export function getCrackStages() {
  if (!crackUrls) {
    crackUrls = [];
    for (let i = 0; i < CRACK_STAGES; i++) crackUrls.push(crackCanvas(i).toDataURL());
  }
  return crackUrls;
}

/** Which stage a fraction of the way through breaking looks like. */
export function crackStage(progress) {
  return Math.min(CRACK_STAGES - 1, Math.max(0, Math.floor(progress * CRACK_STAGES)));
}

// ------------------------------------------------------------- HUD sprites
//
// Hearts, bubbles, drumsticks and armour pips, drawn the same way as
// everything else: a 9×9 map, a palette, one pixel at a time. The shapes
// are Minecraft's own — a heart is two arcs and a point, and at nine pixels
// each of those is two or three cells you either fill or do not. The palettes
// do the new part: three reds so a heart has a lit top and a shaded bottom
// instead of reading as a flat red sticker.

/**
 * A full heart. 1 = bright red, 4 = shaded red (the lower half), 3 = the
 * white glint that makes it read as polished rather than painted, 2 = the
 * near-black outline that keeps it visible on snow and sky alike.
 */
const HEART_PIXELS = [
  '022002200',
  '211311120',
  '211111112',
  '211111112',
  '211111112',
  '021141120',
  '002144200',
  '000212000',
  '000020000',
];

/** A bubble: a ring with a highlight where the light gets in. */
const BUBBLE_PIXELS = [
  '000222000',
  '002133200',
  '021333320',
  '213333312',
  '213333312',
  '213333312',
  '021333320',
  '002333200',
  '000222000',
];

/**
 * A drumstick: meat up top with a glint on the upper-left, the two bone
 * nubs poking out the bottom — the shape that has meant "hunger" in every
 * Minecraft HUD ever drawn.
 */
const DRUMSTICK_PIXELS = [
  '..11111..',
  '.1222231.',
  '122332221',
  '122332221',
  '.1222221.',
  '..12221..',
  '..12221..',
  '..14441..',
  '...444...',
];

/**
 * An armour pip: a rounded chestplate silhouette with a shine on the
 * shoulder — one per point of defence, drawn above the hearts and only
 * while something is actually worn.
 */
const ARMOUR_PIXELS = [
  '..11111..',
  '.1322221.',
  '.1222221.',
  '112222211',
  '112222211',
  '112222211',
  '112222211',
  '112222211',
  '.1444441.',
];

/** Paint a 9x9 sprite map with a palette and hand back a data URL. */
function spriteUrl(rows, palette, scale = 4) {
  const size = rows.length;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size * scale;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const key = rows[y][x];
      const colour = palette[key];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return cv.toDataURL();
}

const hudCache = new Map();
const hudSprite = (name, rows, palette) => {
  if (!hudCache.has(name)) hudCache.set(name, spriteUrl(rows, palette));
  return hudCache.get(name);
};

/** A full heart, and the empty socket that shows where one used to be. */
export const heartUrl = () =>
  hudSprite('heart', HEART_PIXELS, { 1: '#f02820', 3: '#ffc8b8', 4: '#b0140c', 2: '#3a080a' });
export const heartEmptyUrl = () =>
  hudSprite('heart-empty', HEART_PIXELS, { 1: '#2e2e2e', 3: '#3c3c3c', 4: '#262626', 2: '#101010' });
/** Half a heart is the same sprite with its right half cut away — see hud.js. */
export const bubbleUrl = () =>
  hudSprite('bubble', BUBBLE_PIXELS, { 1: '#ffffff', 2: '#0b1c3a', 3: '#8fd2ff' });
/** A drumstick, and the empty socket that shows where one used to be. */
export const drumstickUrl = () =>
  hudSprite('drumstick', DRUMSTICK_PIXELS, {
    1: '#5c3410', 2: '#c88648', 3: '#e8b878', 4: '#e8e0d0',
  });
export const drumstickEmptyUrl = () =>
  hudSprite('drumstick-empty', DRUMSTICK_PIXELS, {
    1: '#101010', 2: '#2e2e2e', 3: '#3c3c3c', 4: '#262626',
  });
/** An armour pip, grey like the iron it usually is. */
export const armourUrl = () =>
  hudSprite('armour', ARMOUR_PIXELS, {
    1: '#4a545e', 2: '#a8b4c0', 3: '#e8f0f8', 4: '#6a7684',
  });
export const armourEmptyUrl = () =>
  hudSprite('armour-empty', ARMOUR_PIXELS, {
    1: '#101010', 2: '#2e2e2e', 3: '#3c3c3c', 4: '#262626',
  });

// ------------------------------------------------------------- block assets

const cache = new Map();

/**
 * Returns { texture: THREE.CanvasTexture (48x16 atlas), iconUrl } for a
 * block def. `iconUrl` is the isometric cube used by the hotbar and
 * inventory; items get the flat sprite.
 */
export function getBlockAssets(block) {
  if (cache.has(block.id)) return cache.get(block.id);
  const { atlas, side, top } = buildAtlas(block);
  const texture = new THREE.CanvasTexture(atlas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const iconUrl = (isItem(block.id) ? buildFlatIcon(side) : buildIcon(side, top)).toDataURL();
  const assets = { texture, iconUrl };
  cache.set(block.id, assets);
  return assets;
}

/** Look up a block definition by id (null for air / unknown ids). */
export function getBlockDefById(id) {
  return ATLAS_DEFS.find((b) => b.id === id) ?? null;
}

/** Display name for a block or item id. */
export function blockName(id) {
  return getBlockDefById(id)?.name ?? 'Air';
}

/**
 * A representative [r, g, b] tint (0..1) for a block id, for the block
 * break particles — the colour the chips fly out as.
 */
const TINT_BY_ID = {
  1: [0.42, 0.66, 0.22],   // grass side green
  2: [0.44, 0.29, 0.16],   // dirt
  3: [0.45, 0.45, 0.45],   // stone
  4: [0.49, 0.49, 0.49],   // cobblestone
  5: [0.66, 0.46, 0.24],   // oak planks
  6: [0.83, 0.78, 0.60],   // sand
  7: [0.49, 0.22, 0.12],   // bricks
  8: [0.17, 0.17, 0.17],   // bedrock
  9: [0.88, 0.92, 0.96],   // snow
  10: [0.36, 0.27, 0.15],  // oak log
  11: [0.20, 0.40, 0.13],  // leaves
  12: [0.16, 0.16, 0.19],  // deepslate
  22: [0.51, 0.69, 0.89],  // ice
  23: [0.33, 0.33, 0.36],  // coal ore
  24: [0.55, 0.49, 0.42],  // iron ore
  25: [0.62, 0.55, 0.35],  // gold ore
  26: [0.55, 0.40, 0.40],  // redstone ore
  27: [0.38, 0.62, 0.60],  // diamond ore
  28: [0.22, 0.22, 0.25],  // deepslate coal ore
  29: [0.38, 0.35, 0.33],  // deepslate iron ore
  30: [0.43, 0.38, 0.27],  // deepslate gold ore
  31: [0.35, 0.27, 0.27],  // deepslate redstone ore
  32: [0.27, 0.42, 0.41],  // deepslate diamond ore
  33: [0.66, 0.46, 0.24],  // crafting table
  34: [0.45, 0.45, 0.45],  // furnace
  35: [0.78, 0.90, 1.00],  // glass
  36: [0.69, 0.09, 0.06],  // tnt
};

/** The same thing for items: the mid tone of each sprite's palette. */
const ITEM_TINT = {
  [COAL]: [0.15, 0.15, 0.17],
  [RAW_IRON]: [0.63, 0.42, 0.24],
  [IRON_INGOT]: [0.69, 0.71, 0.74],
  [DIAMOND]: [0.18, 0.58, 0.67],
  [RAW_GOLD]: [0.84, 0.64, 0.13],
  [GOLD_INGOT]: [0.80, 0.67, 0.18],
  [REDSTONE]: [0.63, 0.08, 0.08],
  [BUCKET]: [0.51, 0.55, 0.59],
  [WATER_BUCKET]: [0.29, 0.53, 0.85],
  [STICKS]: [0.48, 0.30, 0.12],
  [RAW_BEEF]: [0.66, 0.16, 0.11],
  [STEAK]: [0.43, 0.26, 0.13],
  [RAW_PORKCHOP]: [0.69, 0.20, 0.13],
  [COOKED_PORKCHOP]: [0.47, 0.29, 0.15],
  [RAW_CHICKEN]: [0.69, 0.48, 0.39],
  [COOKED_CHICKEN]: [0.49, 0.34, 0.15],
  [RAW_MUTTON]: [0.60, 0.13, 0.09],
  [COOKED_MUTTON]: [0.40, 0.23, 0.11],
  [APPLE]: [0.69, 0.11, 0.11],
  [BONE]: [0.69, 0.64, 0.54],
  [ARROW]: [0.49, 0.49, 0.49],
  [STRING]: [0.75, 0.71, 0.59],
  [SPIDER_EYE]: [0.55, 0.44, 0.60],
  [BOW]: [0.54, 0.36, 0.16],
  [FEATHER]: [0.82, 0.80, 0.75],
  [LEATHER]: [0.55, 0.36, 0.15],
  [CARROT]: [0.69, 0.31, 0.06],
  [POTATO]: [0.61, 0.42, 0.20],
  [BAKED_POTATO]: [0.44, 0.33, 0.15],
  [GOLDEN_APPLE]: [0.85, 0.64, 0.13],
  [GUNPOWDER]: [0.25, 0.25, 0.27],
  [ROTTEN_FLESH]: [0.58, 0.13, 0.13],
  [IRON_HELMET]: [0.71, 0.77, 0.80],
  [IRON_CHESTPLATE]: [0.71, 0.77, 0.80],
  [IRON_LEGGINGS]: [0.71, 0.77, 0.80],
  [IRON_BOOTS]: [0.71, 0.77, 0.80],
  [DIAMOND_HELMET]: [0.18, 0.58, 0.67],
  [DIAMOND_CHESTPLATE]: [0.18, 0.58, 0.67],
  [DIAMOND_LEGGINGS]: [0.18, 0.58, 0.67],
  [DIAMOND_BOOTS]: [0.18, 0.58, 0.67],
  [GOLD_HELMET]: [0.80, 0.67, 0.18],
  [GOLD_CHESTPLATE]: [0.80, 0.67, 0.18],
  [GOLD_LEGGINGS]: [0.80, 0.67, 0.18],
  [GOLD_BOOTS]: [0.80, 0.67, 0.18],
  [LEATHER_HELMET]: [0.55, 0.36, 0.15],
  [LEATHER_CHESTPLATE]: [0.55, 0.36, 0.15],
  [LEATHER_LEGGINGS]: [0.55, 0.36, 0.15],
  [LEATHER_BOOTS]: [0.55, 0.36, 0.15],
};

export function blockTint(id) {
  return TINT_BY_ID[id] ?? ITEM_TINT[id] ?? [0.5, 0.5, 0.5];
}
