// Experience and levels: mining ore grants XP, and every 100 points buys a
// level, shown in the HUD above the hotbar like Minecraft's. There is no
// enchanting yet — the level is a score, a visible record of how much
// precious rock you have pulled out of the ground.
//
// Points are Minecraft's per-ore numbers: coal 2, iron 3, gold 5, redstone
// 5, diamond 10 (the deepslate twins pay the same — it is the same ore).

import { COAL_ORE, IRON_ORE, GOLD_ORE, REDSTONE_ORE, DIAMOND_ORE } from './terrain.js';

/** XP for mining each ore (stone-backed and deepslate-backed alike). */
const ORE_XP = {
  [COAL_ORE]: 2,
  [IRON_ORE]: 3,
  [GOLD_ORE]: 5,
  [REDSTONE_ORE]: 5,
  [DIAMOND_ORE]: 10,
};

/** Points needed for each level. */
export const XP_PER_LEVEL = 100;

/** The ore's XP value, or 0 for anything else. */
export function xpForOre(id) {
  return ORE_XP[id] ?? 0;
}

/** The ore twin of a deepslate ore (they share the same XP). */
export function xpForBlock(id) {
  // Deepslate ores are the stone ores + 5 (see terrain.js).
  if (id >= DIAMOND_ORE + 1 && id <= DIAMOND_ORE + 5) return ORE_XP[id - 5] ?? 0;
  return ORE_XP[id] ?? 0;
}

export class XpBar {
  constructor() {
    /** Points toward the next level. */
    this.points = 0;
    /** Levels earned. */
    this.level = 0;
  }

  /** Add XP, crossing levels as the bar fills. Returns levels gained. */
  add(amount) {
    if (amount <= 0) return 0;
    this.points += amount;
    let gained = 0;
    while (this.points >= XP_PER_LEVEL) {
      this.points -= XP_PER_LEVEL;
      this.level++;
      gained++;
    }
    return gained;
  }

  /** 0..1 how full the bar is. */
  get fraction() {
    return Math.min(1, this.points / XP_PER_LEVEL);
  }

  toJSON() {
    return { points: this.points, level: this.level };
  }

  fromJSON(raw) {
    if (!raw) return;
    this.points = Number.isFinite(raw.points) ? raw.points : 0;
    this.level = Number.isInteger(raw.level) ? raw.level : 0;
  }
}
