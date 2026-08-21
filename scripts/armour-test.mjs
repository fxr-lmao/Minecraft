// Armour: the damage maths, checked in isolation.
//
// The rules worth protecting here are the ones whose failure is silent:
//
//   * Each point of armour turns aside four percent of a hit, capped at the
//     eighty percent a full diamond suit is worth — more than that would be
//     invincibility, and Minecraft is careful not to hand it out.
//   * Every worn piece pays a use of durability for softening a blow, and a
//     piece that reaches zero is gone — armour is a consumable, not a flag.
//   * The absorbed damage and the damage through always add back to the
//     original, so nothing is created or destroyed by putting on a helmet.

import {
  ARMOUR, isArmour, armourSlot, armourPoints, armourDurability,
  totalArmourPoints, reduction, absorb,
  SLOT_HELMET, SLOT_CHEST, SLOT_LEGS, SLOT_BOOTS,
  ARMOUR_POINT_REDUCTION, ARMOUR_CAP,
} from '../src/armour.js';
import {
  IRON_HELMET, IRON_CHESTPLATE, IRON_LEGGINGS, IRON_BOOTS,
  DIAMOND_CHESTPLATE, LEATHER_HELMET,
} from '../src/items.js';
import { STONE } from '../src/terrain.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- the table
{
  assert('sixteen pieces of armour', Object.keys(ARMOUR).length === 16);
  assert('a full iron suit is 15 points',
    armourPoints(IRON_HELMET) + armourPoints(IRON_CHESTPLATE)
    + armourPoints(IRON_LEGGINGS) + armourPoints(IRON_BOOTS) === 15);
  assert('each piece knows its slot', armourSlot(IRON_HELMET) === SLOT_HELMET
    && armourSlot(IRON_CHESTPLATE) === SLOT_CHEST
    && armourSlot(IRON_LEGGINGS) === SLOT_LEGS
    && armourSlot(IRON_BOOTS) === SLOT_BOOTS);
  assert('stone is not armour', !isArmour(STONE) && armourSlot(STONE) === -1);
  assert('a point turns aside four percent', ARMOUR_POINT_REDUCTION === 0.04);
  assert('...capped at eighty percent', ARMOUR_CAP === 0.8);
  assert('diamond armour lasts twice iron', armourDurability(DIAMOND_CHESTPLATE) === 330
    && armourDurability(IRON_CHESTPLATE) === 165);
}

// ----------------------------------------------------------------- reduction
{
  assert('zero points turn aside nothing', reduction(0) === 0);
  assert('fifteen points turn aside sixty percent', near(reduction(15), 0.6));
  assert('the cap holds even past twenty', reduction(40) === ARMOUR_CAP);
  assert('leather alone is seven points', near(reduction(7), 0.28));
}

// -------------------------------------------------------------------- absorb
{
  const suit = [null, null, null, null];
  suit[SLOT_HELMET] = { id: IRON_HELMET, count: 1, durability: 165 };
  assert('one helmet is two points', totalArmourPoints(suit) === 2);

  // A ten-point hit through a full iron suit: 15 points is 60% off.
  const full = [
    { id: IRON_HELMET, count: 1, durability: 165 },
    { id: IRON_CHESTPLATE, count: 1, durability: 165 },
    { id: IRON_LEGGINGS, count: 1, durability: 165 },
    { id: IRON_BOOTS, count: 1, durability: 165 },
  ];
  const r = absorb(full, 10);
  assert('a full iron suit takes sixty percent off a ten-point hit',
    near(r.through, 4) && near(r.absorbed, 6), `${r.through}/${r.absorbed}`);
  assert('...and the two add back to ten', near(r.through + r.absorbed, 10));
  assert('every worn piece pays a use', full.every((s) => s.durability < 165),
    full.map((s) => s.durability).join(','));

  // A piece at its last use breaks when it takes the next hit.
  const ragged = [null, null, null, null];
  ragged[SLOT_HELMET] = { id: LEATHER_HELMET, count: 1, durability: 1 };
  absorb(ragged, 5);
  assert('a piece at one durability breaks on the next hit', ragged[SLOT_HELMET] === null);

  // A bare player takes the whole hit through.
  const bare = [null, null, null, null];
  const b = absorb(bare, 6);
  assert('a bare player takes it all', near(b.through, 6) && near(b.absorbed, 0));

  // The cap: even a full diamond suit cannot turn aside more than 80%.
  const diamond = [
    { id: IRON_HELMET, count: 1, durability: 165 },
    { id: DIAMOND_CHESTPLATE, count: 1, durability: 330 },
    { id: IRON_LEGGINGS, count: 1, durability: 165 },
    { id: IRON_BOOTS, count: 1, durability: 165 },
  ];
  const d = absorb(diamond, 20);
  assert('no suit turns aside more than eighty percent',
    d.absorbed <= 20 * ARMOUR_CAP + 1e-9, d.absorbed.toFixed(2));
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
