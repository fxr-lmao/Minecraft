// Crafting: recipe table, a 2x2 (inventory) / 3x3 (crafting table) grid,
// and the matching + consumption rules. Pure data and logic — no DOM, no
// THREE — so the recipes are unit-testable in Node.
//
// Recipes are shaped (a pattern of letters mapping through `key` to block
// ids, tried at every placement) or shapeless (just a set of required ids).
// The grid is a small array of stacks; a recipe wins when its pattern fits
// exactly with nothing left over.

import { PLANKS, LOG, COBBLESTONE, SAND, STONE } from './terrain.js';
import {
  STICKS, WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL,
  WOOD_AXE, STONE_AXE, IRON_AXE, DIAMOND_AXE,
  WOOD_SWORD, STONE_SWORD, IRON_SWORD, DIAMOND_SWORD,
  PICKAXE, SHOVEL, DIAMOND_PICKAXE, DIAMOND_SHOVEL,
  IRON_INGOT, DIAMOND, COAL, GUNPOWDER,
  BOW, ARROW, STRING, FEATHER,
  GOLDEN_APPLE, LEATHER, APPLE,
  IRON_HELMET, IRON_CHESTPLATE, IRON_LEGGINGS, IRON_BOOTS,
  DIAMOND_HELMET, DIAMOND_CHESTPLATE, DIAMOND_LEGGINGS, DIAMOND_BOOTS,
  GOLD_HELMET, GOLD_CHESTPLATE, GOLD_LEGGINGS, GOLD_BOOTS,
  LEATHER_HELMET, LEATHER_CHESTPLATE, LEATHER_LEGGINGS, LEATHER_BOOTS,
  GOLD_INGOT,
  TIER_WOOD, TIER_STONE, TIER_IRON, TIER_DIAMOND,
} from './items.js';
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
  // ------------------------------------------------------------- tool tiers
  //
  // Four shapes times four tiers is sixteen recipes, and writing sixteen of
  // them out by hand is sixteen chances to put the sticks in the wrong cell.
  // They are generated from one table instead, below the literal recipes, and
  // spliced in at the end of this array — the shapes are Minecraft's exactly:
  //
  //   pickaxe  MMM / .S. / .S.
  //   axe      MM. / MS. / .S.
  //   shovel   M / S / S
  //   sword    M / M / S
  //
  // The axe pattern is the one worth checking against the real game: it is
  // asymmetric, and a symmetric version of it is a different recipe that
  // makes nothing.
  {
    name: 'Glass',
    shaped: true,
    pattern: ['SS', 'SS'],
    key: { S: SAND },
    out: { id: GLASS, count: 4 },
  },
  {
    // Minecraft's own TNT, at last: gunpowder in an X through four sand.
    // For a long time this was sand with a stick for the fuse — a stand-in
    // for the gunpowder the world did not have — and now the world has it,
    // because creepers carry it. The loop that closes here is the neat
    // part: the only way to get gunpowder is to fight the thing that
    // explodes, so the recipe for making explosions is a reward for
    // surviving one.
    name: 'TNT',
    shaped: true,
    pattern: ['GSG', 'SGS', 'GSG'],
    key: { G: GUNPOWDER, S: SAND },
    out: { id: TNT, count: 1 },
  },
  // ------------------------------------------------------- the ranged tier
  //
  // The bow and its arrows are the other half of the combat the skeletons
  // brought with them: they shoot, so you shoot back. The bow is Minecraft's
  // ">" of string and sticks — three string down the left, two sticks on the
  // right diagonals. An arrow is the vertical stack of string, stick and
  // feather, and it makes four at once, because one arrow is a thing you run
  // out of mid-fight and four is a quiver.
  {
    name: 'Bow',
    shaped: true,
    pattern: ['ST ', 'S T', 'ST '],
    key: { S: STRING, T: STICKS },
    out: { id: BOW, count: 1 },
  },
  {
    name: 'Arrow',
    shaped: true,
    pattern: ['S', 'T', 'F'],
    key: { S: STRING, T: STICKS, F: FEATHER },
    out: { id: ARROW, count: 4 },
  },
  {
    // A golden apple: an apple in the middle, eight gold ingots around it.
    // The one food that heals as well as feeds, and the reason gold ingots
    // have a use beyond decoration.
    name: 'Golden Apple',
    shaped: true,
    pattern: ['GGG', 'GAG', 'GGG'],
    key: { G: GOLD_INGOT, A: APPLE },
    out: { id: GOLDEN_APPLE, count: 1 },
  },
];

// ------------------------------------------------------- generated tool set

/**
 * What each tier is made of. Wood and stone come from the world directly;
 * iron and diamond come from the mine, which is the whole point of the
 * material items — a tier is a *supply chain*, not a menu entry.
 */
export const TIER_MATERIALS = {
  [TIER_WOOD]: [PLANKS],
  /**
   * Two of them, and this is not a shortcut.
   *
   * Minecraft makes stone tools out of *cobblestone*, and the two recipes
   * already written by hand above make them out of smooth stone — because
   * when they were written the only way to get stone was to smelt cobble, so
   * the recipe was the reason the furnace existed. Both are now true: cobble
   * comes straight out of the ground and stone comes out of the furnace, and
   * a stone axe should not be pickier about its material than a stone
   * pickaxe is. So the tier takes either, and the generator emits a recipe
   * for each.
   */
  [TIER_STONE]: [COBBLESTONE, STONE],
  [TIER_IRON]: [IRON_INGOT],
  [TIER_DIAMOND]: [DIAMOND],
};

/**
 * Minecraft's four tool patterns. `M` is the tier's material and `S` is a
 * stick, in every one of them.
 */
export const TOOL_PATTERNS = {
  pickaxe: ['MMM', '.S.', '.S.'],
  axe: ['MM.', 'MS.', '.S.'],
  shovel: ['M', 'S', 'S'],
  sword: ['M', 'M', 'S'],
};

/** Which item each (shape, tier) pair produces. */
export const TOOL_OUTPUTS = {
  pickaxe: {
    [TIER_WOOD]: WOOD_PICKAXE,
    [TIER_STONE]: STONE_PICKAXE,
    [TIER_IRON]: PICKAXE,
    [TIER_DIAMOND]: DIAMOND_PICKAXE,
  },
  shovel: {
    [TIER_WOOD]: WOOD_SHOVEL,
    [TIER_STONE]: STONE_SHOVEL,
    [TIER_IRON]: SHOVEL,
    [TIER_DIAMOND]: DIAMOND_SHOVEL,
  },
  axe: {
    [TIER_WOOD]: WOOD_AXE,
    [TIER_STONE]: STONE_AXE,
    [TIER_IRON]: IRON_AXE,
    [TIER_DIAMOND]: DIAMOND_AXE,
  },
  sword: {
    [TIER_WOOD]: WOOD_SWORD,
    [TIER_STONE]: STONE_SWORD,
    [TIER_IRON]: IRON_SWORD,
    [TIER_DIAMOND]: DIAMOND_SWORD,
  },
};

const TIER_LABELS = {
  [TIER_WOOD]: 'Wooden',
  [TIER_STONE]: 'Stone',
  [TIER_IRON]: 'Iron',
  [TIER_DIAMOND]: 'Diamond',
};

const SHAPE_LABELS = {
  pickaxe: 'Pickaxe', shovel: 'Shovel', axe: 'Axe', sword: 'Sword',
};

/**
 * Every tool recipe, generated.
 *
 * A `.` in a pattern is an empty cell; the matcher already reads ' ' that
 * way, so the dots are translated on the way out. Dots rather than spaces in
 * the source because a trailing space in a string literal is invisible and
 * this file has already lost an afternoon to one.
 */
export function buildToolRecipes() {
  const out = [];
  for (const [shape, pattern] of Object.entries(TOOL_PATTERNS)) {
    for (const [tier, materials] of Object.entries(TIER_MATERIALS)) {
      const id = TOOL_OUTPUTS[shape][tier];
      if (id === undefined) continue;
      for (const material of materials) {
        // Skip any (output, material) pair already written out by hand above,
        // so the wooden and stone pickaxes/shovels keep their original
        // entries and there is never a pair of identical recipes competing
        // for the same grid.
        const already = RECIPES.some(
          (r) => r.out.id === id && r.shaped && Object.values(r.key).includes(material)
        );
        if (already) continue;
        out.push({
          name: `${TIER_LABELS[tier]} ${SHAPE_LABELS[shape]}`,
          shaped: true,
          pattern: pattern.map((row) => row.replace(/\./g, ' ')),
          key: { M: material, S: STICKS },
          out: { id, count: 1 },
        });
      }
    }
  }
  return out;
}

/**
 * Minecraft's four armour patterns — the helmet is the odd one out, a row
 * across the top and one down each side; the chestplate is a filled coat;
 * the leggings and boots are the coat with pieces cut out of the bottom.
 */
const ARMOUR_PATTERNS = {
  helmet: ['MMM', 'M M'],
  chestplate: ['M M', 'MMM', 'MMM'],
  leggings: ['MMM', 'M M', 'M M'],
  boots: ['M M', 'M M'],
};

/** Which item each (piece, material) pair produces. */
const ARMOUR_OUTPUTS = {
  helmet: { [LEATHER]: LEATHER_HELMET, [IRON_INGOT]: IRON_HELMET, [GOLD_INGOT]: GOLD_HELMET, [DIAMOND]: DIAMOND_HELMET },
  chestplate: { [LEATHER]: LEATHER_CHESTPLATE, [IRON_INGOT]: IRON_CHESTPLATE, [GOLD_INGOT]: GOLD_CHESTPLATE, [DIAMOND]: DIAMOND_CHESTPLATE },
  leggings: { [LEATHER]: LEATHER_LEGGINGS, [IRON_INGOT]: IRON_LEGGINGS, [GOLD_INGOT]: GOLD_LEGGINGS, [DIAMOND]: DIAMOND_LEGGINGS },
  boots: { [LEATHER]: LEATHER_BOOTS, [IRON_INGOT]: IRON_BOOTS, [GOLD_INGOT]: GOLD_BOOTS, [DIAMOND]: DIAMOND_BOOTS },
};

const ARMOUR_LABELS = {
  helmet: 'Helmet', chestplate: 'Chestplate', leggings: 'Leggings', boots: 'Boots',
};

/**
 * Every armour recipe, generated: four pieces across four materials. The
 * patterns are Minecraft's exactly, so a helmet is three across the top and
 * the sides, and a chestplate is a coat with a head-hole in it.
 */
export function buildArmourRecipes() {
  const out = [];
  const labels = {
    [LEATHER]: 'Leather', [IRON_INGOT]: 'Iron',
    [GOLD_INGOT]: 'Gold', [DIAMOND]: 'Diamond',
  };
  for (const [piece, pattern] of Object.entries(ARMOUR_PATTERNS)) {
    for (const [material, id] of Object.entries(ARMOUR_OUTPUTS[piece])) {
      const m = Number(material);
      out.push({
        name: `${labels[m]} ${ARMOUR_LABELS[piece]}`,
        shaped: true,
        pattern: pattern.map((row) => row.replace(/\./g, ' ')),
        key: { M: m },
        out: { id, count: 1 },
      });
    }
  }
  return out;
}

RECIPES.push(...buildToolRecipes());
RECIPES.push(...buildArmourRecipes());

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
