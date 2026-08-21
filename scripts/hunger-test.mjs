// Hunger and food: the rules of the survival loop, checked the way the rest
// of this game's are — pure modules, plain asserts.
//
// The rules worth protecting here are the ones whose failure is silent:
//
//   * Exhaustion piles up four points to a shank and takes saturation before
//     food, because a full meal should last for real time, not evaporate.
//   * Food and saturation cap at twenty; eating with a full stomach is
//     refused rather than quietly spending the item.
//   * Health regenerates only while food is 18+ and saturation remains, one
//     hit point every four seconds — the rule that makes cooked food healing
//     and raw food merely survival.
//   * Starvation at zero food costs one hit point every four seconds, and the
//     player is never told to eat twice for the same bite.
//   * The eater holds a mouthful for 1.6 s, spends nothing on interrupt, and
//     rolls poison per bite on the foods that have a chance of it.

import {
  Hunger, MAX_FOOD, MAX_SATURATION, EXHAUSTION_PER_POINT,
  EXHAUST_WALK, EXHAUST_SPRINT, REGEN_FOOD, REGEN_INTERVAL,
  STARVE_INTERVAL, POISON_SECONDS, POISON_DRAIN,
} from '../src/hunger.js';
import { Eater, isFood, foodInfo, EAT_SECONDS, FOOD } from '../src/food.js';
import {
  APPLE, STEAK, RAW_BEEF, RAW_CHICKEN, COOKED_CHICKEN, ROTTEN_FLESH, COAL,
} from '../src/items.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------- the constants
{
  assert('two bars of twenty', MAX_FOOD === 20 && MAX_SATURATION === 20);
  assert('four points empty a shank', EXHAUSTION_PER_POINT === 4);
  assert('healing needs a near-full bar', REGEN_FOOD === 18);
  assert('regeneration is four seconds', REGEN_INTERVAL === 4);
  assert('starvation is four seconds', STARVE_INTERVAL === 4);
  assert('walking costs a hundredth a metre',
    near(EXHAUST_WALK, 0.01) && near(EXHAUST_SPRINT, 0.1));
  assert('poison is half a minute', POISON_SECONDS === 30);
}

// --------------------------------------------------------------- exhaustion
{
  const h = new Hunger();
  h.addExhaustion(EXHAUSTION_PER_POINT);
  assert('four points spend saturation first',
    h.saturation === 4 && h.food === MAX_FOOD, `${h.saturation}/${h.food}`);

  const g = new Hunger();
  g.saturation = 0;
  g.food = 10;
  g.addExhaustion(EXHAUSTION_PER_POINT);
  assert('with no saturation, food is spent', g.food === 9 && g.saturation === 0);

  const e = new Hunger();
  e.saturation = 0;
  e.food = 0;
  e.addExhaustion(100);
  assert('nothing below zero is spent', e.food === 0 && e.saturation === 0
    && e.exhaustion === 0, e.exhaustion);

  const neg = new Hunger();
  neg.addExhaustion(-5);
  assert('a negative spend is ignored', neg.food === MAX_FOOD && neg.exhaustion === 0);
}

// ------------------------------------------------------------------- eating
{
  const h = new Hunger();
  h.food = 10;
  h.saturation = 0;
  assert('an empty bar can eat', h.canEat === true);
  const ate = h.eat(4, 2.4);
  assert('eating restores both bars', ate === true && h.food === 14
    && near(h.saturation, 2.4), `${h.food}/${h.saturation}`);

  const full = new Hunger();
  full.saturation = MAX_SATURATION;
  assert('a full, saturated stomach refuses food', full.canEat === false);
  assert('...and eating it returns false rather than spending the item',
    full.eat(4, 2.4) === false);

  const capped = new Hunger();
  capped.food = 18;
  capped.saturation = 19;
  capped.eat(8, 12.8);
  assert('both bars cap at twenty', capped.food === 20 && capped.saturation === 20,
    `${capped.food}/${capped.saturation}`);
}

// --------------------------------------------------------------- the clocks
{
  // Regeneration: one hit point every four seconds while well fed, and it
  // spends saturation (via exhaustion) so it eventually stops of its own.
  const h = new Hunger();
  h.food = 20;
  h.saturation = 20;
  const a = h.tick(REGEN_INTERVAL);
  assert('a full stomach heals one every four seconds', near(a.heal, 1), a.heal);
  const b = h.tick(REGEN_INTERVAL * 3);
  assert('...and three more for twelve seconds', near(b.heal, 3), b.heal);
  assert('healing spends saturation', h.saturation < 20, h.saturation);

  const starved = new Hunger();
  starved.food = 17;
  starved.saturation = 0;
  const c = starved.tick(REGEN_INTERVAL * 2);
  assert('below 18 food, nothing heals', c.heal === 0 && c.starve === 0);

  // Starvation: at zero food, one hit point every four seconds.
  const empty = new Hunger();
  empty.food = 0;
  empty.saturation = 0;
  const d = empty.tick(STARVE_INTERVAL);
  assert('an empty stomach starves one every four seconds', near(d.starve, 1), d.starve);
  assert('...and heals nothing at the same time', d.heal === 0);

  // The starve clock does not back-charge after a meal.
  empty.food = 10;
  empty.saturation = 0;
  const e = empty.tick(STARVE_INTERVAL * 0.5);
  assert('a meal resets the starvation countdown', e.starve === 0);
}

// ------------------------------------------------------------------- poison
{
  const h = new Hunger();
  h.food = 20;
  h.saturation = 0;
  h.applyPoison(10);
  h.tick(10);
  assert('poison drains the food bar', h.food < 20, h.food);
  assert('...by its rate over its seconds',
    near(h.food, 20 - POISON_DRAIN * 10, 1e-6), h.food);
  assert('the poison clock runs out', h.poison === 0);

  const re = new Hunger();
  re.applyPoison(5);
  re.applyPoison(30);
  assert('re-poisoning extends rather than resets', re.poison === 30);
}

// ---------------------------------------------------------------- the table
{
  assert('the foods are food', [APPLE, STEAK, RAW_BEEF, RAW_CHICKEN,
    COOKED_CHICKEN, ROTTEN_FLESH].every(isFood));
  assert('coal is not food', !isFood(COAL) && foodInfo(COAL) === null);

  assert('a steak is a meal', foodInfo(STEAK).nutrition === 8
    && foodInfo(STEAK).saturation === 12.8);
  assert('raw chicken can disagree with you',
    foodInfo(RAW_CHICKEN).poisonChance === 0.3);
  assert('cooked chicken cannot', foodInfo(COOKED_CHICKEN).poisonChance === undefined);
  assert('rotten flesh is the bad food', foodInfo(ROTTEN_FLESH).poisonChance === 0.8);
  assert('an apple is small but safe', foodInfo(APPLE).nutrition === 4
    && foodInfo(APPLE).poisonChance === undefined);
  assert('every food has nutrition and saturation', Object.values(FOOD).every(
    (f) => Number.isFinite(f.nutrition) && Number.isFinite(f.saturation)));
}

// ----------------------------------------------------------------- the eater
{
  assert('eating takes Minecraft\u2019s 32 ticks', near(EAT_SECONDS, 1.6));

  const eater = new Eater();
  assert('a fresh eater is idle', !eater.eating);
  assert('refusing to start non-food', eater.start(COAL) === false && !eater.eating);

  eater.start(APPLE);
  assert('food starts a meal', eater.eating && eater.id === APPLE);
  assert('half a second in, nothing has finished',
    eater.update(EAT_SECONDS / 2) === null);
  const meal = eater.update(EAT_SECONDS);
  assert('a full second-and-a-half finishes the meal',
    meal && meal.done && meal.id === APPLE && meal.info === FOOD[APPLE]);
  assert('...and the eater is idle again', !eater.eating);

  // Interrupt: releasing the button spends nothing and reports done:false.
  eater.start(STEAK);
  eater.cancel();
  const stop = eater.update(0);
  assert('an interrupted meal reports done:false',
    stop && stop.done === false && stop.id === STEAK);
  assert('...and is idle', !eater.eating);

  // The poison roll: a deterministic rand below the chance poisons.
  const poisoned = new Eater();
  poisoned.start(ROTTEN_FLESH);
  const bite = poisoned.update(EAT_SECONDS, () => 0);
  assert('a deterministic low roll poisons', bite.poison === true);
  const clean = new Eater();
  clean.start(ROTTEN_FLESH);
  const bite2 = clean.update(EAT_SECONDS, () => 1);
  assert('a deterministic high roll does not', bite2.poison === false);

  // Progress reports a 0..1 fraction for the HUD bar.
  const half = new Eater();
  half.start(APPLE);
  half.update(EAT_SECONDS / 2);
  assert('progress is a fraction for the bar', near(half.fraction, 0.5, 1e-6), half.fraction);
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
