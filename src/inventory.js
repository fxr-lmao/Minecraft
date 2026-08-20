// Inventory model: 9 hotbar slots ("the hand inventory") plus a 9 x 3 main
// grid, exactly like Minecraft's player inventory minus armour and crafting.
//
// Slot indices:
//   0  .. 8   hotbar (left to right)
//   9  .. 35  main grid, row-major: 9 columns x 3 rows
//
// A slot is either null (empty) or a stack: { id, count }.
// This file is pure data — no DOM, no THREE — so it is unit-tested in Node.

import { isItem } from './items.js';
import { ensureDurability, isTool } from './durability.js';
import { CraftingGrid, GRID_2X2 } from './crafting.js';

export const HOTBAR_SIZE = 9;
export const MAIN_COLS = 9;
export const MAIN_ROWS = 3;
export const MAIN_SIZE = MAIN_COLS * MAIN_ROWS; // 27
export const TOTAL_SLOTS = HOTBAR_SIZE + MAIN_SIZE; // 36
export const STACK_MAX = 64;

const clampIndex = (i) => Number.isInteger(i) && i >= 0 && i < TOTAL_SLOTS;

export class Inventory {
  constructor() {
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    /** Selected hotbar slot (0..8). */
    this.selected = 0;
    /** Stack picked up while rearranging (follows the cursor/finger). */
    this.cursor = null;
    /**
     * The crafting grid. 2x2 in the player inventory; resized to 3x3 while
     * the player is using a crafting table. Its contents are part of the
     * inventory and saved with it.
     */
    this.craftGrid = new CraftingGrid(GRID_2X2);
  }

  static isHotbar(i) {
    return i >= 0 && i < HOTBAR_SIZE;
  }

  get(i) {
    return clampIndex(i) ? this.slots[i] : null;
  }

  set(i, stack) {
    if (!clampIndex(i)) return;
    this.slots[i] = stack && stack.count > 0 ? stack : null;
  }

  /** The stack the player is currently holding in hand. */
  selectedStack() {
    return this.slots[this.selected];
  }

  selectedId() {
    return this.slots[this.selected]?.id ?? 0;
  }

  select(i) {
    if (i >= 0 && i < HOTBAR_SIZE) this.selected = i;
  }

  /** Scroll the hotbar selection; dir > 0 moves right, wrapping. */
  scroll(dir) {
    const step = dir > 0 ? 1 : HOTBAR_SIZE - 1;
    this.selected = (this.selected + step) % HOTBAR_SIZE;
  }

  countOf(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /**
   * Add items, merging into partial stacks first and then empty slots.
   * Returns the number of items that did not fit.
   */
  add(id, count = 1) {
    let left = count;
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < STACK_MAX) {
        const move = Math.min(STACK_MAX - s.count, left);
        s.count += move;
        left -= move;
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      if (!this.slots[i]) {
        const move = Math.min(STACK_MAX, left);
        this.slots[i] = ensureDurability({ id, count: move });
        left -= move;
      }
    }
    return left;
  }

  /** Consume from the selected hotbar slot. Returns true if it was taken. */
  consumeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    return true;
  }

  /**
   * Slot click while the inventory screen is open.
   * `half` is Minecraft's right-click: take half / place one.
   */
  clickSlot(i, half = false) {
    if (!clampIndex(i)) return;
    const slot = this.slots[i];

    if (!this.cursor) {
      if (!slot) return;
      if (half) {
        const take = Math.ceil(slot.count / 2);
        this.cursor = { id: slot.id, count: take };
        slot.count -= take;
        if (slot.count <= 0) this.slots[i] = null;
      } else {
        this.cursor = slot;
        this.slots[i] = null;
      }
      return;
    }

    if (!slot) {
      const move = half ? 1 : this.cursor.count;
      this.slots[i] = { id: this.cursor.id, count: move };
      this.cursor.count -= move;
      if (this.cursor.count <= 0) this.cursor = null;
      return;
    }

    if (slot.id === this.cursor.id) {
      const space = STACK_MAX - slot.count;
      if (space <= 0) return;
      const move = Math.min(space, half ? 1 : this.cursor.count);
      slot.count += move;
      this.cursor.count -= move;
      if (this.cursor.count <= 0) this.cursor = null;
      return;
    }

    if (!half) {
      this.slots[i] = this.cursor;
      this.cursor = slot;
    }
  }

  /**
   * Shift-click: move a stack between the hotbar and the main grid, merging
   * into matching stacks first. If the other section is full the stack is
   * partially moved and what is left stays put. Returns true when the whole
   * stack moved.
   */
  quickMove(i) {
    const src = this.get(i);
    if (!src) return false;
    const toHotbar = !Inventory.isHotbar(i);
    const from = toHotbar ? 0 : HOTBAR_SIZE;
    const to = toHotbar ? HOTBAR_SIZE : TOTAL_SLOTS;

    for (let k = from; k < to && src.count > 0; k++) {
      const s = this.slots[k];
      if (s && s.id === src.id && s.count < STACK_MAX) {
        const move = Math.min(STACK_MAX - s.count, src.count);
        s.count += move;
        src.count -= move;
      }
    }
    for (let k = from; k < to && src.count > 0; k++) {
      if (!this.slots[k]) {
        this.slots[k] = { id: src.id, count: src.count };
        src.count = 0;
      }
    }
    const moved = src.count === 0;
    if (moved) this.slots[i] = null;
    return moved;
  }

  /**
   * Sort: group stacks by id, largest first, then merge any that fit, and
   * pack everything to the front. Crafting grid and cursor are untouched.
   * Returns true if anything moved.
   */
  sort() {
    const stacks = this.slots.filter(Boolean).map((s) => ({ ...s }));
    // Tools never merge: each one carries its own durability, and folding
    // three part-used pickaxes into one stack would throw two of those
    // numbers away. They pass through as they are.
    const tools = stacks.filter((s) => isTool(s.id)).map(ensureDurability);
    // Merge everything else by id (a full sort of 36 slots is trivial here).
    const byId = new Map();
    for (const s of stacks) {
      if (isTool(s.id)) continue;
      const cur = byId.get(s.id);
      if (cur) cur.count += s.count;
      else byId.set(s.id, s);
    }
    // Collapse overflow into multiple stacks, then order: tools first
    // (durability descending), then blocks by id, count descending.
    const merged = [...tools];
    for (const [id, s] of byId) {
      let left = s.count;
      while (left > 0) {
        const take = Math.min(STACK_MAX, left);
        merged.push({ id, count: take });
        left -= take;
      }
    }
    merged.sort((a, b) => {
      const aTool = isTool(a.id) ? 1 : 0;
      const bTool = isTool(b.id) ? 1 : 0;
      if (aTool !== bTool) return bTool - aTool;
      if (a.id !== b.id) return a.id - b.id;
      if (aTool) return (b.durability ?? 0) - (a.durability ?? 0);
      return b.count - a.count;
    });
    // Write back, padded with nulls.
    const changed = merged.length !== this.slots.filter(Boolean).length
      || merged.some((s, i) => {
        const old = this.slots[i];
        return !old || old.id !== s.id || old.count !== s.count;
      });
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    merged.forEach((s, i) => { this.slots[i] = s; });
    return changed;
  }

  /** Put the cursor stack back into the grid (used when closing the screen). */
  returnCursor() {
    if (!this.cursor) return;
    const left = this.add(this.cursor.id, this.cursor.count);
    this.cursor = left > 0 ? { id: this.cursor.id, count: left } : null;
  }

  /**
   * Starting kit: a stack of every block, on the hotbar.
   *
   * One of each *item*, though. A pickaxe is not a thing you have sixty-four
   * of, and the bucket was already wrong in the same way and got away with it
   * because nobody counts their buckets — until you fill one, and all
   * sixty-four of them become water buckets at once, because a stack is one
   * thing with a number on it.
   */
  fillStarterKit(blockIds) {
    blockIds.slice(0, HOTBAR_SIZE).forEach((id, i) => {
      this.slots[i] = { id, count: isItem(id) ? 1 : STACK_MAX };
    });
  }
}
