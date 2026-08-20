// The furnace screen: three slots (input, fuel, output), a flame that burns
// while fuel is lit, and an arrow that fills as the input cooks. It is a
// plain DOM panel, like the inventory, and shares the inventory's slot
// styling and drag-with-cursor model.

import { getBlockAssets, getBlockDefById } from './textures.js';
import { iconForSlot } from './inventory-ui.js';

export class FurnaceUI {
  /**
   * @param {FurnaceStore} store  the world's furnace state
   * @param {Inventory} inventory  the player's inventory (for the cursor)
   * @param {(open: boolean) => void} onToggle
   */
  constructor(store, inventory, onToggle = () => {}) {
    this.store = store;
    this.inv = inventory;
    this.onToggle = onToggle;
    this.isOpen = false;
    /** The furnace currently on screen, or null. */
    this.current = null;

    this.screenEl = document.getElementById('furnace');
    this.inputEl = document.getElementById('furnace-input');
    this.fuelEl = document.getElementById('furnace-fuel');
    this.outputEl = document.getElementById('furnace-output');
    this.flameEl = document.getElementById('furnace-flame');
    this.arrowEl = document.getElementById('furnace-arrow');
    this.cursorEl = document.getElementById('cursor-stack');

    this._bind();
  }

  _bind() {
    const slot = (el, slotIndex) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._clickSlot(slotIndex, e.button === 2);
      });
    };
    slot(this.inputEl, 0);
    slot(this.fuelEl, 1);
    slot(this.outputEl, 2);

    this.screenEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.inv-panel')) return;
      if (this.inv.cursor) {
        this.inv.returnCursor();
        this.render();
      } else {
        this.close();
      }
    });
    this.screenEl.addEventListener('contextmenu', (e) => e.preventDefault());
    this.screenEl.addEventListener('pointermove', (e) => this._moveCursor(e.clientX, e.clientY));
    document.getElementById('furnace-close').addEventListener('click', () => this.close());
  }

  open(x, y, z) {
    if (this.isOpen) return;
    this.current = this.store.get(x, y, z);
    this.isOpen = true;
    this.screenEl.classList.remove('hidden');
    this.render();
    this.onToggle(true);
  }

  close() {
    if (!this.isOpen) return;
    this.inv.returnCursor();
    this.isOpen = false;
    this.current = null;
    this.screenEl.classList.add('hidden');
    this.onToggle(false);
  }

  _clickSlot(slotIndex, half) {
    if (!this.current) return;
    const f = this.current;

    if (slotIndex === 2) {
      // Output: take it into the cursor (merging if it matches).
      const out = f.takeOutput(!half);
      if (!out) return;
      if (this.inv.cursor && this.inv.cursor.id === out.id) {
        const space = 64 - this.inv.cursor.count;
        const move = Math.min(space, out.count);
        this.inv.cursor.count += move;
        if (move < out.count) this.inv.add(out.id, out.count - move);
      } else if (!this.inv.cursor) {
        this.inv.cursor = out;
      } else {
        this.inv.add(out.id, out.count);
      }
      this.render();
      return;
    }

    // Input / fuel: swap with the cursor like an inventory slot, but the
    // furnace decides what each slot accepts (via insert).
    const stack = slotIndex === 0 ? f.input : f.fuel;
    if (!this.inv.cursor) {
      // Pick up whatever is in the slot.
      if (!stack) return;
      const take = half ? Math.ceil(stack.count / 2) : stack.count;
      const rest = stack.count - take;
      this.inv.cursor = { id: stack.id, count: take };
      if (rest > 0) {
        if (slotIndex === 0) f.input = { id: stack.id, count: rest };
        else f.fuel = { id: stack.id, count: rest };
      } else {
        if (slotIndex === 0) f.input = null;
        else f.fuel = null;
      }
    } else {
      const move = half ? 1 : this.inv.cursor.count;
      const toMove = { id: this.inv.cursor.id, count: move };
      if (f.insert(slotIndex, toMove)) {
        this.inv.cursor.count -= move;
        if (this.inv.cursor.count <= 0) this.inv.cursor = null;
      }
    }
    this._moveCursorToLast();
    this.render();
  }

  _moveCursor(x, y) {
    this.cursorEl.style.left = `${x}px`;
    this.cursorEl.style.top = `${y}px`;
  }

  _moveCursorToLast() { /* cursor follows pointer events; nothing to do */ }

  /** Redraw the three slots, flame and arrow. */
  render() {
    const f = this.current;
    if (!f) return;
    this._paintSlot(this.inputEl, f.input);
    this._paintSlot(this.fuelEl, f.fuel);
    this._paintSlot(this.outputEl, f.output);

    // Flame: visible while burn time remains, height proportional to it.
    const burnFrac = Math.min(1, f.burn / 15);
    this.flameEl.style.opacity = burnFrac > 0 ? '1' : '0.12';
    this.flameEl.style.height = `${Math.round(8 + burnFrac * 20)}px`;
    // Arrow: fills left to right with cook progress.
    this.arrowEl.style.width = `${Math.round(f.progress * 100)}%`;

    const cursor = this.inv.cursor;
    this.cursorEl.classList.toggle('hidden', !cursor);
    if (cursor) {
      this.cursorEl.querySelector('img').src = iconForSlot(cursor.id);
      this.cursorEl.querySelector('.count').textContent = cursor.count > 1 ? cursor.count : '';
    }
  }

  _paintSlot(el, stack) {
    el.innerHTML = '';
    if (!stack) return;
    const img = document.createElement('img');
    img.src = iconForSlot(stack.id);
    img.alt = '';
    img.draggable = false;
    el.appendChild(img);
    if (stack.count > 1) {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(stack.count);
      el.appendChild(count);
    }
  }
}
