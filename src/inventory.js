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
import { ensureDurability, isDurable } from './durability.js';
import { isArmour, armourSlot, ARMOUR_SLOTS } from './armour.js';
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
    /**
     * The four armour slots, helmet first. Not part of the 36 hand slots —
     * they are worn, not carried — and saved with the rest of the player.
     */
    this.armour = new Array(ARMOUR_SLOTS).fill(null);
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
    // Anything with durability takes a slot of its own. Two half-worn
    // pickaxes — or a battered helmet and a fresh one — are not two of the
    // same thing: merging them keeps one durability number and throws the
    // other away, and the item that comes back out of the stack is a lie
    // about how much use is left in it. Drops already refuse this merge on
    // the floor (see drops.js); this is the same rule at the moment they
    // reach your hand.
    const stacks = !isDurable(id);
    for (let i = 0; stacks && i < TOTAL_SLOTS && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < STACK_MAX) {
        const move = Math.min(STACK_MAX - s.count, left);
        s.count += move;
        left -= move;
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      if (!this.slots[i]) {
        const move = stacks ? Math.min(STACK_MAX, left) : 1;
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
   * Consume n of an item from anywhere in the inventory — the bow's arrows
   * live in any slot, not just the one in hand, which is Minecraft's rule
   * and the reason a quiver is a slot you never look at.
   */
  consume(id, n = 1) {
    let left = n;
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, left);
        s.count -= take;
        left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return left === 0;
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
   * Click an armour slot. Only armour may enter, and only into the slot it
   * belongs to — a helmet into the helmet slot, nowhere else. Otherwise the
   * same pick-up / drop / swap dance as any other slot.
   */
  clickArmourSlot(i, half = false) {
    if (!Number.isInteger(i) || i < 0 || i >= ARMOUR_SLOTS) return;
    const slot = this.armour[i];

    if (!this.cursor) {
      if (!slot) return;
      if (half) {
        const take = Math.ceil(slot.count / 2);
        this.cursor = { id: slot.id, count: take, durability: slot.durability };
        slot.count -= take;
        if (slot.count <= 0) this.armour[i] = null;
      } else {
        this.cursor = slot;
        this.armour[i] = null;
      }
      return;
    }

    // A piece can only go where it belongs; anything else is simply refused,
    // so a chestplate dropped on the helmet slot stays in your hand.
    if (armourSlot(this.cursor.id) !== i) return;

    if (!slot) {
      const move = half ? 1 : this.cursor.count;
      this.armour[i] = ensureDurability({ id: this.cursor.id, count: move, durability: this.cursor.durability });
      this.cursor.count -= move;
      if (this.cursor.count <= 0) this.cursor = null;
      return;
    }
    // Both hold armour: swap, unless a right-click wants to place one.
    if (!half) {
      this.armour[i] = this.cursor;
      this.cursor = slot;
    }
  }

  /**
   * Shift-click an armour item in a hand slot: put it on, if its slot is
   * free. Returns true when it was equipped. Wearing a piece keeps its
   * durability — a battered helmet is still a battered helmet on your head.
   */
  equipArmour(index) {
    const stack = this.get(index);
    if (!stack || !isArmour(stack.id)) return false;
    const slot = armourSlot(stack.id);
    if (slot < 0 || this.armour[slot]) return false;
    this.armour[slot] = ensureDurability(stack);
    this.slots[index] = null;
    return true;
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
   * pack everything to the front. Crafting grid, cursor and armour are
   * untouched. Returns true if anything moved.
   */
  sort() {
    const stacks = this.slots.filter(Boolean).map((s) => ({ ...s }));
    // Durable items never merge: each one carries its own durability, and
    // folding three part-used pickaxes (or a part-used chestplate into a
    // fresh one) into one stack would throw two of those numbers away.
    // They pass through as they are.
    const durable = stacks.filter((s) => isDurable(s.id)).map(ensureDurability);
    // Merge everything else by id (a full sort of 36 slots is trivial here).
    const byId = new Map();
    for (const s of stacks) {
      if (isDurable(s.id)) continue;
      const cur = byId.get(s.id);
      if (cur) cur.count += s.count;
      else byId.set(s.id, s);
    }
    // Collapse overflow into multiple stacks, then order: durable first
    // (durability descending), then blocks by id, count descending.
    const merged = [...durable];
    for (const [id, s] of byId) {
      let left = s.count;
      while (left > 0) {
        const take = Math.min(STACK_MAX, left);
        merged.push({ id, count: take });
        left -= take;
      }
    }
    merged.sort((a, b) => {
      const aDur = isDurable(a.id) ? 1 : 0;
      const bDur = isDurable(b.id) ? 1 : 0;
      if (aDur !== bDur) return bDur - aDur;
      if (a.id !== b.id) return a.id - b.id;
      if (aDur) return (b.durability ?? 0) - (a.durability ?? 0);
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
