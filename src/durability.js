// Tool durability: every tool has a number of uses, spent one per block
// broken, and a tool that runs out breaks and disappears — Minecraft's rule
// exactly, with Minecraft's numbers for the tiers that exist here.
//
// Durability lives on the stack as `{ id, count, durability }`; stacks
// without the field (old saves, crafted tools) are treated as full when
// first inspected. This file is pure data — no DOM, no THREE.

import {
  PICKAXE, SHOVEL, WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL,
  WOOD_AXE, STONE_AXE, IRON_AXE, DIAMOND_AXE,
  WOOD_SWORD, STONE_SWORD, IRON_SWORD, DIAMOND_SWORD,
  DIAMOND_PICKAXE, DIAMOND_SHOVEL,
  BOW,
  TOOL_KINDS, TIER_WOOD, TIER_STONE, TIER_IRON, TIER_DIAMOND,
} from './items.js';
import { ARMOUR, armourDurability } from './armour.js';

/**
 * Minecraft's durability per *tier*, which is the honest way to say it: every
 * tool of a given material has the same number of uses in it, whatever shape
 * it happens to be. Wood 59, stone 131, iron 250, diamond 1561 — and that
 * last number is not a typo, it is six times the iron one, and it is the
 * whole reason a diamond pickaxe is worth the fortnight it takes to find the
 * diamonds.
 */
export const TIER_DURABILITY = {
  [TIER_WOOD]: 59,
  [TIER_STONE]: 131,
  [TIER_IRON]: 250,
  [TIER_DIAMOND]: 1561,
};

/**
 * Minecraft's durability per tool, derived from the tier table above rather
 * than written out sixteen times — which is not laziness, it is the only way
 * to be sure a diamond axe and a diamond sword agree with each other.
 */
export const MAX_DURABILITY = Object.fromEntries(
  Object.entries(TOOL_KINDS).map(([id, kind]) => [id, TIER_DURABILITY[kind.tier]])
);

/**
 * The bow wears too, on Minecraft's own number: 384 shots. It is not a tool
 * (the tool table is shapes of pickaxe, shovel, axe and sword), so it earns
 * its one entry here rather than a tier — a bow is a bow, there is no wooden
 * bow against a diamond bow, only the one you made and the string it is
 * strung with.
 */
export const BOW_DURABILITY = 384;
MAX_DURABILITY[BOW] = BOW_DURABILITY;

// Armour wears as well; its durability lives in armour.js, next to the
// points it grants, and is merged here so every stack in the game that can
// wear out wears out through the same ensure/spend pair.
for (const [id, info] of Object.entries(ARMOUR)) {
  MAX_DURABILITY[id] = info.durability;
}
void armourDurability;

/** The full durability of a stack's item, or undefined for non-tools. */
export function maxDurability(id) {
  return MAX_DURABILITY[id];
}

/**
 * Is this id a *tool* — a pickaxe, shovel, axe or sword? Tools are the only
 * things that wear while digging or swinging; the bow and armour wear too,
 * but through their own paths, so they are "durable" without being "tools".
 */
export const isTool = (id) => id in TOOL_KINDS;

/**
 * Is this id something with durability at all — a tool, the bow, or a piece
 * of armour? This is the set that must never merge in a sort or a pile,
 * because each one carries its own number of uses left.
 */
export const isDurable = (id) => id in MAX_DURABILITY;

/**
 * The durability a freshly obtained tool should start with. New stacks get
 * this; stacks restored from a save that predates durability get it too.
 */
export function freshDurability(id) {
  return MAX_DURABILITY[id] ?? 0;
}

/** Remaining uses, treating missing as full (old saves / new items). */
export function durabilityOf(stack) {
  if (!stack) return 0;
  const max = MAX_DURABILITY[stack.id];
  if (max === undefined) return 0;
  if (Number.isFinite(stack.durability)) return stack.durability;
  return max;
}

/** Fraction left, 0..1, for the HUD bar. */
export function durabilityFraction(stack) {
  const max = MAX_DURABILITY[stack.id];
  if (max === undefined) return 1;
  return Math.max(0, Math.min(1, durabilityOf(stack) / max));
}

/**
 * Use a tool once (break one block). Returns the new stack state:
 *   { stack: <stack or null if it broke> }
 * A stack that is down to its last use comes back null, and the caller shows
 * the "broke" message.
 */
export function spendDurability(stack) {
  if (!stack) return { stack, broke: false };
  const max = MAX_DURABILITY[stack.id];
  if (max === undefined) return { stack, broke: false };
  const left = durabilityOf(stack) - 1;
  if (left <= 0) return { stack: null, broke: true };
  return { stack: { ...stack, durability: left }, broke: false };
}

/** Set durability on a stack that was just created (crafted, picked up). */
export function ensureDurability(stack) {
  if (!stack) return null;
  if (MAX_DURABILITY[stack.id] !== undefined && !Number.isFinite(stack.durability)) {
    return { ...stack, durability: MAX_DURABILITY[stack.id] };
  }
  return stack;
}
