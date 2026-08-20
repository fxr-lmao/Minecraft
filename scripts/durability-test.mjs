// Unit tests for tool durability: initial values, spending, breaking, and
// the HUD fraction.

import { PICKAXE, SHOVEL, WOOD_PICKAXE } from '../src/items.js';
import {
  maxDurability, freshDurability, durabilityOf, durabilityFraction,
  spendDurability, isTool, ensureDurability,
} from '../src/durability.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// ---- known numbers ----
check('wood tools have 59 uses (Minecraft)', maxDurability(WOOD_PICKAXE) === 59);
check('iron tools have 250 uses (Minecraft)', maxDurability(PICKAXE) === 250);
check('non-tools have no durability', maxDurability(3) === undefined);
check('isTool only for tools', isTool(PICKAXE) && !isTool(3));

// ---- fresh stacks ----
const fresh = { id: PICKAXE, count: 1 };
check('fresh stack is full', durabilityOf(fresh) === 250);
check('fresh stack fraction is 1', durabilityFraction(fresh) === 1);

// ---- ensureDurability stamps the field ----
const stamped = ensureDurability(fresh);
check('ensureDurability adds the field', stamped.durability === 250);
check('non-tool untouched', ensureDurability({ id: 3, count: 1 }).durability === undefined);

// ---- spending ----
let tool = { id: PICKAXE, count: 1, durability: 250 };
let out = spendDurability(tool);
check('one use costs one durability', out.stack.durability === 249 && !out.broke);

for (let i = 0; i < 248; i++) out = spendDurability(out.stack);
check('after 249 uses there is one left', out.stack.durability === 1 && !out.broke);

out = spendDurability(out.stack);
check('the 250th use breaks the tool', out.broke && out.stack === null);

// ---- non-tool stacks never break ----
const block = { id: 3, count: 64 };
out = spendDurability(block);
check('blocks ignore durability', out.stack === block && !out.broke);

// ---- fraction ----
const worn = { id: SHOVEL, count: 1, durability: 125 };
check('half durability shows half', Math.abs(durabilityFraction(worn) - 0.5) < 1e-9);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
