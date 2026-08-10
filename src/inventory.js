// Inventory model: 9 hotbar slots ("the hand inventory") plus a 9 x 3 main
// grid, exactly like Minecraft's player inventory minus armour and crafting.
//
// Slot indices:
//   0  .. 8   hotbar (left to right)
//   9  .. 35  main grid, row-major: 9 columns x 3 rows
//
// A slot is either null (empty) or a stack: { id, count }.
// This file is pure data — no DOM, no THREE — so it is unit-tested in Node.

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
        this.slots[i] = { id, count: move };
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

  /** Put the cursor stack back into the grid (used when closing the screen). */
  returnCursor() {
    if (!this.cursor) return;
    const left = this.add(this.cursor.id, this.cursor.count);
    this.cursor = left > 0 ? { id: this.cursor.id, count: left } : null;
  }

  /** Starting kit: one stack of every block type, on the hotbar. */
  fillStarterKit(blockIds) {
    blockIds.slice(0, HOTBAR_SIZE).forEach((id, i) => {
      this.slots[i] = { id, count: STACK_MAX };
    });
  }
}
