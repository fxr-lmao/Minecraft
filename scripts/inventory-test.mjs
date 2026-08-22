// Inventory model: 9 hotbar slots + a 9 x 3 main grid.
// Covers stacking, the pick-up/drop cursor, right-click halves and shift-move.
import { Inventory, HOTBAR_SIZE, MAIN_SIZE, TOTAL_SLOTS, STACK_MAX } from '../src/inventory.js';
import { BUCKET, PICKAXE, SHOVEL, BOW, IRON_HELMET, IRON_CHESTPLATE, COAL } from '../src/items.js';
import { maxDurability } from '../src/durability.js';
import { ARMOUR_SLOTS } from '../src/armour.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

// --- shape ---
{
  const inv = new Inventory();
  assert('9 hotbar slots', HOTBAR_SIZE === 9, HOTBAR_SIZE);
  assert('9 x 3 main grid = 27 slots', MAIN_SIZE === 27, MAIN_SIZE);
  assert('36 slots total', TOTAL_SLOTS === 36 && inv.slots.length === 36, inv.slots.length);
  assert('starts empty', inv.slots.every((s) => s === null));
  assert('slot 0 selected', inv.selected === 0);
}

// --- selection ---
{
  const inv = new Inventory();
  inv.select(5);
  assert('select hotbar slot', inv.selected === 5, inv.selected);
  inv.select(11); // main-grid index: not selectable
  assert('cannot select a main slot', inv.selected === 5, inv.selected);
  inv.selected = 8;
  inv.scroll(1);
  assert('scroll wraps forward', inv.selected === 0, inv.selected);
  inv.scroll(-1);
  assert('scroll wraps backward', inv.selected === 8, inv.selected);
}

// --- adding and stacking ---
{
  const inv = new Inventory();
  assert('add fits', inv.add(1, 10) === 0);
  assert('stack merged', inv.get(0).count === 10, inv.get(0).count);
  inv.add(1, 60);
  assert('overflow spills to the next slot', inv.get(0).count === STACK_MAX && inv.get(1).count === 6,
    `${inv.get(0).count} + ${inv.get(1).count}`);
  assert('countOf sums stacks', inv.countOf(1) === 70, inv.countOf(1));

  const full = new Inventory();
  const left = full.add(3, STACK_MAX * TOTAL_SLOTS + 5);
  assert('add reports what did not fit', left === 5, left);
}

// --- consuming from the hand ---
{
  const inv = new Inventory();
  inv.add(4, 2);
  assert('consume takes one', inv.consumeSelected(1) && inv.get(0).count === 1, inv.get(0)?.count);
  inv.consumeSelected(1);
  assert('empty stack clears the slot', inv.get(0) === null);
  assert('cannot consume an empty slot', inv.consumeSelected(1) === false);
  assert('selectedId is 0 when empty', inv.selectedId() === 0, inv.selectedId());
}

// --- cursor: pick up / drop / swap ---
{
  const inv = new Inventory();
  inv.set(0, { id: 1, count: 20 });
  inv.clickSlot(0);
  assert('left click picks the stack up', inv.cursor?.count === 20 && inv.get(0) === null, inv.cursor?.count);
  inv.clickSlot(9);
  assert('left click drops it in the main grid', inv.get(9)?.count === 20 && inv.cursor === null, inv.get(9)?.count);

  inv.set(0, { id: 2, count: 5 });
  inv.clickSlot(0);
  inv.clickSlot(9);
  assert('different items swap', inv.get(9).id === 2 && inv.cursor.id === 1, `${inv.get(9).id}/${inv.cursor.id}`);
  inv.clickSlot(0);
  assert('cursor emptied into the free slot', inv.get(0).id === 1 && inv.cursor === null);
}

// --- cursor: same item merges, respecting the stack cap ---
{
  const inv = new Inventory();
  inv.set(0, { id: 1, count: 60 });
  inv.set(9, { id: 1, count: 30 });
  inv.clickSlot(9); // pick up 30
  inv.clickSlot(0); // merge into 60 -> 64, 26 left on the cursor
  assert('merge caps at 64', inv.get(0).count === STACK_MAX, inv.get(0).count);
  assert('remainder stays on the cursor', inv.cursor.count === 26, inv.cursor.count);
}

// --- right click: half / one ---
{
  const inv = new Inventory();
  inv.set(0, { id: 1, count: 9 });
  inv.clickSlot(0, true);
  assert('right click takes half (rounded up)', inv.cursor.count === 5 && inv.get(0).count === 4,
    `${inv.cursor.count}/${inv.get(0).count}`);
  inv.clickSlot(20, true);
  assert('right click places one', inv.get(20).count === 1 && inv.cursor.count === 4,
    `${inv.get(20).count}/${inv.cursor.count}`);
}

// --- shift-click between sections ---
{
  const inv = new Inventory();
  inv.set(0, { id: 7, count: 12 });
  assert('quick move leaves the hotbar', inv.quickMove(0) && inv.get(0) === null);
  assert('...and lands in the main grid', inv.get(9)?.count === 12, inv.get(9)?.count);
  assert('quick move comes back', inv.quickMove(9) && inv.get(0)?.count === 12, inv.get(0)?.count);
  assert('quick move on an empty slot does nothing', inv.quickMove(15) === false);
}

// --- closing the screen never eats the held stack ---
{
  const inv = new Inventory();
  inv.set(4, { id: 6, count: 40 });
  inv.clickSlot(4);
  inv.returnCursor();
  assert('cursor returned to the grid', inv.cursor === null && inv.countOf(6) === 40, inv.countOf(6));
}

// --- starter kit ---
{
  const inv = new Inventory();
  inv.fillStarterKit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert('kit fills the hotbar only', inv.slots.slice(0, 9).every((s) => s?.count === STACK_MAX) &&
    inv.slots.slice(9).every((s) => s === null));

  // Items are not blocks and do not come in stacks of sixty-four: a bucket
  // you have 64 of turns into 64 water buckets the first time you dip it.
  const kit = new Inventory();
  kit.fillStarterKit([1, 2, BUCKET, PICKAXE, SHOVEL]);
  assert('blocks come as a stack, tools and buckets come as one',
    kit.get(0).count === STACK_MAX && kit.get(2).count === 1
    && kit.get(3).count === 1 && kit.get(4).count === 1,
    kit.slots.slice(0, 5).map((s) => s && s.count).join(','));
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
// --- sort ---
{
  // Sorting used to reference an unimported `isTool` and threw the moment
  // the button was pressed, so the plain case is worth pinning down.
  const inv = new Inventory();
  inv.slots[5] = { id: 3, count: 10 };
  inv.slots[20] = { id: 1, count: 4 };
  inv.slots[31] = { id: 3, count: 12 };
  inv.sort();
  assert('sort packs to the front', inv.slots[0] && inv.slots[1] && !inv.slots[2]);
  assert('sort merges same ids', inv.countOf(3) === 22, inv.countOf(3));
  assert('sort keeps the other stack', inv.countOf(1) === 4, inv.countOf(1));
}
{
  // Tools carry their own durability, so they must never be folded together.
  const inv = new Inventory();
  inv.slots[0] = { id: PICKAXE, count: 1, durability: 40 };
  inv.slots[9] = { id: PICKAXE, count: 1, durability: 200 };
  inv.slots[17] = { id: SHOVEL, count: 1, durability: 120 };
  inv.sort();
  const picks = inv.slots.filter((s) => s && s.id === PICKAXE);
  assert('tools do not stack', picks.length === 2 && picks.every((s) => s.count === 1),
    picks.map((s) => s.count).join(','));
  assert('each tool keeps its own durability',
    picks.some((s) => s.durability === 40) && picks.some((s) => s.durability === 200));
  assert('the healthiest tool sorts first', inv.slots[0].durability === 200, inv.slots[0].durability);
  assert('nothing is lost', inv.countOf(PICKAXE) === 2 && inv.countOf(SHOVEL) === 1);
}

// ------------------------------------------ picking up things that wear out
//
// `sort` has always refused to merge two tools, for the reason above: each
// carries its own number of uses left, and folding them together keeps one
// and throws the other away. `add` is where they *arrive*, and it has to
// refuse the same merge for the same reason — otherwise picking a second
// pickaxe off the floor quietly repairs or ruins the one in your bag. The
// bow and the sixteen pieces of armour wear out too, so this covers them.
{
  const inv = new Inventory();
  inv.add(PICKAXE, 1);
  inv.add(PICKAXE, 1);
  assert('two picked-up tools take two slots',
    inv.slots[0]?.count === 1 && inv.slots[1]?.id === PICKAXE && inv.slots[1]?.count === 1,
    JSON.stringify(inv.slots.slice(0, 2)));
  assert('...each with its own full durability',
    inv.slots[0].durability === maxDurability(PICKAXE)
    && inv.slots[1].durability === maxDurability(PICKAXE));

  const worn = new Inventory();
  worn.slots[0] = { id: BOW, count: 1, durability: 12 };
  worn.add(BOW, 1);
  assert('a fresh bow does not stack onto a nearly-spent one',
    worn.slots[0].durability === 12 && worn.slots[0].count === 1
    && worn.slots[1]?.id === BOW && worn.slots[1].durability === maxDurability(BOW),
    JSON.stringify(worn.slots.slice(0, 2)));

  const kit = new Inventory();
  kit.add(IRON_HELMET, 3);
  assert('three helmets are three slots, not a stack of three',
    kit.countOf(IRON_HELMET) === 3
    && kit.slots.slice(0, 3).every((s) => s?.count === 1),
    JSON.stringify(kit.slots.slice(0, 3)));

  // Everything else still stacks exactly as it did.
  const bag = new Inventory();
  bag.add(COAL, 40);
  bag.add(COAL, 24);
  assert('ordinary items still merge into one stack',
    bag.slots[0]?.count === 64 && bag.slots[1] === null, JSON.stringify(bag.slots[0]));
}

// ---------------------------------------------------------- the armour slots
{
  const inv = new Inventory();
  assert('a new inventory has four empty armour slots',
    inv.armour.length === ARMOUR_SLOTS && inv.armour.every((s) => s === null));

  inv.set(0, { id: IRON_HELMET, count: 1 });
  assert('shift-clicking a helmet puts it on', inv.equipArmour(0) === true
    && inv.armour[0]?.id === IRON_HELMET && inv.slots[0] === null);
  assert('...with durability stamped on the way',
    inv.armour[0].durability === maxDurability(IRON_HELMET));

  inv.set(1, { id: IRON_CHESTPLATE, count: 1 });
  inv.set(2, { id: IRON_HELMET, count: 1 });
  assert('a second helmet finds the slot taken', inv.equipArmour(2) === false
    && inv.slots[2]?.id === IRON_HELMET);
  assert('the chestplate goes to its own slot', inv.equipArmour(1) === true
    && inv.armour[1]?.id === IRON_CHESTPLATE);

  inv.set(3, { id: COAL, count: 1 });
  assert('coal is not armour', inv.equipArmour(3) === false && inv.slots[3]?.id === COAL);

  // A piece can only be dropped into the slot it belongs to.
  inv.cursor = { id: IRON_HELMET, count: 1, durability: 40 };
  inv.clickArmourSlot(1);
  assert('a helmet is refused by the chestplate slot',
    inv.cursor?.id === IRON_HELMET && inv.armour[1]?.id === IRON_CHESTPLATE);
}

const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
