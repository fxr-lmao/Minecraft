// Tool durability: every tool has a number of uses, spent one per block
// broken, and a tool that runs out breaks and disappears — Minecraft's rule
// exactly, with Minecraft's numbers for the tiers that exist here.
//
// Durability lives on the stack as `{ id, count, durability }`; stacks
// without the field (old saves, crafted tools) are treated as full when
// first inspected. This file is pure data — no DOM, no THREE.

import { PICKAXE, SHOVEL, WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL } from './items.js';

/** Minecraft's durability per tool. */
export const MAX_DURABILITY = {
  [WOOD_PICKAXE]: 59,
  [WOOD_SHOVEL]: 59,
  [STONE_PICKAXE]: 131,
  [STONE_SHOVEL]: 131,
  [PICKAXE]: 250,
  [SHOVEL]: 250,
};

/** The full durability of a stack's item, or undefined for non-tools. */
export function maxDurability(id) {
  return MAX_DURABILITY[id];
}

/** Is this id something with durability at all? */
export const isTool = (id) => id in MAX_DURABILITY;

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
