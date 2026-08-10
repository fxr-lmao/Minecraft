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

const iconCache = new Map();

function iconFor(id) {
  if (!iconCache.has(id)) {
    const def = getBlockDefById(id);
    iconCache.set(id, def ? getBlockAssets(def).iconUrl : '');
  }
  return iconCache.get(id);
}

function makeSlotEl(index, extraClass) {
  const el = document.createElement('div');
  el.className = `slot${extraClass ? ' ' + extraClass : ''}`;
  el.dataset.slot = String(index);
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  const count = document.createElement('span');
  count.className = 'count';
  el.append(img, count);
  return { el, img, count };
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

    this._buildHotbar();
    this._buildScreen();
    this._bindEvents();
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

  _bindEvents() {
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
