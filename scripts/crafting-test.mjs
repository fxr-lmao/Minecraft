// Unit tests for the crafting system: grid mechanics, recipe matching,
// crafting consumption, and the 2x2/3x3 split.

import { CraftingGrid, GRID_2X2, GRID_3X3, matchRecipe, craft, recipeName } from '../src/crafting.js';
import { PLANKS, LOG, COBBLESTONE, SAND, CRAFTING_TABLE, FURNACE, GLASS } from '../src/terrain.js';
import { STICKS, WOOD_PICKAXE, WOOD_SHOVEL } from '../src/items.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// ---- grid basics ----
const g = new CraftingGrid(GRID_2X2);
check('2x2 grid starts empty', g.filled === 0 && g.rows === 2 && g.cols === 2);
g.set(0, 0, { id: LOG, count: 1 });
check('set/get round trip', g.get(0, 0)?.id === LOG && g.filled === 1);
g.set(0, 0, null);
check('null clears a cell', g.filled === 0);

// ---- planks from log (shapeless) ----
const p = new CraftingGrid(GRID_2X2);
p.set(1, 1, { id: LOG, count: 2 });
check('shapeless: a log anywhere makes planks', recipeName(p) === 'Oak Planks');
const made = craft(p, matchRecipe(p), 1);
check('craft consumes one log', p.filled === 1 && p.items()[0].count === 1);
check('craft outputs four planks', made.id === PLANKS && made.count === 4);

// ---- sticks (shaped, vertical pair) ----
const s = new CraftingGrid(GRID_2X2);
s.set(0, 0, { id: PLANKS, count: 1 });
s.set(1, 0, { id: PLANKS, count: 1 });
check('two planks stacked make sticks', recipeName(s) === 'Sticks');
const sticks = craft(s, matchRecipe(s), 1);
check('sticks output four', sticks.id === STICKS && sticks.count === 4);
check('sticks consumed both inputs', s.filled === 0);

// ---- wrong arrangements match nothing ----
const bad = new CraftingGrid(GRID_2X2);
bad.set(0, 0, { id: PLANKS, count: 1 });
bad.set(0, 1, { id: PLANKS, count: 1 });
check('side-by-side planks are not sticks', recipeName(bad) === '');
bad.set(1, 1, { id: SAND, count: 1 });
check('junk in the grid matches nothing', recipeName(bad) === '');

// ---- crafting table (2x2 all planks) ----
const t = new CraftingGrid(GRID_2X2);
t.set(0, 0, { id: PLANKS, count: 1 });
t.set(0, 1, { id: PLANKS, count: 1 });
t.set(1, 0, { id: PLANKS, count: 1 });
t.set(1, 1, { id: PLANKS, count: 1 });
check('2x2 planks make a crafting table', recipeName(t) === 'Crafting Table');
const table = craft(t, matchRecipe(t), 1);
check('crafting table output', table.id === CRAFTING_TABLE && table.count === 1);

// ---- glass (2x2 sand) ----
const gl = new CraftingGrid(GRID_2X2);
for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) gl.set(r, c, { id: SAND, count: 1 });
check('2x2 sand makes glass', recipeName(gl) === 'Glass');
const glass = craft(gl, matchRecipe(gl), 1);
check('glass output four', glass.id === GLASS && glass.count === 4);

// ---- 3x3-only recipes ----
const g3 = new CraftingGrid(GRID_3X3);
check('3x3 grid starts empty', g3.filled === 0 && g3.rows === 3);
g3.set(0, 0, { id: COBBLESTONE, count: 1 });
g3.set(0, 1, { id: COBBLESTONE, count: 1 });
g3.set(0, 2, { id: COBBLESTONE, count: 1 });
g3.set(1, 0, { id: COBBLESTONE, count: 1 });
g3.set(1, 2, { id: COBBLESTONE, count: 1 });
g3.set(2, 0, { id: COBBLESTONE, count: 1 });
g3.set(2, 1, { id: COBBLESTONE, count: 1 });
g3.set(2, 2, { id: COBBLESTONE, count: 1 });
check('8 cobblestone in a ring make a furnace', recipeName(g3) === 'Furnace');
const furnace = craft(g3, matchRecipe(g3), 1);
check('furnace output', furnace.id === FURNACE && furnace.count === 1);

// ---- wooden pickaxe needs the 3x3 ----
const pick = new CraftingGrid(GRID_3X3);
pick.set(0, 0, { id: PLANKS, count: 1 });
pick.set(0, 1, { id: PLANKS, count: 1 });
pick.set(0, 2, { id: PLANKS, count: 1 });
pick.set(1, 1, { id: STICKS, count: 1 });
pick.set(2, 1, { id: STICKS, count: 1 });
check('planks+sticks make a wooden pickaxe', recipeName(pick) === 'Wooden Pickaxe');
const wp = craft(pick, matchRecipe(pick), 1);
check('wooden pickaxe output', wp.id === WOOD_PICKAXE && wp.count === 1);

// ---- ...but not in the 2x2 ----
const pick2 = new CraftingGrid(GRID_2X2);
pick2.set(0, 0, { id: PLANKS, count: 1 });
pick2.set(0, 1, { id: PLANKS, count: 1 });
pick2.set(1, 0, { id: STICKS, count: 1 });
check('2x2 cannot make a pickaxe', recipeName(pick2) === '');

// ---- shovel ----
const sh = new CraftingGrid(GRID_3X3);
sh.set(0, 1, { id: PLANKS, count: 1 });
sh.set(1, 1, { id: STICKS, count: 1 });
sh.set(2, 1, { id: STICKS, count: 1 });
check('plank + two sticks make a wooden shovel', recipeName(sh) === 'Wooden Shovel');
const ws = craft(sh, matchRecipe(sh), 1);
check('wooden shovel output', ws.id === WOOD_SHOVEL && ws.count === 1);

// ---- resize keeps contents (crafting table 3x3 from 2x2) ----
const r = new CraftingGrid(GRID_2X2);
r.set(0, 0, { id: PLANKS, count: 1 });
r.set(0, 1, { id: PLANKS, count: 1 });
r.resize(GRID_3X3);
check('resize to 3x3 keeps the planks', r.get(0, 0)?.id === PLANKS && r.get(0, 1)?.id === PLANKS);
check('resize leaves new cells empty', r.filled === 2);
const big = matchRecipe(r);
check('2 planks in a 3x3 match nothing', big === null);

// ---- craft multiple at once ----
const multi = new CraftingGrid(GRID_2X2);
multi.set(0, 0, { id: LOG, count: 3 });
const batch = craft(multi, matchRecipe(multi), 2);
check('craft 2 at once consumes 2', multi.items()[0].count === 1);
check('craft 2 at once outputs 8', batch.id === PLANKS && batch.count === 8);

// ---- resize keeps every cell where it was, not just the first row ----
// The naive version read the old array at the *new* stride, which happened
// to be right for two items in row 0 and wrong for everything else.
const rr = new CraftingGrid(GRID_2X2);
rr.set(0, 0, { id: PLANKS, count: 1 });
rr.set(1, 0, { id: PLANKS, count: 1 }); // the Sticks recipe: a vertical pair
check('sticks match in a 2x2', recipeName(rr) === 'Sticks');
rr.resize(GRID_3X3);
check('resize keeps the lower plank in its own column',
  rr.get(0, 0)?.id === PLANKS && rr.get(1, 0)?.id === PLANKS);
check('resize does not shift a row into the next column', rr.get(0, 2) === null);
check('the recipe survives the resize', recipeName(rr) === 'Sticks');

// ---- shrinking hands back what no longer fits instead of deleting it ----
const shrink = new CraftingGrid(GRID_3X3);
shrink.set(0, 0, { id: PLANKS, count: 1 });
shrink.set(2, 2, { id: LOG, count: 5 });
shrink.set(0, 2, { id: SAND, count: 3 });
const dropped = shrink.resize(GRID_2X2);
check('shrink keeps the cell that still exists', shrink.get(0, 0)?.id === PLANKS);
check('shrink returns the cells that do not', dropped.length === 2);
check('shrink returns the actual stacks',
  dropped.some((d) => d.id === LOG && d.count === 5)
  && dropped.some((d) => d.id === SAND && d.count === 3));
check('shrink leaves nothing behind in the dropped cells', shrink.filled === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
