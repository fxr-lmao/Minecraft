// Water: how far it spreads, what a drop does to it, and what it refuses to
// touch. Run on a superflat world so "seven blocks" has an exact answer.
import { World, STONE } from '../src/world.js';
import { WaterFlow } from '../src/water.js';
import {
  WATER, WATER_LEVELS, AIR, isWater, waterLevel, waterId, waterHeight, isOpaque,
  SEA_LEVEL,
} from '../src/terrain.js';
import { WORLD_SEED } from '../src/constants.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

/** Flat ground at y=3, chunks preloaded, and a settled flow. */
function pool(build) {
  const w = new World(1, { flat: 3 });
  for (let cx = -1; cx < 3; cx++) for (let cz = -1; cz < 2; cz++) w.chunk(cx, cz);
  const flow = new WaterFlow(w);
  build(w, flow);
  let steps = 0;
  while (flow.step(20, 6, 20) > 0 && steps < 200) steps++;
  return { w, flow, steps };
}

const level = (w, x, y, z) => {
  const id = w.get(x, y, z);
  return isWater(id) ? waterLevel(id) : null;
};

// ------------------------------------------------- ids and surface heights
{
  assert('water ids cover a source plus seven levels', WATER_LEVELS === 7);
  assert('every level is water', [0, 1, 4, 7].every((l) => isWater(waterId(l))));
  assert('one past the last level is not', !isWater(waterId(8)));
  assert('water is not opaque', !isOpaque(WATER) && !isOpaque(waterId(3)));
  assert('a source is level 0', waterLevel(WATER) === 0);
  assert('flowing water at full strength is level 0 too', waterLevel(waterId(0)) === 0);
  assert('but it is a different block from a source', waterId(0) !== WATER);

  // The surface steps down as the flow thins, and is flat under more water.
  assert('a source stands 8/9 of a block', Math.abs(waterHeight(WATER, false) - 8 / 9) < 1e-9);
  assert('level 7 is a puddle', waterHeight(waterId(7), false) < 0.2,
    waterHeight(waterId(7), false));
  assert('water under water is full height', waterHeight(waterId(4), true) === 1);
  let descends = true;
  for (let l = 1; l <= WATER_LEVELS; l++) {
    if (waterHeight(waterId(l), false) >= waterHeight(waterId(l - 1), false)) descends = false;
  }
  assert('each level is shallower than the last', descends);
}

// ----------------------------------------------------- spreading on a flat
{
  const { w, steps } = pool((world, flow) => {
    world.setBlock(20, 4, 20, WATER);
    flow.touch(20, 4, 20);
  });

  let reach = 0;
  while (isWater(w.get(20 + reach + 1, 4, 20)) && reach < 20) reach++;
  assert('a source reaches exactly seven blocks', reach === WATER_LEVELS, reach);

  const levels = [];
  for (let d = 0; d <= reach; d++) levels.push(level(w, 20 + d, 4, 20));
  assert('and thins one level per block', levels.join(',') === '0,1,2,3,4,5,6,7', levels.join(','));
  assert('the eighth block stays dry', w.get(28, 4, 20) === AIR, w.get(28, 4, 20));
  assert('it spreads every way at once',
    level(w, 20, 4, 27) === 7 && level(w, 13, 4, 20) === 7 && level(w, 20, 4, 13) === 7);
  assert('the flow settles', steps < 200, steps);
}

// --------------------------------------------------------- over a ledge
// A source on a pillar: the water goes over the edge, falls, and gets a fresh
// seven blocks at the bottom. This is the behaviour the whole level scheme
// exists for.
{
  const { w } = pool((world, flow) => {
    for (let y = 4; y <= 9; y++) world.setBlock(20, y, 20, STONE);
    world.setBlock(20, 10, 20, WATER);
    flow.touch(20, 10, 20);
  });

  assert('it pours off the edge', level(w, 21, 10, 20) === 1, level(w, 21, 10, 20));
  assert('the fall is a single column, not a sheet',
    level(w, 21, 7, 20) === 0 && w.get(22, 7, 20) === AIR,
    `${level(w, 21, 7, 20)} / ${w.get(22, 7, 20)}`);

  let reach = 0;
  while (isWater(w.get(21 + reach + 1, 4, 20)) && reach < 20) reach++;
  assert('the landing spreads another seven', reach === WATER_LEVELS, reach);
  const levels = [];
  for (let d = 0; d <= reach; d++) levels.push(level(w, 21 + d, 4, 20));
  assert('...at full strength, exactly as a source would',
    levels.join(',') === '0,1,2,3,4,5,6,7', levels.join(','));
}

// ------------------------------------------------------------- what it won't do
{
  const { w } = pool((world, flow) => {
    world.setBlock(20, 4, 20, WATER);
    for (let z = 18; z <= 22; z++) world.setBlock(23, 4, z, STONE); // a wall
    flow.touch(20, 4, 20);
  });
  assert('a wall stops it', w.get(23, 4, 20) === STONE, w.get(23, 4, 20));
  assert('it does not seep through', w.get(24, 4, 20) === AIR, w.get(24, 4, 20));
  assert('it goes around instead', isWater(w.get(23, 4, 17)) || isWater(w.get(22, 4, 17)));
}

// Removing the feed drains the channel, and the source itself never drains.
{
  const w = new World(1, { flat: 3 });
  for (let cx = -1; cx < 3; cx++) for (let cz = -1; cz < 2; cz++) w.chunk(cx, cz);
  const flow = new WaterFlow(w);
  w.setBlock(20, 4, 20, WATER);
  flow.touch(20, 4, 20);
  while (flow.step(20, 6, 20) > 0);
  assert('the channel filled', isWater(w.get(24, 4, 20)));

  w.setBlock(20, 4, 20, STONE); // cork the source
  flow.touch(20, 4, 20);
  let steps = 0;
  while (flow.step(20, 6, 20) > 0 && steps < 200) steps++;
  assert('capping the source drains it', w.get(24, 4, 20) === AIR, w.get(24, 4, 20));
  assert('draining terminates', steps < 200, steps);
}

{
  const { w, flow } = pool((world, f) => {
    world.setBlock(20, 4, 20, WATER);
    f.touch(20, 4, 20);
  });
  assert('a source never drains itself', w.get(20, 4, 20) === WATER);
  assert('a settled flow does no work', flow.step(20, 6, 20) === 0);
}

// ------------------------------------------------------- saves stay small
// Flowing water is written transiently: it is a consequence of the terrain,
// so it is recomputed rather than stored, and a flood costs nothing to save.
{
  const { w } = pool((world, flow) => {
    world.setBlock(20, 4, 20, WATER);
    flow.touch(20, 4, 20);
  });
  const edits = [...w.editList()];
  assert('only the source is an edit', edits.length === 1, edits.length);
  assert('...and it is the source', edits[0].id === WATER && edits[0].y === 4,
    JSON.stringify(edits[0]));
}

// ------------------------------------------------------------ the sea
{
  const w = new World(WORLD_SEED);
  let found = null;
  for (let x = 0; x < 400 && !found; x += 8) {
    for (let z = 0; z < 400; z += 8) {
      if (w.get(x, SEA_LEVEL, z) === WATER) { found = [x, z]; break; }
    }
  }
  assert('the world has a sea', found !== null, JSON.stringify(found));
  if (found) {
    const [x, z] = found;
    assert('the sea surface is at sea level',
      w.get(x, SEA_LEVEL, z) === WATER && w.get(x, SEA_LEVEL + 1, z) === AIR);
    assert('the sea is made of sources', w.get(x, SEA_LEVEL - 1, z) === WATER);
    assert('you can swim in it', !w.isSolid(x, SEA_LEVEL, z) && w.isWaterAt(x, SEA_LEVEL, z));
    assert('there is a floor under it', w.heightAt(x, z) < SEA_LEVEL, w.heightAt(x, z));
  }
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
