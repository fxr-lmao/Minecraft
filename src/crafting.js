// Crafting: recipe table, a 2x2 (inventory) / 3x3 (crafting table) grid,
// and the matching + consumption rules. Pure data and logic — no DOM, no
// THREE — so the recipes are unit-testable in Node.
//
// Recipes are shaped (a pattern of letters mapping through `key` to block
// ids, tried at every placement) or shapeless (just a set of required ids).
// The grid is a small array of stacks; a recipe wins when its pattern fits
// exactly with nothing left over.

import { PLANKS, LOG, COBBLESTONE, SAND, STONE } from './terrain.js';
import { STICKS, WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL } from './items.js';
import { CRAFTING_TABLE, FURNACE, GLASS, TNT } from './blocks-extra.js';

export const GRID_2X2 = { rows: 2, cols: 2 };
export const GRID_3X3 = { rows: 3, cols: 3 };

/**
 * A stack in a crafting cell: { id, count }. Cells are null when empty.
 */
export class CraftingGrid {
  constructor(size = GRID_2X2) {
    this.rows = size.rows;
    this.cols = size.cols;
    this.cells = new Array(this.rows * this.cols).fill(null);
  }

  /**
   * Resize between the 2x2 inventory grid and the 3x3 crafting table,
   * keeping every stack at the (row, column) it was already in.
   *
   * The old and the new grid have different strides, so the copy has to read
   * with the *old* one — reading the old array at the new stride is how you
   * get planks that teleport a cell to the right when the table opens.
   *
   * Shrinking drops cells that no longer exist. Those stacks are returned
   * rather than thrown away, so the caller can put them back in the player's
   * inventory instead of deleting whatever was in the far column.
   */
  resize(size) {
    const oldCells = this.cells;
    const oldRows = this.rows;
    const oldCols = this.cols;
    this.rows = size.rows;
    this.cols = size.cols;
    this.cells = new Array(this.rows * this.cols).fill(null);

    const keptRows = Math.min(oldRows, this.rows);
    const keptCols = Math.min(oldCols, this.cols);
    for (let r = 0; r < keptRows; r++) {
      for (let c = 0; c < keptCols; c++) {
        this.cells[r * this.cols + c] = oldCells[r * oldCols + c] ?? null;
      }
    }

    const displaced = [];
    for (let r = 0; r < oldRows; r++) {
      for (let c = 0; c < oldCols; c++) {
        if (r < keptRows && c < keptCols) continue;
        const cell = oldCells[r * oldCols + c];
        if (cell && cell.count > 0) displaced.push(cell);
      }
    }
    return displaced;
  }

  get(r, c) {
    return (r >= 0 && r < this.rows && c >= 0 && c < this.cols)
      ? this.cells[r * this.cols + c] : null;
  }

  set(r, c, stack) {
    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
      this.cells[r * this.cols + c] = stack && stack.count > 0 ? stack : null;
    }
  }

  clear() {
    this.cells.fill(null);
  }

  /** Non-empty cells, for shapeless matching and counts. */
  items() {
    return this.cells.filter((c) => c && c.count > 0);
  }

  /** Total number of cells that hold something. */
  get filled() {
    return this.items().length;
  }
}

// ------------------------------------------------------------------ recipes

export const RECIPES = [
  {
    name: 'Oak Planks',
    shaped: false,
    inputs: [LOG],
    out: { id: PLANKS, count: 4 },
  },
  {
    name: 'Sticks',
    shaped: true,
    pattern: ['P', 'P'],
    key: { P: PLANKS },
    out: { id: STICKS, count: 4 },
  },
  {
    name: 'Crafting Table',
    shaped: true,
    pattern: ['PP', 'PP'],
    key: { P: PLANKS },
    out: { id: CRAFTING_TABLE, count: 1 },
  },
  {
    name: 'Furnace',
    shaped: true,
    pattern: ['CCC', 'C C', 'CCC'],
    key: { C: COBBLESTONE },
    out: { id: FURNACE, count: 1 },
  },
  {
    name: 'Wooden Pickaxe',
    shaped: true,
    pattern: ['PPP', ' S ', ' S '],
    key: { P: PLANKS, S: STICKS },
    out: { id: WOOD_PICKAXE, count: 1 },
  },
  {
    name: 'Wooden Shovel',
    shaped: true,
    pattern: ['P', 'S', 'S'],
    key: { P: PLANKS, S: STICKS },
    out: { id: WOOD_SHOVEL, count: 1 },
  },
  {
    name: 'Stone Pickaxe',
    shaped: true,
    pattern: ['SSS', ' T ', ' T '],
    key: { S: STONE, T: STICKS },
    out: { id: STONE_PICKAXE, count: 1 },
  },
  {
    name: 'Stone Shovel',
    shaped: true,
    pattern: ['S', 'T', 'T'],
    key: { S: STONE, T: STICKS },
    out: { id: STONE_SHOVEL, count: 1 },
  },
  {
    name: 'Glass',
    shaped: true,
    pattern: ['SS', 'SS'],
    key: { S: SAND },
    out: { id: GLASS, count: 4 },
  },
  {
    // Sand in the corners with a stick for the fuse — TNT's own recipe
    // shape (4 sand + 5 gunpowder) with the fuse standing in for the
    // gunpowder this world does not have.
    name: 'TNT',
    shaped: true,
    pattern: ['S S', ' T ', 'S S'],
    key: { S: SAND, T: STICKS },
    out: { id: TNT, count: 1 },
  },
];

/** Count how many of each id a shapeless recipe's inputs need. */
function inputCounts(inputs) {
  const m = new Map();
  for (const id of inputs) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** Does a shaped recipe fit the grid? Returns {dr, dc} placement or null. */
function matchShaped(recipe, grid) {
  const pr = recipe.pattern.length;
  const pc = recipe.pattern[0].length;
  for (let dr = 0; dr + pr <= grid.rows; dr++) {
    for (let dc = 0; dc + pc <= grid.cols; dc++) {
      let ok = true;
      for (let r = 0; r < grid.rows && ok; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const cell = grid.get(r, c);
          const inPattern = r >= dr && r < dr + pr && c >= dc && c < dc + pc;
          const ch = inPattern ? recipe.pattern[r - dr][c - dc] : ' ';
          if (ch === ' ') {
            if (cell) { ok = false; break; }
          } else {
            const need = recipe.key[ch];
            if (!cell || cell.id !== need) { ok = false; break; }
          }
        }
      }
      if (ok) return { dr, dc };
    }
  }
  return null;
}

/** Does a shapeless recipe match (exact multiset of ids)? */
function matchShapeless(recipe, grid) {
  const items = grid.items();
  if (items.length !== recipe.inputs.length) return false;
  const need = inputCounts(recipe.inputs);
  for (const item of items) {
    const have = need.get(item.id);
    if (!have) return false;
    need.set(item.id, have - 1);
  }
  for (const n of need.values()) if (n !== 0) return false;
  return true;
}

/** The recipe the grid currently forms, or null. */
export function matchRecipe(grid) {
  for (const recipe of RECIPES) {
    if (recipe.disabled) continue;
    const ok = recipe.shaped ? matchShaped(recipe, grid) : matchShapeless(recipe, grid);
    if (ok) return recipe;
  }
  return null;
}

/**
 * Perform the craft: consume every occupied cell and return the output
 * stack. `maxCrafts` limits how many at once (e.g. 1 per click).
 */
export function craft(grid, recipe, maxCrafts = 1) {
  if (!recipe) return null;
  // How many times can we craft from the current contents?
  let times = Infinity;
  for (const cell of grid.items()) {
    times = Math.min(times, cell.count);
  }
  times = Math.min(times, maxCrafts);
  if (!Number.isFinite(times) || times <= 0) return null;

  for (const cell of grid.items()) {
    cell.count -= times;
  }
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.get(r, c);
      if (cell && cell.count <= 0) grid.set(r, c, null);
    }
  }
  return { id: recipe.out.id, count: recipe.out.count * times };
}

/** Display name of the recipe that matches a grid, or '' if none. */
export function recipeName(grid) {
  return matchRecipe(grid)?.name ?? '';
}
