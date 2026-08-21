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
import {
  PICKAXE, SHOVEL, WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL,
  WOOD_AXE, STONE_AXE, IRON_AXE, DIAMOND_AXE,
  WOOD_SWORD, STONE_SWORD, IRON_SWORD, DIAMOND_SWORD,
  DIAMOND_PICKAXE, DIAMOND_SHOVEL, oreDrop, APPLE,
} from './items.js';

/** What a tool is *for*. A block wants one of these, or nothing in particular. */
export const HAND = 0;
export const PICK = 1;
export const SPADE = 2;
/**
 * The axe, which is the answer to everything the forest is made of.
 *
 * This is not a fourth entry in a list, it is the fix for the biggest hole in
 * the mining rules: `tool: HAND` meant "nothing in particular helps", and
 * every wooden block in the game had it. So a hotbar with four tools in it
 * chopped a log in exactly the same three seconds as a bare fist, and the
 * forest was the one part of the world where being equipped meant nothing.
 * Minecraft has never worked that way — wood answers to an axe the way stone
 * answers to a pickaxe — and now neither does this.
 */
export const AXE = 3;
/**
 * The sword, which is not a mining tool at all.
 *
 * It gets a slot in this enum for one reason: leaves. A sword cuts leaves at
 * fifteen times the speed of a hand in Minecraft, which is the single
 * exception to "a sword is for fighting", and it is a real one — clearing a
 * canopy with a sword is something people actually do. Nothing else in the
 * world answers to it.
 */
export const BLADE = 4;

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
  // Leaves want the sword, which is Minecraft's odd little rule and a true
  // one: shears first, a sword second, and everything else at hand speed.
  // There are no shears here, so the sword is the whole of it.
  [LEAVES]: { hardness: 0.2, tool: BLADE },
  [LOG]: { hardness: 2.0, tool: AXE },
  [PLANKS]: { hardness: 2.0, tool: AXE },
  [STONE]: { hardness: 1.5, tool: PICK, needsTool: true },
  [COBBLESTONE]: { hardness: 2.0, tool: PICK, needsTool: true },
  [BRICKS]: { hardness: 2.0, tool: PICK, needsTool: true },
  [DEEPSLATE]: { hardness: 3.0, tool: PICK, needsTool: true },
  [ICE]: { hardness: 0.5, tool: PICK },
  // A crafting table is a wooden block, so it answers to the axe like every
  // other one. Two and a half seconds by hand, and half a second with iron.
  [CRAFTING_TABLE]: { hardness: 2.5, tool: AXE },
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
export const TOOLS = {
  [WOOD_PICKAXE]: { kind: PICK, speed: 2 },
  [WOOD_SHOVEL]: { kind: SPADE, speed: 2 },
  [WOOD_AXE]: { kind: AXE, speed: 2 },
  [STONE_PICKAXE]: { kind: PICK, speed: 4 },
  [STONE_SHOVEL]: { kind: SPADE, speed: 4 },
  [STONE_AXE]: { kind: AXE, speed: 4 },
  [PICKAXE]: { kind: PICK, speed: 6 },
  [SHOVEL]: { kind: SPADE, speed: 6 },
  [IRON_AXE]: { kind: AXE, speed: 6 },
  [DIAMOND_PICKAXE]: { kind: PICK, speed: 8 },
  [DIAMOND_SHOVEL]: { kind: SPADE, speed: 8 },
  [DIAMOND_AXE]: { kind: AXE, speed: 8 },
  /**
   * Swords, and their speed is 15 rather than a tier number.
   *
   * That looks like a mistake and is not. Minecraft's sword has a flat
   * destroy speed of 1.5 against everything (so it is half again as fast as a
   * fist at whatever it hits) and a special case of 15 against leaves and
   * cobwebs. Since BLADE is only ever the tool for leaves, the flat 15 *is*
   * the leaves case, and it is why a sword clears a canopy in two frames
   * while taking the normal age over a log.
   */
  [WOOD_SWORD]: { kind: BLADE, speed: 15 },
  [STONE_SWORD]: { kind: BLADE, speed: 15 },
  [IRON_SWORD]: { kind: BLADE, speed: 15 },
  [DIAMOND_SWORD]: { kind: BLADE, speed: 15 },
};

/**
 * A sword swung at anything that is not leaves is still a sword: Minecraft
 * gives it a flat 1.5 against every other block, which is not enough to make
 * it a digging tool and is enough that punching a dirt block with a sword in
 * your hand is not *slower* than punching it empty-handed.
 */
const SWORD_GENERAL_SPEED = 1.5;

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
  const tool = TOOLS[held];
  let speed;
  if (tool && tool.kind === blockRule(id).tool) {
    speed = tool.speed;
  } else if (tool && tool.kind === BLADE) {
    // A sword against anything that is not leaves. Minecraft's flat 1.5 —
    // see SWORD_GENERAL_SPEED. Without this branch the general `1` below
    // would apply and a sword would be exactly a fist, which it is not.
    speed = SWORD_GENERAL_SPEED;
  } else {
    speed = 1;
  }
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
  if (!canHarvest(id, held)) return 0;
  // Ore does not drop ore.
  //
  // It used to, and that was the biggest thing standing between this game and
  // Minecraft's actual loop: a diamond vein gave you diamond *ore blocks*,
  // and the only thing you could do with a diamond ore block was place it
  // somewhere else. Nothing the mine produced could ever become a tool, so
  // the starter kit's iron pickaxe was the best pickaxe that would ever
  // exist. Now coal, redstone and diamond come out finished, iron and gold
  // come out raw for the furnace, and the mine is a supply chain.
  const ore = oreDrop(id);
  if (ore !== null) return ore;
  // Stone breaks into cobblestone, which is Minecraft's oldest rule and the
  // reason a furnace has anything to smelt: you cannot get stone back out of
  // the ground, you have to cook it.
  if (id === STONE) return COBBLESTONE;
  return id;
}

/**
 * Leaves mostly drop leaves; occasionally an apple.
 *
 * The apple is the one food the trees give for free, and the chance is the
 * thing that decides whether it is a treat or a diet. Minecraft's oak leaves
 * give one apple per two hundred leaves broken; that is the right rarity for
 * a game where wheat fields exist, and far too rare for this one, where the
 * tree is the *only* apple tree. So the chance is raised to one in ten, and
 * noted as such rather than passed off as Minecraft's number.
 */
export const APPLE_CHANCE = 0.1;

/** The leaf's drop, rolled against APPLE_CHANCE. */
export function dropsFromLeaf(rand = Math.random) {
  return rand() < APPLE_CHANCE ? APPLE : LEAVES;
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
export function toolNeeded(id) {
  switch (blockRule(id).tool) {
    case SPADE: return 'shovel';
    case AXE: return 'axe';
    case BLADE: return 'sword';
    default: return 'pickaxe';
  }
}

/**
 * The name of the tool family a held item belongs to, or '' for anything that
 * is not a tool. For the HUD, and for the debug screen.
 */
export function toolFamily(held) {
  switch (TOOLS[held]?.kind) {
    case PICK: return 'pickaxe';
    case SPADE: return 'shovel';
    case AXE: return 'axe';
    case BLADE: return 'sword';
    default: return '';
  }
}

/**
 * How much better the right tool makes this block, as a ratio of times.
 *
 * Only for the HUD's benefit — it is what lets the game say "an axe would be
 * four times faster" rather than leaving the player to work out why the log
 * is taking so long. Returns 1 when the tool in hand is already the right
 * one, or when nothing helps.
 */
export function toolAdvantage(id, held) {
  const bare = breakTime(id, held);
  if (!Number.isFinite(bare) || bare <= 0) return 1;
  let best = bare;
  for (const toolId of Object.keys(TOOLS)) {
    const t = breakTime(id, Number(toolId));
    if (Number.isFinite(t) && t > 0 && t < best) best = t;
  }
  return bare / best;
}
