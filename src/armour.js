// Armour: the things you wear to make the night hurt less.
//
// Four slots — helmet, chestplate, leggings, boots — and four materials —
// leather, iron, gold, diamond. Each piece carries Minecraft's own defence
// points and its own durability; the whole suit's points become a flat
// percentage off every hit, capped at eighty percent, which is Minecraft's
// rule and the reason a full set of diamond is not invincibility, only a
// very good idea.
//
// This file is pure data and arithmetic — no THREE, no DOM — so the damage
// maths can be unit-tested the way the mining and durability rules are.

import {
  LEATHER_HELMET, LEATHER_CHESTPLATE, LEATHER_LEGGINGS, LEATHER_BOOTS,
  IRON_HELMET, IRON_CHESTPLATE, IRON_LEGGINGS, IRON_BOOTS,
  GOLD_HELMET, GOLD_CHESTPLATE, GOLD_LEGGINGS, GOLD_BOOTS,
  DIAMOND_HELMET, DIAMOND_CHESTPLATE, DIAMOND_LEGGINGS, DIAMOND_BOOTS,
} from './items.js';

export const SLOT_HELMET = 0;
export const SLOT_CHEST = 1;
export const SLOT_LEGS = 2;
export const SLOT_BOOTS = 3;
export const ARMOUR_SLOTS = 4;
export const SLOT_NAMES = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];

/** How much of each hit a point of armour turns aside. Four percent. */
export const ARMOUR_POINT_REDUCTION = 0.04;
/** ...and the ceiling, Minecraft's eighty percent. */
export const ARMOUR_CAP = 0.8;

/**
 * The armour table. `points` is Minecraft's defence per piece (a full suit
 * of leather is 7, iron 15, gold 11, diamond 20); `durability` is per piece,
 * spent one at a time by the hits it softens.
 */
export const ARMOUR = {
  [LEATHER_HELMET]: { slot: SLOT_HELMET, points: 1, durability: 55 },
  [LEATHER_CHESTPLATE]: { slot: SLOT_CHEST, points: 3, durability: 55 },
  [LEATHER_LEGGINGS]: { slot: SLOT_LEGS, points: 2, durability: 55 },
  [LEATHER_BOOTS]: { slot: SLOT_BOOTS, points: 1, durability: 55 },
  [IRON_HELMET]: { slot: SLOT_HELMET, points: 2, durability: 165 },
  [IRON_CHESTPLATE]: { slot: SLOT_CHEST, points: 6, durability: 165 },
  [IRON_LEGGINGS]: { slot: SLOT_LEGS, points: 5, durability: 165 },
  [IRON_BOOTS]: { slot: SLOT_BOOTS, points: 2, durability: 165 },
  [GOLD_HELMET]: { slot: SLOT_HELMET, points: 2, durability: 77 },
  [GOLD_CHESTPLATE]: { slot: SLOT_CHEST, points: 5, durability: 77 },
  [GOLD_LEGGINGS]: { slot: SLOT_LEGS, points: 3, durability: 77 },
  [GOLD_BOOTS]: { slot: SLOT_BOOTS, points: 1, durability: 77 },
  [DIAMOND_HELMET]: { slot: SLOT_HELMET, points: 3, durability: 330 },
  [DIAMOND_CHESTPLATE]: { slot: SLOT_CHEST, points: 8, durability: 330 },
  [DIAMOND_LEGGINGS]: { slot: SLOT_LEGS, points: 6, durability: 330 },
  [DIAMOND_BOOTS]: { slot: SLOT_BOOTS, points: 3, durability: 330 },
};

/** Is this id a piece of armour? */
export const isArmour = (id) => id in ARMOUR;

/** Which slot a piece belongs to, or -1 for anything else. */
export const armourSlot = (id) => ARMOUR[id]?.slot ?? -1;

/** The piece's defence points, or 0. */
export const armourPoints = (id) => ARMOUR[id]?.points ?? 0;

/** The piece's durability, or 0. */
export const armourDurability = (id) => ARMOUR[id]?.durability ?? 0;

/**
 * The total defence of an armour array (four stacks or nulls), in points.
 * This is the number the HUD draws as ten armour pips above the hearts.
 */
export function totalArmourPoints(armour) {
  let n = 0;
  for (const stack of armour ?? []) {
    if (stack) n += armourPoints(stack.id);
  }
  return n;
}

/** The fraction of a hit a given number of points turns aside, 0..0.8. */
export function reduction(points) {
  return Math.min(ARMOUR_CAP, points * ARMOUR_POINT_REDUCTION);
}

/**
 * Resolve a hit through the armour: return the damage that gets through,
 * the amount that was absorbed, and the armour array after each worn piece
 * has spent a point of durability for the trouble.
 *
 * `armour` is the array itself (four slots); it is mutated in place so the
 * caller owns one array and this file never has to know where it lives.
 */
export function absorb(armour, damage) {
  if (!Array.isArray(armour)) return { through: damage, absorbed: 0 };
  let points = 0;
  for (const stack of armour) {
    if (stack) points += armourPoints(stack.id);
  }
  const absorbed = damage * reduction(points);
  const through = damage - absorbed;

  // Each worn piece pays a use for every hit that touched it, rounded up so
  // a hit softened by anything costs at least one use. A piece that reaches
  // zero is gone — armour wears out, which is why you make more.
  const uses = Math.max(1, Math.round(absorbed / 2));
  for (const stack of armour) {
    if (!stack) continue;
    stack.durability = (Number.isFinite(stack.durability) ? stack.durability : armourDurability(stack.id)) - uses;
  }
  for (let i = 0; i < armour.length; i++) {
    if (armour[i] && armour[i].durability <= 0) armour[i] = null;
  }

  return { through, absorbed };
}
