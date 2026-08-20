// Furnace smelting: input + fuel -> output after a burn time, Minecraft-style.
//
// The furnace is a *state machine per block*: place a furnace, open it, put
// sand and a log in, and out comes glass after the log burns down. State is
// kept in a `FurnaceStore` keyed by "x,y,z" so each furnace in the world
// remembers what it was doing between visits — and the store is saved with
// the world, so a furnace you lit still finishes while you are away (the
// burn clock runs on game time; come back later and it is done).
//
// Numbers are Minecraft's where they exist: sand smelts in 10 seconds, a
// log burns for 15 seconds of fuel, planks for 7.5, sticks for 2.5.

import { SAND, GLASS, COBBLESTONE, STONE, LOG, PLANKS } from './terrain.js';
import {
  STICKS, RAW_IRON, IRON_INGOT, RAW_GOLD, GOLD_INGOT, COAL,
} from './items.js';

/** Real seconds to smelt one item (Minecraft's 200 ticks). */
export const SMELT_TIME = 10;

/**
 * What each fuel burns for, in seconds.
 *
 * Coal is the one that matters and it is Minecraft's number: eighty seconds,
 * which is eight items, against a log's fifteen. Before there was any coal
 * *item* the furnace ran on wood and only wood, which meant that smelting a
 * stack of raw iron cost most of a tree — and coal ore, which the mine
 * produces more of than anything else, was worth nothing at all. One entry in
 * this table is the difference.
 */
export const FUEL_SECONDS = {
  [COAL]: 80,
  [LOG]: 15,
  [PLANKS]: 7.5,
  [STICKS]: 2.5,
};

/** Input id -> output id. */
export const SMELT_RECIPES = {
  [SAND]: GLASS,
  [COBBLESTONE]: STONE,
  // The two ores that come out raw. This is the other half of the ore-drop
  // change: a diamond needs no furnace, and raw iron is useless without one.
  [RAW_IRON]: IRON_INGOT,
  [RAW_GOLD]: GOLD_INGOT,
};

export const isFuel = (id) => id in FUEL_SECONDS;
export const smeltsTo = (id) => SMELT_RECIPES[id] ?? null;

/** One furnace's state: two stacks and the burn clock. */
export class Furnace {
  constructor() {
    /** { id, count } or null */
    this.input = null;
    this.fuel = null;
    /** { id, count } or null — the finished goods. */
    this.output = null;
    /** Seconds of burn left on the current fuel (not the item count). */
    this.burn = 0;
    /** 0..1 how far the current input has cooked. */
    this.progress = 0;
  }

  /** Is something smelting right now? */
  get active() {
    return this.burn > 0 && this.input && smeltsTo(this.input.id) !== null;
  }

  /** Is there an input to cook and somewhere for the result to land? */
  get canCook() {
    const outId = this.input ? smeltsTo(this.input.id) : null;
    if (!outId) return false;
    if (!this.output) return true;
    return this.output.id === outId && this.output.count < 64;
  }

  /**
   * Advance the furnace by `dt` seconds of game time. Consumes fuel as
   * needed, cooks the input, and pushes finished goods to the output slot.
   */
  tick(dt) {
    // Light the fuel only if the furnace can actually cook. Lighting it with
    // a full output slot would spend a whole log to heat an empty room.
    if (this.burn <= 0 && this.canCook && this.fuel) {
      this.burn = FUEL_SECONDS[this.fuel.id] ?? 0;
      if (this.burn > 0) {
        this.fuel.count--;
        if (this.fuel.count <= 0) this.fuel = null;
      }
    }

    if (this.burn <= 0) {
      // Nothing burning: progress decays, so it does not sit half-cooked.
      this.progress = Math.max(0, this.progress - dt * 0.1);
      return;
    }

    // Something is burning. Cook only if there is input and room for output.
    const outId = this.input ? smeltsTo(this.input.id) : null;
    if (!this.canCook) {
      this.burn = Math.max(0, this.burn - dt * 0.2); // burn down slowly, idle
      return;
    }

    this.burn = Math.max(0, this.burn - dt);
    this.progress += dt / SMELT_TIME;
    if (this.progress >= 1) {
      this.progress = 0;
      this.input.count--;
      if (this.input.count <= 0) this.input = null;
      if (this.output) this.output.count++;
      else this.output = { id: outId, count: 1 };
    }
  }

  /**
   * Put a stack in a slot: input (0), fuel (1), output (2). Returns true if
   * it went in. Output never accepts items — you only take from it.
   */
  insert(slot, stack) {
    if (!stack) return false;
    if (slot === 0) {
      if (!smeltsTo(stack.id)) return false;
      if (this.input && this.input.id !== stack.id) return false;
      if (this.input) {
        const space = 64 - this.input.count;
        if (space <= 0) return false;
        const move = Math.min(space, stack.count);
        this.input.count += move;
        stack.count -= move;
      } else {
        this.input = { id: stack.id, count: stack.count };
        stack.count = 0;
      }
      return stack.count <= 0;
    }
    if (slot === 1) {
      if (!isFuel(stack.id)) return false;
      if (this.fuel && this.fuel.id !== stack.id) return false;
      if (this.fuel) {
        const space = 64 - this.fuel.count;
        if (space <= 0) return false;
        const move = Math.min(space, stack.count);
        this.fuel.count += move;
        stack.count -= move;
      } else {
        this.fuel = { id: stack.id, count: stack.count };
        stack.count = 0;
      }
      return stack.count <= 0;
    }
    return false;
  }

  /** Take everything out of the output slot, or one item with `one`. */
  takeOutput(one = false) {
    if (!this.output) return null;
    const take = one ? 1 : this.output.count;
    const out = { id: this.output.id, count: take };
    this.output.count -= take;
    if (this.output.count <= 0) this.output = null;
    return out;
  }
}

/** All furnaces in the world, keyed by "x,y,z". */
export class FurnaceStore {
  constructor() {
    /** Map<string, Furnace> */
    this.map = new Map();
  }

  key(x, y, z) {
    return `${x},${y},${z}`;
  }

  get(x, y, z) {
    let f = this.map.get(this.key(x, y, z));
    if (!f) {
      f = new Furnace();
      this.map.set(this.key(x, y, z), f);
    }
    return f;
  }

  has(x, y, z) {
    return this.map.has(this.key(x, y, z));
  }

  delete(x, y, z) {
    return this.map.delete(this.key(x, y, z));
  }

  /** Advance every furnace by dt. Only used when the game is running. */
  tickAll(dt) {
    for (const f of this.map.values()) f.tick(dt);
  }

  /** Save: flat list of { x, y, z, input, fuel, output, burn, progress }. */
  toJSON() {
    const out = [];
    for (const [key, f] of this.map) {
      const [x, y, z] = key.split(',').map(Number);
      out.push({
        x, y, z,
        input: f.input ? { id: f.input.id, count: f.input.count } : null,
        fuel: f.fuel ? { id: f.fuel.id, count: f.fuel.count } : null,
        output: f.output ? { id: f.output.id, count: f.output.count } : null,
        burn: f.burn,
        progress: f.progress,
      });
    }
    return out;
  }

  /** Restore from a saved list (from savegame.js). */
  fromJSON(list) {
    this.map.clear();
    for (const rec of list ?? []) {
      const f = new Furnace();
      f.input = rec.input;
      f.fuel = rec.fuel;
      f.output = rec.output;
      f.burn = rec.burn ?? 0;
      f.progress = rec.progress ?? 0;
      this.map.set(this.key(rec.x, rec.y, rec.z), f);
    }
  }
}
