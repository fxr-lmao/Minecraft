// Food: what is edible, what eating costs, and the act of eating itself.
//
// This is the data half of the hunger system (the bar is in hunger.js). It
// says which items are food, how much each one restores, how long it takes
// to eat, and — the one part that is not a table — the little state machine
// of holding a meal to your mouth: the button goes down, a bar fills, and at
// the end the item is spent and the food goes in. Pure, no THREE, no DOM.
//
// The numbers are Minecraft's. Nutrition is shanks (the half of a drumstick,
// twenty to a full bar) and saturation is the hidden second bar; the two
// together are why a steak is a meal and a raw porkchop is a snack even
// though both cost one item. Eating takes 1.6 seconds — Minecraft's 32 ticks
// — and the whole time you are eating you are not swinging, digging or
// running away, which is what makes the choice of *where* to eat a choice.

import {
  APPLE,
  RAW_BEEF, STEAK, RAW_PORKCHOP, COOKED_PORKCHOP,
  RAW_CHICKEN, COOKED_CHICKEN, RAW_MUTTON, COOKED_MUTTON,
  ROTTEN_FLESH, CARROT, POTATO, BAKED_POTATO, GOLDEN_APPLE,
} from './items.js';

/**
 * The food table. `nutrition` is shanks restored, `saturation` the hidden
 * bar on top of it. `poisonChance` is the chance, per bite, that the meal
 * disagrees with you — rotten flesh and raw chicken, Minecraft's two bad
 * foods, and the reason a furnace is a kitchen and not a decoration.
 */
export const FOOD = {
  [APPLE]: { nutrition: 4, saturation: 2.4 },
  [RAW_BEEF]: { nutrition: 3, saturation: 1.8 },
  [STEAK]: { nutrition: 8, saturation: 12.8 },
  [RAW_PORKCHOP]: { nutrition: 3, saturation: 1.8 },
  [COOKED_PORKCHOP]: { nutrition: 8, saturation: 12.8 },
  [RAW_CHICKEN]: { nutrition: 2, saturation: 1.2, poisonChance: 0.3 },
  [COOKED_CHICKEN]: { nutrition: 6, saturation: 7.2 },
  [RAW_MUTTON]: { nutrition: 2, saturation: 1.2 },
  [COOKED_MUTTON]: { nutrition: 6, saturation: 9.6 },
  [ROTTEN_FLESH]: { nutrition: 4, saturation: 0.8, poisonChance: 0.8 },
  [CARROT]: { nutrition: 3, saturation: 3.6 },
  [POTATO]: { nutrition: 1, saturation: 0.6 },
  [BAKED_POTATO]: { nutrition: 5, saturation: 6 },
  /**
   * The golden apple is the one food that heals as well as feeds — the
   * caller turns `heal` into hit points the moment the meal is done. It is
   * the reward for hoarding eight gold ingots, and it is worth every one.
   */
  [GOLDEN_APPLE]: { nutrition: 4, saturation: 9.6, heal: 4 },
};

/** Is this id something you can put in your mouth? */
export const isFood = (id) => id in FOOD;

/** The food's entry, or null for anything inedible. */
export const foodInfo = (id) => FOOD[id] ?? null;

/** Seconds one mouthful takes. Minecraft's 32 ticks. */
export const EAT_SECONDS = 1.6;

/**
 * One meal in progress.
 *
 * It knows which item it is eating and how far along it is, and nothing
 * else: it does not own the inventory (the caller spends the item when the
 * meal ends) and it does not own the hunger (the caller applies the food).
 * That split is what keeps it testable and keeps the damage of a wrong
 * guess at zero.
 */
export class Eater {
  constructor() {
    /** The id being eaten, or 0 when nothing is. */
    this.id = 0;
    /** 0..1 progress through EAT_SECONDS. */
    this.progress = 0;
    /** Set when the meal is interrupted (the button was released). */
    this._cancelled = false;
  }

  /** Is a mouthful in progress right now? */
  get eating() {
    return this.id !== 0;
  }

  /** Begin eating an item. Returns false if the item is not food. */
  start(id) {
    if (!isFood(id)) return false;
    this.id = id;
    this.progress = 0;
    this._cancelled = false;
    return true;
  }

  /** Stop whatever is being eaten, if anything, without spending it. */
  cancel() {
    this._cancelled = true;
  }

  /** A fresh mouthful of the same item replaces the last (holding the key). */
  reset(id) {
    this.id = id;
    this.progress = 0;
    this._cancelled = false;
  }

  /**
   * Advance the meal.
   *
   * @param {number} dt game seconds.
   * @param {() => number} [rand] the poison roll's random source.
   * @returns {null | {done: boolean, id: number, info: object, poison: boolean}}
   *   An object only when the meal finishes (or is interrupted with a done
   *   flag false). `info` is the food table entry; `poison` is true when the
   *   roll said this bite disagrees with the eater.
   */
  update(dt, rand = Math.random) {
    if (!this.id) return null;
    if (this._cancelled) {
      const id = this.id;
      this.id = 0;
      this.progress = 0;
      return { done: false, id, info: FOOD[id], poison: false };
    }
    this.progress += dt / EAT_SECONDS;
    if (this.progress < 1) return null;
    const id = this.id;
    const info = FOOD[id];
    this.id = 0;
    this.progress = 0;
    const poison = Boolean(info.poisonChance) && rand() < info.poisonChance;
    return { done: true, id, info, poison };
  }

  /** 0..1, for the little bar over the hotbar while eating. */
  get fraction() {
    return Math.min(1, this.progress);
  }
}
