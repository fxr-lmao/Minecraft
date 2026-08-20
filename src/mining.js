// How long a block takes to break, and what you get for it.
//
// Until now breaking was instant and every block was the same: tap, and a
// mountain came apart as fast as you could point at it. Nothing in the world
// cost anything, which is most of why digging felt like deleting rather than
// like mining.
//
// Minecraft's rule is one line and everything else is a table:
//
//   time = hardness * (right tool ? 1.5 : 5) / speed
//
// Hardness is a property of the block; speed is a property of the tool, and
// is 1 for a bare hand. The 1.5 and the 5 are the interesting part — the
// penalty for using the wrong thing is not that it is slower, it is that it
// is *three and a third times* slower, and that ratio is the whole reason a
// pickaxe is worth carrying.
//
// Two blocks are special. Bedrock has no hardness at all and never breaks.
// And ore needs a pickaxe: without one it still breaks, and gives you
// nothing, which is Minecraft's rule and the one that makes finding a vein
// and finding a pickaxe two different problems.
//
// Pure: a block id and a held item in, seconds and a drop out. No world, no
// THREE, no DOM.

import {
  BEDROCK, GRASS, DIRT, SAND, SNOW, LEAVES, LOG, STONE, DEEPSLATE, ICE,
  ORE_IDS, isWater, AIR,
} from './terrain.js';
import { PICKAXE, SHOVEL } from './items.js';

/** What a tool is *for*. A block wants one of these, or nothing in particular. */
export const HAND = 0;
export const PICK = 1;
export const SPADE = 2;

/**
 * Minecraft's hardnesses, and which tool each block answers to.
 *
 * `needs` is the tool that makes it quick. `drops: false` means the wrong
 * tool breaks it for nothing — only the ores do that, and only for want of a
 * pickaxe.
 */
const BLOCKS = {
  [GRASS]: { hardness: 0.6, tool: SPADE },
  [DIRT]: { hardness: 0.5, tool: SPADE },
  [SAND]: { hardness: 0.5, tool: SPADE },
  [SNOW]: { hardness: 0.2, tool: SPADE },
  [LEAVES]: { hardness: 0.2, tool: HAND },
  [LOG]: { hardness: 2.0, tool: HAND },
  [STONE]: { hardness: 1.5, tool: PICK, needsTool: true },
  [DEEPSLATE]: { hardness: 3.0, tool: PICK, needsTool: true },
  [ICE]: { hardness: 0.5, tool: PICK },
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

/** What each tool is good at, and how much faster it makes it. */
const TOOLS = {
  [PICKAXE]: { kind: PICK, speed: 6 },
  [SHOVEL]: { kind: SPADE, speed: 4 },
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
 * How long breaking this block takes, in seconds. Infinity for anything that
 * cannot be broken at all, and zero for air.
 */
export function breakTime(id, held) {
  if (id === AIR || isWater(id)) return 0;
  if (id === BEDROCK) return Infinity;
  const rule = blockRule(id);
  const tool = TOOLS[held];
  const right = toolMatches(id, held);
  const speed = right ? tool.speed : 1;
  return rule.hardness * (right ? 1.5 : 5) / speed;
}

/**
 * What breaking it puts in your hand: the block itself, or nothing.
 *
 * Ore mined without a pickaxe is the only thing here that gives nothing, and
 * it is worth the special case: it means a vein you find before you have
 * anything to dig it with is still there when you come back.
 */
export function dropsFrom(id, held) {
  if (id === AIR || id === BEDROCK || isWater(id)) return 0;
  const rule = blockRule(id);
  if (rule.needsTool && !toolMatches(id, held)) return 0;
  return id;
}

/**
 * Does this block want a tool you are not holding? For the HUD to say so.
 *
 * Not only the ores: stone gives nothing to a bare hand either, which is
 * Minecraft's rule and a surprising one the first time it happens, so it is
 * worth a sentence on screen rather than a block that quietly evaporates.
 */
export const wrongTool = (id, held) => blockRule(id).needsTool && !toolMatches(id, held);
