// How long a block takes to break, and what you get for it.
//
// Minecraft computes this per tick, not per block, and the arithmetic is
// worth having exactly rather than approximately:
//
//   speed  = the tool's mining speed, if it is the right tool, else 1
//   speed /= 5   if your head is under water
//   speed /= 5   if your feet are off the ground
//   damage = speed / hardness / (the block will drop ? 30 : 100)
//   ticks  = ceil(1 / damage)
//
// Three things in that are easy to get wrong, and I had two of them wrong:
//
// The 30-against-100 is not "right tool against wrong tool". It is *can you
// harvest this at all* — so a pickaxe swung at dirt is only missing the speed
// bonus and still takes the short constant, while a shovel swung at stone
// takes the long one because stone is a block that wants a pickaxe. Dirt by
// hand is three quarters of a second, not two and a half.
//
// The in-air and in-water penalties are a fifth each, and they multiply: mine
// while swimming and you are at a twenty-fifth speed. This is why Minecraft
// players stand on the floor to dig, and why treading water in front of a
// wall of stone is a bad plan.
//
// And it is quantised to ticks, which is why the wiki says an iron pickaxe
// takes 0.4 s on stone rather than 0.375 — 7.5 ticks is 8 ticks.
//
// Pure: a block id, a held item and where you are standing in, seconds and a
// drop out. No world, no THREE, no DOM.

import {
  BEDROCK, GRASS, DIRT, SAND, SNOW, LEAVES, LOG, STONE, DEEPSLATE, ICE,
  COBBLESTONE, PLANKS, BRICKS, CRAFTING_TABLE, FURNACE, GLASS, TNT,
  ORE_IDS, isWater, AIR,
} from './terrain.js';
import { PICKAXE, SHOVEL, WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL } from './items.js';

/** What a tool is *for*. A block wants one of these, or nothing in particular. */
export const HAND = 0;
export const PICK = 1;
export const SPADE = 2;

/** Minecraft's tick, in seconds. Every break time is a whole number of these. */
export const TICK = 0.05;

/**
 * Minecraft's hardnesses, and which tool each block answers to.
 *
 * `needsTool` is Minecraft's `requiresCorrectToolForDrops`: without the right
 * tool the block still breaks, five times slower, and gives nothing. Stone,
 * cobblestone, bricks, deepslate and every ore want a pickaxe; a snow block
 * wants a shovel; dirt, wood and leaves want nothing at all.
 */
const BLOCKS = {
  [GRASS]: { hardness: 0.6, tool: SPADE },
  [DIRT]: { hardness: 0.5, tool: SPADE },
  [SAND]: { hardness: 0.5, tool: SPADE },
  [SNOW]: { hardness: 0.2, tool: SPADE, needsTool: true },
  [LEAVES]: { hardness: 0.2, tool: HAND },
  [LOG]: { hardness: 2.0, tool: HAND },
  [PLANKS]: { hardness: 2.0, tool: HAND },
  [STONE]: { hardness: 1.5, tool: PICK, needsTool: true },
  [COBBLESTONE]: { hardness: 2.0, tool: PICK, needsTool: true },
  [BRICKS]: { hardness: 2.0, tool: PICK, needsTool: true },
  [DEEPSLATE]: { hardness: 3.0, tool: PICK, needsTool: true },
  [ICE]: { hardness: 0.5, tool: PICK },
  [CRAFTING_TABLE]: { hardness: 2.5, tool: HAND },
  [FURNACE]: { hardness: 3.5, tool: PICK, needsTool: true },
  [GLASS]: { hardness: 0.3, tool: HAND },
  [TNT]: { hardness: 0, tool: HAND },
};

/**
 * Every ore is deepslate's three seconds and wants a pickaxe, whichever rock
 * it is sitting in — what separates the five is where they are, not how hard
 * they are, which is why they share one entry rather than having ten.
 */
const ORE = { hardness: 3.0, tool: PICK, needsTool: true };
for (const id of ORE_IDS) BLOCKS[id] = ORE;

/** Anything not in the table: the built blocks, which are all stone-ish. */
const DEFAULT = { hardness: 1.5, tool: PICK, needsTool: false };

/**
 * What each tool is good at, and how fast. Minecraft's numbers, tier by
 * tier: wood 2, stone 4, iron 6, diamond 8. The starter kit hands out iron;
 * the crafting table makes wooden ones, which dig half as fast — enough to
 * be worth having if you are out of iron, and enough to send you back to
 * the iron when you remember it.
 */
const TOOLS = {
  [WOOD_PICKAXE]: { kind: PICK, speed: 2 },
  [WOOD_SHOVEL]: { kind: SPADE, speed: 2 },
  [STONE_PICKAXE]: { kind: PICK, speed: 4 },
  [STONE_SHOVEL]: { kind: SPADE, speed: 4 },
  [PICKAXE]: { kind: PICK, speed: 6 },
  [SHOVEL]: { kind: SPADE, speed: 6 },
};

/** The block's entry, or the default for anything built rather than dug. */
export function blockRule(id) {
  return BLOCKS[id] ?? DEFAULT;
}

/** Is this held item the tool this block answers to? */
export function toolMatches(id, held) {
  const tool = TOOLS[held];
  return Boolean(tool) && tool.kind === blockRule(id).tool;
}

/**
 * Will this break give you the block? Minecraft's `hasCorrectToolForDrops`,
 * and the thing the 30-against-100 actually keys off.
 */
export function canHarvest(id, held) {
  const rule = blockRule(id);
  return !rule.needsTool || toolMatches(id, held);
}

/**
 * How fast you are digging, before the block gets a say: the tool's speed,
 * quartered and quartered again by the two things Minecraft docks you for.
 *
 * @param {{onGround?: boolean, underwater?: boolean}} [where]
 *   `underwater` is head-under, not feet-wet — Minecraft's `isEyeInFluid`,
 *   the same test that decides whether you are drowning.
 */
export function destroySpeed(id, held, where = {}) {
  const { onGround = true, underwater = false } = where;
  let speed = toolMatches(id, held) ? TOOLS[held].speed : 1;
  if (underwater) speed /= 5;
  if (!onGround) speed /= 5;
  return speed;
}

/**
 * How long breaking this block takes, in seconds — always a whole number of
 * ticks. Infinity for anything that cannot be broken at all, and zero for air.
 */
export function breakTime(id, held, where) {
  if (id === AIR || isWater(id)) return 0;
  if (id === BEDROCK) return Infinity;
  const rule = blockRule(id);
  const damage = destroySpeed(id, held, where)
    / rule.hardness / (canHarvest(id, held) ? 30 : 100);
  return Math.ceil(1 / damage) * TICK;
}

/**
 * What breaking it puts in your hand: the block itself, or nothing.
 *
 * The one thing here that gives nothing is a block broken without the tool it
 * wanted, and it is worth the special case: it means a vein you find before
 * you have anything to dig it with is still there when you come back.
 */
export function dropsFrom(id, held) {
  if (id === AIR || id === BEDROCK || isWater(id)) return 0;
  // Glass has no Silk Touch here: it breaks into nothing, like Minecraft
  // without the enchantment.
  if (id === GLASS) return 0;
  return canHarvest(id, held) ? id : 0;
}

/**
 * Does this block want a tool you are not holding? For the HUD to say so.
 *
 * Not only the ores: stone gives nothing to a bare hand either, which is
 * Minecraft's rule and a surprising one the first time it happens, so it is
 * worth a sentence on screen rather than a block that quietly evaporates.
 */
export const wrongTool = (id, held) => !canHarvest(id, held);

/** What the block wanted, for that sentence. */
export const toolNeeded = (id) => (blockRule(id).tool === SPADE ? 'shovel' : 'pickaxe');
