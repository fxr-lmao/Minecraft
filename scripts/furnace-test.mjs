// Unit tests for the furnace: lighting, burning, smelting, fuel economy,
// output handling, and the store save/restore round trip.

import { Furnace, FurnaceStore, SMELT_TIME, SMELT_RECIPES, isFuel, smeltsTo } from '../src/furnace.js';
import { SAND, GLASS, COBBLESTONE, STONE, LOG, PLANKS } from '../src/terrain.js';
import { STICKS } from '../src/items.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// ---- recipes / fuels ----
check('sand smelts to glass', smeltsTo(SAND) === GLASS);
check('cobblestone smelts to stone', smeltsTo(COBBLESTONE) === STONE);
check('grass smelts to nothing', smeltsTo(1) === null);
check('log is fuel', isFuel(LOG) && isFuel(PLANKS) && isFuel(STICKS));
check('stone is not fuel', !isFuel(STONE));
check('smelt time is Minecraft 10s', SMELT_TIME === 10);

// ---- lighting and burning ----
const f = new Furnace();
check('new furnace is idle', !f.active && f.burn === 0 && f.progress === 0);

// Put sand in and a log in; tick 1s.
f.insert(0, { id: SAND, count: 1 });
f.insert(1, { id: LOG, count: 1 });
f.tick(1);
check('fuel lit after a tick', f.burn > 0 && f.burn < 15);
check('fuel consumed one log', f.fuel === null);
check('progress advanced', f.progress > 0);

// Burn the rest of the log.
let t = 1;
while (f.active && t < 20) { f.tick(1); t++; }
check('sand smelted into glass', f.output?.id === GLASS && f.output?.count === 1);
check('input consumed', f.input === null);
check('fuel mostly spent (a log is 1.5 items of fuel)', f.burn < 8);

// ---- output can be taken ----
const out = f.takeOutput();
check('took glass out', out.id === GLASS && out.count === 1 && f.output === null);

// ---- fuel economy: 1 log = 15s = 1.5 sand, but partial works ----
const f2 = new Furnace();
f2.insert(0, { id: SAND, count: 1 });
f2.insert(1, { id: STICKS, count: 1 }); // 2.5s of fuel, not enough for 10s
let burnLeft = null;
for (let i = 0; i < 3; i++) f2.tick(1);
check('short fuel runs out mid-smelt', f2.burn === 0 && f2.output === null);
check('progress freezes under half', f2.progress > 0 && f2.progress < 0.5);

// ---- relight continues where it left off ----
f2.insert(1, { id: STICKS, count: 6 }); // 15s of fuel, plenty for the rest
let t2 = 0;
while (t2 < 25) { f2.tick(1); t2++; } // fixed ticks: relights as fuel runs out
check('relit furnace finishes the smelt', f2.output?.id === GLASS && f2.output?.count === 1);

// ---- invalid inputs rejected ----
const f3 = new Furnace();
check('grass rejected as input', !f3.insert(0, { id: 1, count: 1 }));
check('stone rejected as fuel', !f3.insert(1, { id: STONE, count: 1 }));
check('nothing was placed', f3.input === null && f3.fuel === null);

// ---- store: separate furnaces, save/restore ----
const store = new FurnaceStore();
const a = store.get(10, 20, 30);
const b = store.get(40, 50, 60);
check('store separates positions', a !== b && store.has(10, 20, 30));
a.insert(0, { id: SAND, count: 2 });
a.insert(1, { id: LOG, count: 1 });
a.tick(5);
const saved = store.toJSON();
check('save has the lit furnace', saved.length === 2 && saved.some((r) => r.x === 10 && r.input.count === 2));

const store2 = new FurnaceStore();
store2.fromJSON(saved);
const restored = store2.get(10, 20, 30);
check('restored input', restored.input.id === SAND && restored.input.count === 2);
check('restored progress', restored.progress > 0);
check('restored other furnace', store2.get(40, 50, 60).input === null);

// ---- store delete ----
store.delete(10, 20, 30);
check('delete removes the furnace', !store.has(10, 20, 30));

// ---- a blocked output does not light the fuel ----
// Lighting a furnace that has nowhere to put the result spends a whole log
// to heat an empty room.
const blocked = new Furnace();
blocked.input = { id: SAND, count: 8 };
blocked.fuel = { id: LOG, count: 2 };
blocked.output = { id: GLASS, count: 64 }; // full
blocked.tick(1);
check('a full output slot does not light the fuel', blocked.fuel.count === 2);
check('a full output slot leaves the furnace cold', blocked.burn === 0);

const mismatched = new Furnace();
mismatched.input = { id: SAND, count: 8 };
mismatched.fuel = { id: LOG, count: 2 };
mismatched.output = { id: STONE, count: 1 }; // wrong item in the way
mismatched.tick(1);
check('a mismatched output does not light the fuel', mismatched.fuel.count === 2);

// ...and it lights again the moment the output is cleared.
blocked.output = null;
blocked.tick(1);
check('clearing the output lights it', blocked.burn > 0 && blocked.fuel.count === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
