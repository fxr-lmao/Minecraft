// DOM for the inventory: the always-visible 9-slot hotbar and the 9 x 3
// inventory screen (toggled with E). Works with a mouse, a trackpad and a
// finger — every interaction is a plain pointer event.
//
//   left click / tap  : pick up a stack, or drop the held stack
//   right click       : take half / place one
//   shift + click     : send a stack to the other section
//
// Rendering is a straight redraw of 45 small elements, which is nothing next
// to a frame of voxels, so any change just calls render().

import { HOTBAR_SIZE, MAIN_COLS, MAIN_ROWS, TOTAL_SLOTS, Inventory } from './inventory.js';
import { getBlockAssets, getBlockDefById, blockName } from './textures.js';
import { isTool, durabilityFraction } from './durability.js';
import { GRID_2X2, GRID_3X3, matchRecipe, craft } from './crafting.js';
import * as sound from './sound.js';

const iconCache = new Map();

function iconFor(id) {
  if (!iconCache.has(id)) {
    const def = getBlockDefById(id);
    iconCache.set(id, def ? getBlockAssets(def).iconUrl : '');
  }
  return iconCache.get(id);
}

/** The same icon lookup, shared with the furnace screen. */
export const iconForSlot = iconFor;

function makeSlotEl(index, extraClass) {
  const el = document.createElement('div');
  el.className = `slot${extraClass ? ' ' + extraClass : ''}`;
  el.dataset.slot = String(index);
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  const count = document.createElement('span');
  count.className = 'count';
  // A tiny durability bar along the bottom of the slot, shown only for tools.
  const dura = document.createElement('i');
  dura.className = 'dura';
  const duraFill = document.createElement('b');
  duraFill.className = 'dura-fill';
  dura.appendChild(duraFill);
  el.append(img, count, dura);
  return { el, img, count, dura, duraFill };
}

export class InventoryUI {
  /**
   * @param {Inventory} inventory
   * @param {(open: boolean) => void} onToggle called when the screen opens/closes
   */
  constructor(inventory, onToggle = () => {}) {
    this.inv = inventory;
    this.onToggle = onToggle;
    this.isOpen = false;

    this.hotbarEl = document.getElementById('hotbar');
    this.screenEl = document.getElementById('inventory');
    this.mainGridEl = document.getElementById('inv-main');
    this.rowEl = document.getElementById('inv-hotbar');
    this.cursorEl = document.getElementById('cursor-stack');
    this.nameEl = document.getElementById('held-name');

    this.hotbarViews = [];
    this.screenViews = new Array(TOTAL_SLOTS);
    /** Crafting grid cell views, rebuilt when the grid resizes. */
    this.craftViews = [];

    this._buildHotbar();
    this._buildScreen();
    this._buildCraftGrid();
    this._bindEvents();
    this.render();
  }

  /**
   * Resize the crafting grid between the 2x2 player inventory and the 3x3
   * crafting table. The grid model keeps its contents; only the DOM and the
   * size change.
   */
  setCraftingSize(rows, cols) {
    const size = { rows, cols };
    const target = rows === 3 ? GRID_3X3 : GRID_2X2;
    if (this.inv.craftGrid.rows === rows && this.inv.craftGrid.cols === cols) return;
    // Shrinking the grid hands back whatever was in the cells that no longer
    // exist; those go to the inventory rather than being deleted.
    for (const stack of this.inv.craftGrid.resize(target)) {
      this.inv.add(stack.id, stack.count);
    }
    this._buildCraftGrid();
    this.render();
  }

  _buildHotbar() {
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const view = makeSlotEl(i);
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      view.el.appendChild(key);
      this.hotbarViews.push(view);
      this.hotbarEl.appendChild(view.el);
    }
  }

  _buildScreen() {
    this.mainGridEl.innerHTML = '';
    this.rowEl.innerHTML = '';
    // 9 x 3 main grid: slots 9..35
    for (let r = 0; r < MAIN_ROWS; r++) {
      for (let c = 0; c < MAIN_COLS; c++) {
        const index = HOTBAR_SIZE + r * MAIN_COLS + c;
        const view = makeSlotEl(index);
        this.screenViews[index] = view;
        this.mainGridEl.appendChild(view.el);
      }
    }
    // hotbar row inside the screen: slots 0..8
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const view = makeSlotEl(i, 'hotbar-slot');
      this.screenViews[i] = view;
      this.rowEl.appendChild(view.el);
    }
  }

  /** Build (or rebuild) the crafting grid cells from the model's size. */
  _buildCraftGrid() {
    const host = document.getElementById('craft-grid');
    if (!host) return;
    host.innerHTML = '';
    host.style.gridTemplateColumns = `repeat(${this.inv.craftGrid.cols}, auto)`;
    this.craftViews = [];
    for (let r = 0; r < this.inv.craftGrid.rows; r++) {
      for (let c = 0; c < this.inv.craftGrid.cols; c++) {
        const view = makeSlotEl(r * this.inv.craftGrid.cols + c, 'craft-slot');
        view.el.dataset.craft = `${r},${c}`;
        host.appendChild(view.el);
        this.craftViews.push(view);
      }
    }
  }

  _bindEvents() {
    // Crafting grid cells: click/tap moves stacks like the rest of the
    // inventory, using a virtual slot index past the real ones.
    const craftGridEl = document.getElementById('craft-grid');
    if (craftGridEl) {
      craftGridEl.addEventListener('pointerdown', (e) => {
        const el = e.target.closest('.slot');
        if (!el || el.dataset.craft === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        const [r, c] = el.dataset.craft.split(',').map(Number);
        this._craftClick(r, c, e.button === 2);
      });
    }

    // Craft result: click to craft once and put the item in your hand.
    const resultEl = document.getElementById('craft-result');
    if (resultEl) {
      resultEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._craftResult(e.button === 2);
      });
    }

    // Selecting a hotbar slot by tapping it (touch / unlocked pointer).
    this.hotbarEl.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.slot');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      this.selectSlot(Number(el.dataset.slot));
    });

    // Slot interaction inside the inventory screen.
    const onSlotDown = (e) => {
      const el = e.target.closest('.slot');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const index = Number(el.dataset.slot);
      if (e.shiftKey) this.inv.quickMove(index);
      else this.inv.clickSlot(index, e.button === 2);
      this._moveCursor(e.clientX, e.clientY);
      this.render();
    };
    this.mainGridEl.addEventListener('pointerdown', onSlotDown);
    this.rowEl.addEventListener('pointerdown', onSlotDown);

    // Backdrop: put the held stack back, or close if the hand is empty.
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
    document.getElementById('inv-close').addEventListener('click', () => this.close());
    document.getElementById('inv-sort')?.addEventListener('click', () => {
      this.inv.sort();
      this.render();
    });
  }

  _moveCursor(x, y) {
    this.cursorEl.style.left = `${x}px`;
    this.cursorEl.style.top = `${y}px`;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.screenEl.classList.remove('hidden');
    this.render();
    this.onToggle(true);
  }

  close() {
    if (!this.isOpen) return;
    this.inv.returnCursor();
    this.isOpen = false;
    this.screenEl.classList.add('hidden');
    this.render();
    this.onToggle(false);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Redraw every slot from the model. */
  render() {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      this._paint(this.hotbarViews[i], this.inv.get(i), i === this.inv.selected);
    }
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      this._paint(this.screenViews[i], this.inv.get(i), Inventory.isHotbar(i) && i === this.inv.selected);
    }
    // Crafting grid cells.
    const grid = this.inv.craftGrid;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const view = this.craftViews[r * grid.cols + c];
        if (view) this._paint(view, grid.get(r, c), false);
      }
    }
    // Craft result: the recipe the grid forms, or empty.
    const recipe = matchRecipe(grid);
    const resultEl = document.getElementById('craft-result');
    if (resultEl) {
      if (recipe) {
        this._paint(this._resultView ?? (this._resultView = makeSlotEl(-1)), { id: recipe.out.id, count: recipe.out.count }, true);
        resultEl.innerHTML = '';
        resultEl.appendChild(this._resultView.el);
        resultEl.classList.add('can-craft');
      } else {
        resultEl.innerHTML = '';
        resultEl.classList.remove('can-craft');
      }
    }

    const cursor = this.inv.cursor;
    this.cursorEl.classList.toggle('hidden', !cursor);
    if (cursor) {
      this.cursorEl.querySelector('img').src = iconFor(cursor.id);
      this.cursorEl.querySelector('.count').textContent = cursor.count > 1 ? cursor.count : '';
    }

  }

  _paint(view, stack, selected) {
    if (!view) return;
    view.el.classList.toggle('selected', Boolean(selected));
    view.el.classList.toggle('empty', !stack);
    if (stack) {
      view.img.src = iconFor(stack.id);
      view.img.style.display = '';
      view.count.textContent = stack.count > 1 ? String(stack.count) : '';
    } else {
      view.img.removeAttribute('src');
      view.img.style.display = 'none';
      view.count.textContent = '';
    }
    // Durability bar under any tool: green while healthy, amber below half,
    // red when nearly spent.
    if (view.dura && stack && isTool(stack.id)) {
      const frac = durabilityFraction(stack);
      view.dura.style.display = '';
      view.duraFill.style.width = `${Math.round(frac * 100)}%`;
      view.duraFill.style.background = frac > 0.5 ? '#3fbf3f' : frac > 0.2 ? '#d9a020' : '#d03030';
    } else if (view.dura) {
      view.dura.style.display = 'none';
    }
  }

  /**
   * Click a crafting cell: pick up / place stacks like inventory slots, but
   * routed through the crafting grid model.
   */
  _craftClick(r, c, half) {
    const grid = this.inv.craftGrid;
    const cell = grid.get(r, c);
    if (!this.inv.cursor) {
      if (!cell) return;
      if (half) {
        const take = Math.ceil(cell.count / 2);
        this.inv.cursor = { id: cell.id, count: take };
        cell.count -= take;
        if (cell.count <= 0) grid.set(r, c, null);
      } else {
        this.inv.cursor = cell;
        grid.set(r, c, null);
      }
    } else if (!cell) {
      const move = half ? 1 : this.inv.cursor.count;
      grid.set(r, c, { id: this.inv.cursor.id, count: move });
      this.inv.cursor.count -= move;
      if (this.inv.cursor.count <= 0) this.inv.cursor = null;
    } else if (cell.id === this.inv.cursor.id) {
      const space = 64 - cell.count;
      if (space <= 0) return;
      const move = Math.min(space, half ? 1 : this.inv.cursor.count);
      cell.count += move;
      this.inv.cursor.count -= move;
      if (this.inv.cursor.count <= 0) this.inv.cursor = null;
    } else if (!half) {
      grid.set(r, c, this.inv.cursor);
      this.inv.cursor = cell;
    }
    this._moveCursorToCursor();
    this.render();
  }

  /**
   * Click the result slot: craft one and put the output in the cursor
   * (merging if it matches). Nothing happens when the grid does not form a
   * recipe, or when the output has nowhere to go.
   */
  _craftResult() {
    const grid = this.inv.craftGrid;
    const recipe = matchRecipe(grid);
    if (!recipe) return;

    // Make sure the output has somewhere to go *before* consuming inputs:
    // either an empty hand, a matching partial stack, or a free inventory
    // slot. Otherwise the craft would eat the ingredients and vanish.
    const out = { id: recipe.out.id, count: recipe.out.count };
    if (this.inv.cursor && this.inv.cursor.id !== out.id) {
      // Cursor is busy; the output must fit in the inventory instead.
      if (this.inv.countOf(out.id) % 64 + out.count > 64 && !this.inv.slots.some((s) => !s)) {
        return;
      }
    } else if (this.inv.cursor && this.inv.cursor.id === out.id) {
      if (this.inv.cursor.count + out.count > 64) return;
    }

    const made = craft(grid, recipe, 1);
    if (!made) return;

    if (this.inv.cursor && this.inv.cursor.id === made.id) {
      this.inv.cursor.count += made.count;
    } else if (!this.inv.cursor) {
      this.inv.cursor = { id: made.id, count: made.count };
    } else {
      this.inv.add(made.id, made.count);
    }
    sound.playBlockPlace(made.id);
    this.render();
  }

  /** Keep the cursor stack visually glued to the pointer when possible. */
  _moveCursorToCursor() {
    // The cursor element follows real pointer events; when a craft happens
    // there is no event, so leave it where it is (it only matters visually).
  }

  /** Flash the held-item name above the hotbar (on selection change). */
  flashName() {
    const held = this.inv.selectedStack();
    this.nameEl.textContent = held ? blockName(held.id) : 'Empty hand';
    this.nameEl.classList.add('show');
    clearTimeout(this._nameTimer);
    this._nameTimer = setTimeout(() => this.nameEl.classList.remove('show'), 1600);
  }

  /** Select a hotbar slot and flash its name. */
  selectSlot(i) {
    if (i === this.inv.selected) return;
    this.inv.select(i);
    this.render();
    this.flashName();
  }

  scrollSelection(dir) {
    this.inv.scroll(dir);
    this.render();
    this.flashName();
  }
}
