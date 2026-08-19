// Water, both halves of it: how it spreads, and how it is drawn.
//
// Run on a superflat world so "seven blocks" has an exact answer.
//
// The rendering half is worth more than it looks. Water used to be drawn as a
// box per cell, shortened to the amount in it, and a spreading stream is a
// staircase of different amounts — so it came out as a grid of floating slabs
// with the floor showing through every joint. The fix is that the surface
// height belongs to the *corners*, which neighbouring cells share, and the
// test for it is exactly that: walk every pair of adjacent water quads and
// assert their shared edge is the same edge.
import { World, STONE } from '../src/world.js';
import { WaterFlow, Freeze, DROP_OFF, SLOPE_FIND_DISTANCE } from '../src/water.js';
import { meshChunk } from '../src/blocks.js';
import {
  fluidCornerHeight, fluidCornerInfo, fluidWaveAmount, fluidFlow, fluidOwnHeight,
  DEPTH_SCALE, STILL, FLOWING, STILL_EDGE_CHURN,
} from '../src/water-mesh.js';
import {
  WATER, WATER_LEVELS, WATER_MAX_AMOUNT, AIR, GRASS, ICE,
  isWater, waterLevel, waterId, waterHeight, waterAmount, waterIdForAmount,
  isOpaque, isWaterSource, SEA_LEVEL, WATER_LAST,
  temperatureAt, temperatureWith, isFreezing, biomeWeights, LAPSE_BASE_Y,
} from '../src/terrain.js';
import {
  WORLD_SEED, CHUNK_SIZE, toLayer, FLOW_PUSH_SPEED, WORLD_MAX_Y,
} from '../src/constants.js';
import * as THREE from '../vendor/three.module.min.js';
import {
  WaterView, WATER_FAST, WATER_FANCY, WATER_ULTRA,
} from '../src/water-render.js';
import { ABSORB } from '../src/water-shader.js';
import { CAUSTIC_GLSL, SWELL_GLSL } from '../src/water-glsl.js';
import {
  ITEM_BASE, BUCKET, WATER_BUCKET, isItem, useBucket, fluidAim,
} from '../src/items.js';
import { raycastVoxel } from '../src/raycast.js';
import { Particles, DROPLET, BUBBLE, FOAM, MAX_PARTICLES } from '../src/particles.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const FLAT = 3; // superflat ground height; y = 4 is the first air

/** Flat ground, chunks preloaded, and a settled flow. */
function pool(build, opts = {}) {
  const w = new World(1, { flat: FLAT });
  for (let cx = -1; cx < 3; cx++) for (let cz = -1; cz < 2; cz++) w.chunk(cx, cz);
  const flow = new WaterFlow(w, opts);
  build(w, flow);
  let steps = 0;
  while (!flow.settled && steps < 400) {
    flow.step(20, 6, 20);
    steps++;
  }
  return { w, flow, steps };
}

const level = (w, x, y, z) => {
  const id = w.get(x, y, z);
  return isWater(id) ? waterLevel(id) : null;
};

/** A sampler over a hand-written map of blocks, for testing the maths alone. */
function sampler(cells, fill = AIR) {
  return (x, y, z) => {
    const id = cells[`${x},${y},${z}`];
    return id === undefined ? fill : id;
  };
}

// ------------------------------------------------- ids, amounts and heights
{
  assert('water ids cover a source plus seven levels', WATER_LEVELS === 7);
  assert('every level is water', [0, 1, 4, 7].every((l) => isWater(waterId(l))));
  assert('one past the last level is not', !isWater(waterId(8)));
  assert('water is not opaque', !isOpaque(WATER) && !isOpaque(waterId(3)));
  assert('a source is level 0', waterLevel(WATER) === 0);
  assert('flowing water at full strength is level 0 too', waterLevel(waterId(0)) === 0);
  assert('but it is a different block from a source', waterId(0) !== WATER);
  assert('only a source counts as one',
    isWaterSource(WATER) && !isWaterSource(waterId(0)));

  // Minecraft counts water as an amount from 8 down to 1; levels index the
  // block ids. Both spellings have to agree in both directions.
  assert('a source holds eight ninths', waterAmount(WATER) === WATER_MAX_AMOUNT);
  assert('the last level of a spread holds one', waterAmount(waterId(7)) === 1);
  assert('air holds none', waterAmount(AIR) === 0 && waterAmount(GRASS) === 0);
  let roundTrips = true;
  for (let a = 1; a <= WATER_MAX_AMOUNT; a++) {
    if (waterAmount(waterIdForAmount(a)) !== a) roundTrips = false;
  }
  assert('amounts and ids convert back and forth', roundTrips);
  assert('nothing left is dry', waterIdForAmount(0) === AIR && waterIdForAmount(-3) === AIR);

  assert('a source stands 8/9 of a block', near(waterHeight(WATER, false), 8 / 9));
  assert('level 7 is a puddle', waterHeight(waterId(7), false) < 0.2,
    waterHeight(waterId(7), false));
  assert('water under water is full height', waterHeight(waterId(4), true) === 1);
  assert('the mesher agrees about the height of a cell',
    near(fluidOwnHeight(waterId(3)), waterHeight(waterId(3), false)));
  let descends = true;
  for (let l = 1; l <= WATER_LEVELS; l++) {
    if (waterHeight(waterId(l), false) >= waterHeight(waterId(l - 1), false)) descends = false;
  }
  assert('each level is shallower than the last', descends);
}

// ------------------------------------------------------------ corner heights
// The rule the whole surface rests on: a corner is the average of the four
// cells that touch it, so two neighbours cannot disagree about where their
// shared edge is.
{
  // A lone source in the open. The corner between it and three air cells is
  // dragged down; the corner it shares with nothing but itself is not.
  const lone = sampler({ '0,0,0': WATER });
  const h = fluidCornerHeight(lone, 0, 0, 0);
  assert('a corner is pulled down by the air beside it', h > 0 && h < 8 / 9, h);
  // three air cells at weight 1, one source at weight 10
  assert('...but only by a tenth of the way, because a full cell counts ten',
    near(h, (8 / 9) * 10 / 13), h);

  // Same corner, but the three neighbours are rock rather than air. Solid
  // blocks are not counted at all, so the water stays at its own height.
  const walled = sampler({ '0,0,0': WATER }, STONE);
  assert('rock beside water does not drag the surface down',
    near(fluidCornerHeight(walled, 0, 0, 0), 8 / 9),
    fluidCornerHeight(walled, 0, 0, 0));

  // Four sources meeting under open sky: flat, and exactly a source's height.
  const sea = (x, y, z) => (y <= 0 ? WATER : AIR);
  assert('the open sea is flat', near(fluidCornerHeight(sea, 5, 0, 5), 8 / 9),
    fluidCornerHeight(sea, 5, 0, 5));
  assert('and full to the brim one cell down', fluidCornerHeight(sea, 5, -1, 5) === 1);

  // Water directly above any of the four means we are looking at the side of
  // a column, and the surface there is the top of the cell.
  const column = sampler({ '0,0,0': WATER, '0,1,0': WATER });
  assert('a corner under more water is full height',
    fluidCornerHeight(column, 0, 0, 0) === 1);

  // Three sources and a one-ninth trickle. A plain average would put that
  // corner at 0.69 — a visible dent in the sea wherever a puddle touches it.
  // The ten-to-one weighting keeps it at 0.86, near the sources' own height.
  const shore = sampler({
    '0,0,0': WATER, '0,0,-1': WATER, '-1,0,-1': WATER, '-1,0,0': waterId(7),
  });
  const sag = fluidCornerHeight(shore, 0, 0, 0);
  const plainMean = (3 * (8 / 9) + 1 / 9) / 4;
  assert('a sea does not sag into the puddle beside it',
    sag > 0.85 && sag > plainMean + 0.15, `${sag.toFixed(3)} vs ${plainMean.toFixed(3)} unweighted`);

  // Nothing at all is a height of zero rather than a division by zero.
  assert('dry ground has no surface', fluidCornerHeight(sampler({}), 0, 0, 0) === 0);
}

// -------------------------------------------------------------- flow vectors
{
  const out = new Float64Array(2);

  // Open sea: every neighbour is the same height, so there is no current and
  // the calm texture is used.
  const sea = sampler({}, WATER);
  assert('the open sea has no current', fluidFlow(sea, 0, 0, 0, WATER, out) === 0);

  // A source with a thinner cell to the east: the current runs east, away
  // from the deeper water.
  const stream = sampler({ '0,0,0': WATER, '1,0,0': waterId(1), '2,0,0': waterId(2) });
  const speed = fluidFlow(stream, 1, 0, 0, waterId(1), out);
  assert('water runs away from what feeds it', speed > 0 && out[0] > 0.9 && near(out[1], 0),
    `${out[0].toFixed(3)},${out[1].toFixed(3)}`);

  // A drop to the north: the current leans into the hole even though the cell
  // beside it is empty.
  const ledge = sampler({ '0,0,0': waterId(1), '0,-1,-1': waterId(0) });
  fluidFlow(ledge, 0, 0, 0, waterId(1), out);
  assert('a current leans toward the drop beside it', out[1] < -0.9,
    `${out[0].toFixed(3)},${out[1].toFixed(3)}`);

  // Walled in on three sides: the wall neither pushes nor pulls, so the flow
  // is decided by the one open side.
  const alley = sampler({ '0,0,0': waterId(1), '1,0,0': waterId(2) }, STONE);
  fluidFlow(alley, 0, 0, 0, waterId(1), out);
  assert('walls do not steer the current', out[0] > 0.9, out[0]);
}

// ------------------------------------------------------ spreading on a flat
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
  assert('with nothing to aim at it spreads every way at once',
    level(w, 20, 4, 27) === 7 && level(w, 13, 4, 20) === 7 && level(w, 20, 4, 13) === 7);
  assert('the flow settles', steps < 400, steps);
  assert('one block lost per block travelled', DROP_OFF === 1);
}

// ------------------------------------------------------- water finds the hole
// The reason this is a push model and not a shortest-path relaxation. On open
// ground water spreads in a disc; with a hole three blocks away it goes
// straight for the hole and nowhere else. You cannot get that by asking each
// cell what its neighbours are — the cell has to decide where to send itself.
{
  const { w } = pool((world, flow) => {
    // A pit two blocks east of the source, well inside the search distance.
    world.setBlock(22, FLAT, 20, AIR);
    world.setBlock(20, 4, 20, WATER);
    flow.touch(20, 4, 20);
  });

  assert('it heads for the hole', isWater(w.get(21, 4, 20)), w.get(21, 4, 20));
  assert('...and ignores every other direction',
    w.get(19, 4, 20) === AIR && w.get(20, 4, 19) === AIR && w.get(20, 4, 21) === AIR,
    `${w.get(19, 4, 20)}/${w.get(20, 4, 19)}/${w.get(20, 4, 21)}`);
  assert('and it falls in', isWater(w.get(22, FLAT, 20)), w.get(22, FLAT, 20));
  assert('the search looks four blocks ahead', SLOPE_FIND_DISTANCE === 4);
}

// A hole further away than the search can see is not aimed at: the water
// spreads evenly until it happens to arrive.
{
  const { w } = pool((world, flow) => {
    world.setBlock(26, FLAT, 20, AIR); // six blocks away, past the four-block search
    world.setBlock(20, 4, 20, WATER);
    flow.touch(20, 4, 20);
  });
  assert('a hole out of range does not steer it', isWater(w.get(19, 4, 20)), w.get(19, 4, 20));
  assert('...but the water still gets there in the end', isWater(w.get(26, FLAT, 20)));
}

// --------------------------------------------------------------- over a ledge
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

// ----------------------------------------------------------- infinite water
// Two sources side by side on solid ground make a third. It is what stops a
// channel cut from the sea thinning to a trickle: past two blocks wide, the
// channel is sea.
{
  const { w } = pool((world, flow) => {
    world.setBlock(20, 4, 20, WATER);
    world.setBlock(22, 4, 20, WATER);
    flow.touch(20, 4, 20);
    flow.touch(22, 4, 20);
  });
  assert('two sources make the cell between them a third',
    w.get(21, 4, 20) === WATER, w.get(21, 4, 20));
  assert('a single source does not', level(w, 23, 4, 20) === 1, level(w, 23, 4, 20));
}

// ...but not over a hole: water with nothing under it falls instead of
// pooling, however much of it there is.
{
  const { w } = pool((world, flow) => {
    world.setBlock(21, FLAT, 20, AIR);
    world.setBlock(20, 4, 20, WATER);
    world.setBlock(22, 4, 20, WATER);
    flow.touch(20, 4, 20);
    flow.touch(22, 4, 20);
  });
  assert('water over a hole never becomes a source',
    w.get(21, 4, 20) !== WATER, w.get(21, 4, 20));
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
  const w = new World(1, { flat: FLAT });
  for (let cx = -1; cx < 3; cx++) for (let cz = -1; cz < 2; cz++) w.chunk(cx, cz);
  const flow = new WaterFlow(w);
  w.setBlock(20, 4, 20, WATER);
  flow.touch(20, 4, 20);
  while (!flow.settled) flow.step(20, 6, 20);
  assert('the channel filled', isWater(w.get(24, 4, 20)));

  w.setBlock(20, 4, 20, STONE); // cork the source
  flow.touch(20, 4, 20);
  let steps = 0;
  while (!flow.settled && steps < 400) {
    flow.step(20, 6, 20);
    steps++;
  }
  assert('capping the source drains it', w.get(24, 4, 20) === AIR, w.get(24, 4, 20));
  assert('it drains all the way', w.get(21, 4, 20) === AIR, w.get(21, 4, 20));
  assert('draining terminates', steps < 400, steps);
}

{
  const { w, flow } = pool((world, f) => {
    world.setBlock(20, 4, 20, WATER);
    f.touch(20, 4, 20);
  });
  assert('a source never drains itself', w.get(20, 4, 20) === WATER);
  assert('a settled flow does no work', flow.step(20, 6, 20) === 0 && flow.settled);
}

// A step is bounded: a flood spreads over several of them rather than
// stalling a frame, and nothing is dropped on the way.
{
  const { w, flow, steps } = pool((world, f) => {
    world.setBlock(20, 4, 20, WATER);
    f.touch(20, 4, 20);
  }, { workBudget: 200 });
  assert('a tight work budget takes more steps', steps > 3, steps);
  assert('...and still finishes the job', isWater(w.get(27, 4, 20)) && flow.settled);
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

// A chunk that leaves memory comes back dry, so replaying its edits has to
// wake the water up again — otherwise a channel dug last session stays empty
// until something else disturbs it.
{
  const w = new World(1, { flat: FLAT });
  const touched = [];
  w.onEditReplayed = (x, y, z) => touched.push(`${x},${y},${z}`);
  w.setBlock(20, 4, 20, WATER);
  w.chunks.clear(); // evict, as walking away would
  w.chunk(0, 0); // and walk back
  assert('regenerating a chunk replays its edits through the water',
    touched.includes('20,4,20'), touched.join(' '));
}

// =========================================================== the drawn surface

/**
 * Every top face in a chunk's water mesh, by cell. A top quad is the six
 * vertices of two triangles over the corners (x,z) (x,z+1) (x+1,z+1) (x+1,z),
 * so the four corner heights come straight back out of it.
 */
function topFaces(buf) {
  const out = new Map();
  for (let q = 0; q < buf.pos.length; q += 18) {
    if (buf.n[q + 1] !== 1) continue; // not an up face
    let x = Infinity;
    let z = Infinity;
    for (let v = 0; v < 18; v += 3) {
      x = Math.min(x, buf.pos[q + v]);
      z = Math.min(z, buf.pos[q + v + 2]);
    }
    const corners = new Map();
    for (let v = 0; v < 18; v += 3) {
      corners.set(`${buf.pos[q + v]},${buf.pos[q + v + 2]}`, buf.pos[q + v + 1]);
    }
    out.set(`${x},${z}`, {
      x,
      z,
      nw: corners.get(`${x},${z}`),
      sw: corners.get(`${x},${z + 1}`),
      se: corners.get(`${x + 1},${z + 1}`),
      ne: corners.get(`${x + 1},${z}`),
    });
  }
  return out;
}

const quadCount = (buf) => buf.pos.length / 18;
/** Quads facing a given way: 1 up, -1 down, 0 sideways. */
const facing = (buf, ny) => {
  let n = 0;
  for (let q = 0; q < buf.pos.length; q += 18) if (buf.n[q + 1] === ny) n++;
  return n;
};
/** Vertex positions come back out of a Float32Array, so compare loosely. */
const F32 = 1e-4;

// The bug this file exists for. A stream spreading across flat ground is a
// staircase of levels, and drawing each one as a box left the floor showing
// through every joint. Corner heights close them — not by patching the seams
// but by making the two quads literally share their edge.
{
  const { w } = pool((world, flow) => {
    world.setBlock(20, 4, 20, WATER);
    flow.touch(20, 4, 20);
  });
  const buf = meshChunk(w, 0, 0, true).water;
  const tops = topFaces(buf.still);
  for (const [key, face] of topFaces(buf.flowing)) tops.set(key, face);
  assert('the spread is drawn', tops.size > 20, tops.size);

  let mismatched = 0;
  let stepped = 0;
  for (const face of tops.values()) {
    const east = tops.get(`${face.x + 1},${face.z}`);
    if (east) {
      if (!near(face.ne, east.nw, 1e-5) || !near(face.se, east.sw, 1e-5)) mismatched++;
      if (!near(face.ne, east.nw, 1e-5)) stepped++;
    }
    const south = tops.get(`${face.x},${face.z + 1}`);
    if (south) {
      if (!near(face.sw, south.nw, 1e-5) || !near(face.se, south.ne, 1e-5)) mismatched++;
    }
  }
  assert('no two neighbouring quads disagree about their shared edge', mismatched === 0,
    mismatched);

  // ...and the surface really does slope, rather than being flat everywhere,
  // which would also pass the test above.
  const src = tops.get(`${20 - 0},${20 - 0}`);
  const far = tops.get(`${26},${20}`);
  assert('the surface still descends away from the source',
    src && far && src.nw > far.nw + 0.3, `${src?.nw} -> ${far?.nw}`);
}

// A flat sea: one quad per surface cell, no walls, no undersides, and every
// corner at exactly a source's height.
{
  const w = new World(1, { flat: FLAT });
  // Flood a 6x6 basin one block deep with sources.
  for (let x = 10; x < 16; x++) for (let z = 10; z < 16; z++) w.setBlock(x, 4, z, WATER);
  const buf = meshChunk(w, 0, 0, true).water;
  const tops = topFaces(buf.still);
  assert('one quad per cell of surface', tops.size === 36, tops.size);
  assert('a still pool has a calm surface and nothing else in the moving pass',
    facing(buf.flowing, 1) === 0 && topFaces(buf.flowing).size === 0);
  // Its outside wall is still drawn as moving water: a visible wall of water
  // is the cut face of something, and Minecraft draws every one of them with
  // the flowing texture. 24 of them — four to a side of a six-wide pool.
  assert('...but its rim is a wall, and walls move', facing(buf.flowing, 0) === 24,
    facing(buf.flowing, 0));

  const inner = tops.get('12,12');
  const layer4 = toLayer(4);
  assert('the middle of a pool is flat at a source height',
    near(inner.nw, layer4 + 8 / 9, F32) && near(inner.se, layer4 + 8 / 9, F32),
    `${inner.nw - layer4}`);
  const edge = tops.get('10,10');
  assert('and its outside corner tapers toward the air beside it',
    edge.nw < inner.nw - 0.1, `${edge.nw} vs ${inner.nw}`);
  assert('a pool sitting on the ground has no underside',
    facing(buf.still, -1) === 0 && facing(buf.flowing, -1) === 0);
}

// A column of water shows its walls and nothing else, and the walls reach the
// full height of the cell so the fall has no gaps in it.
{
  const w = new World(1, { flat: FLAT });
  for (let y = 5; y <= 9; y++) w.setBlock(20, y, 20, waterId(0));
  w.setBlock(20, 10, 20, WATER);
  const buf = meshChunk(w, 0, 0, true).water;
  assert('a waterfall is drawn as moving water', quadCount(buf.flowing) > 0);
  assert('...four walls per cell of it', facing(buf.flowing, 0) === 4 * 6,
    facing(buf.flowing, 0));
  assert('the cells inside the fall have no lid', topFaces(buf.flowing).size === 0,
    topFaces(buf.flowing).size);

  // The point of the walls: seen from the side, a falling column has to be a
  // continuous ribbon of water. Take one face of it, stack the quads up, and
  // there must be no gap anywhere between the ground and the surface at the
  // top — a gap is a slot you can see the sky through.
  const spans = [];
  for (let q = 0; q < buf.flowing.pos.length; q += 18) {
    if (buf.flowing.n[q + 2] !== -1) continue; // the north wall only
    let lo = Infinity;
    let hi = -Infinity;
    for (let v = 0; v < 18; v += 3) {
      lo = Math.min(lo, buf.flowing.pos[q + v + 1]);
      hi = Math.max(hi, buf.flowing.pos[q + v + 1]);
    }
    spans.push([lo, hi]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let gaps = 0;
  for (let i = 1; i < spans.length; i++) {
    if (!near(spans[i - 1][1], spans[i][0], F32)) gaps++;
  }
  assert('the wall of the fall is one unbroken ribbon', spans.length === 6 && gaps === 0,
    `${spans.length} spans, ${gaps} gaps`);
  assert('...starting at the ground', near(spans[0][0], toLayer(5), F32), spans[0][0]);
  const crest = spans[spans.length - 1][1] - toLayer(10);
  assert('...and ending part way up the source feeding it',
    crest > 0 && crest <= 8 / 9 + F32, crest);
}

// The real ocean, meshed. This is the case the screenshot came from.
{
  const w = new World(WORLD_SEED);
  let coast = null;
  for (let cx = 0; cx < 24 && !coast; cx++) {
    for (let cz = 0; cz < 24; cz++) {
      // A chunk with sea in it and land nearby: the shoreline, where the
      // surface has to meet the beach without falling apart.
      if (w.get(cx * CHUNK_SIZE, SEA_LEVEL, cz * CHUNK_SIZE) === WATER
          && w.heightAt(cx * CHUNK_SIZE + 16, cz * CHUNK_SIZE + 16) > SEA_LEVEL - 3) {
        coast = [cx, cz];
        break;
      }
    }
  }
  assert('the world has a coastline', coast !== null, JSON.stringify(coast));
  if (coast) {
    const buf = meshChunk(w, coast[0], coast[1], true).water;
    const tops = topFaces(buf.still);
    for (const [key, face] of topFaces(buf.flowing)) tops.set(key, face);
    assert('the sea there is drawn', tops.size > 0, tops.size);

    let mismatched = 0;
    for (const face of tops.values()) {
      const east = tops.get(`${face.x + 1},${face.z}`);
      if (east && (!near(face.ne, east.nw, 1e-5) || !near(face.se, east.sw, 1e-5))) mismatched++;
      const south = tops.get(`${face.x},${face.z + 1}`);
      if (south && (!near(face.sw, south.nw, 1e-5) || !near(face.se, south.ne, 1e-5))) mismatched++;
    }
    assert('and it has no gaps in it', mismatched === 0, mismatched);

    const flat = [...tops.values()].filter((f) =>
      near(f.nw, f.se, F32) && near(f.nw, toLayer(SEA_LEVEL) + 8 / 9, F32));
    assert('most of the sea is dead level', flat.length > tops.size * 0.5,
      `${flat.length}/${tops.size}`);
  }
}

// Two textures, and a chunk only pays for the one it needs.
{
  assert('still and flowing are separate buffers', STILL === 0 && FLOWING === 1);
  const w = new World(1, { flat: FLAT });
  const dry = meshChunk(w, 5, 5, true).water;
  assert('a chunk with no water costs no water geometry',
    quadCount(dry.still) === 0 && quadCount(dry.flowing) === 0);
}

// ------------------------------------------------------------ the sea itself
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

    // An untouched sea has nothing to do: it is millions of blocks of water
    // that cost exactly nothing, because nothing is happening to them.
    const flow = new WaterFlow(w);
    assert('an undisturbed sea does no work', flow.step(x, SEA_LEVEL, z) === 0);
  }
}

// ---------------------------------------------------------------- the current
{
  assert('a current settles at Minecraft\'s 0.07 blocks a tick',
    near(FLOW_PUSH_SPEED, 0.014 / (1 - 0.8) * 20, 1e-9), FLOW_PUSH_SPEED);
}

// ------------------------------------------------- what the shader is told
//
// Four bytes a vertex — depth, shore, wave amplitude, churn — and the shader
// can do nothing the mesher has not measured for it. These check the
// measurements, and one invariant that the geometry depends on: a corner's
// wave amplitude has to be the same number wherever it is read, or the
// surface and the wall beneath it come apart when the swell lifts one and not
// the other.
{
  const info = new Float64Array(3);

  // Open sea, four blocks of it, nothing else in reach.
  const deep = sampler({}, WATER);
  const seaFloor = (x, y, z) => (y < -4 ? GRASS : y <= 0 ? WATER : AIR);
  fluidCornerInfo(seaFloor, 3, 0, 3, info);
  assert('open water touches no shore', info[1] === 0, info[1]);
  assert('...and reports how deep it is', near(info[2], 5 / DEPTH_SCALE, 1e-9), info[2]);

  // A straight coastline: two of the four cells at this corner are land.
  const coast = (x, y, z) => (y < 0 ? GRASS : y > 0 ? AIR : (x < 0 ? WATER : GRASS));
  fluidCornerInfo(coast, 0, 0, 0, info);
  assert('a straight coast is half shore', near(info[1], 0.5, 1e-9), info[1]);
  assert('...and only the wet half counts toward the depth',
    near(info[2], 1 / DEPTH_SCALE, 1e-9), info[2]);

  // The depth walk gives up rather than counting an ocean trench forever.
  fluidCornerInfo(deep, 0, 0, 0, info);
  assert('the depth scale tops out', near(info[2], 1, 1e-9), info[2]);

  assert('deep water rides the full swell', near(fluidWaveAmount(8 / 9, 0), 1, 1e-9));
  assert('the shore pins the surface down', fluidWaveAmount(8 / 9, 1) < 0.2,
    fluidWaveAmount(8 / 9, 1));
  const thin = fluidWaveAmount(1 / 9, 0);
  assert('a one-ninth puddle barely moves at all', thin < 0.15 && thin > 0,
    thin.toFixed(3));
  assert('...by less than its own depth, so it cannot dip through the floor',
    thin * 0.054 < 1 / 9, (thin * 0.054).toFixed(4));
}

{
  // A pool with a wall, meshed for real: every vertex carries four channels,
  // and the ones the top and the side share agree exactly.
  const { w } = pool((world) => {
    for (let x = 8; x < 12; x++) {
      for (let z = 8; z < 12; z++) world.setBlock(x, FLAT + 1, z, WATER);
    }
  });
  const { still, flowing } = meshChunk(w, 0, 0, true).water;
  const channels = (buf) => buf.data.length / 4;
  assert('every water vertex carries four channels',
    channels(still) === still.pos.length / 3 && channels(flowing) === flowing.pos.length / 3,
    `${channels(still)} + ${channels(flowing)}`);

  // Collect (x, y, z) -> wave amplitude across both buffers and check that no
  // position is ever given two different amplitudes. This is the weld.
  const waveAt = new Map();
  let disagreement = null;
  for (const buf of [still, flowing]) {
    for (let v = 0; v < buf.pos.length / 3; v++) {
      const key = `${buf.pos[v * 3].toFixed(3)},${buf.pos[v * 3 + 1].toFixed(3)},${buf.pos[v * 3 + 2].toFixed(3)}`;
      const wave = buf.data[v * 4 + 2];
      if (waveAt.has(key) && waveAt.get(key) !== wave) {
        disagreement = `${key}: ${waveAt.get(key)} vs ${wave}`;
      }
      waveAt.set(key, wave);
    }
  }
  assert('a shared vertex is never told to bob by two different amounts',
    disagreement === null, disagreement ?? '');

  // The floor of a wall is standing on the ground and must never move.
  let pinned = true;
  for (let v = 0; v < flowing.pos.length / 3; v++) {
    const y = flowing.pos[v * 3 + 1];
    if (Number.isInteger(y) && flowing.data[v * 4 + 2] !== 0) pinned = false;
  }
  assert('the foot of a wall of water is pinned to the floor', pinned);

  // Still water is still: nothing in the pool is churning.
  let calm = true;
  for (let v = 0; v < still.pos.length / 3; v++) if (still.data[v * 4 + 3] > 0) calm = false;
  assert('a pool has no whitewater in it', calm);
}

// -------------------------------------------------------------- a waterfall
//
// A fall is the case every one of these channels was getting wrong at once,
// and the result was a sheet of white paper hanging in a shaft. The shader
// reads three of them off a wall — how broken it is, how much it may bob, and
// what is behind it — so this is where the mesher has to be right:
//
//   * the face of a fall is *fully* broken, and the exposed edge of a pool is
//     hardly broken at all, and they cannot carry the same number, because
//     the froth and the reflection are both scaled by it;
//   * water inside a column must not bob. Its wall runs from the top of its
//     cell to the bottom, the top edge is displaced by the swell and the
//     bottom edge is pinned, so any amplitude at all pulses the fall once per
//     block — the venetian blind you could see down every waterfall.
{
  const { w } = pool((world, flow) => {
    // A pillar with a source on top of it: the water spreads over the top and
    // falls off every side, which is the only way a fall has faces to draw —
    // a shaft the same width as the water hides them behind the rock.
    for (let y = FLAT + 1; y <= FLAT + 8; y++) world.setBlock(21, y, 21, GRASS);
    world.setBlock(21, FLAT + 9, 21, WATER);
    flow.touch(21, FLAT + 9, 21);
  });

  const { flowing } = meshChunk(w, 0, 0, true).water;
  // Walls of the column: the quads standing in the shaft, above its floor.
  let fallVerts = 0;
  let bobbing = 0;
  let slack = 0;
  let fullChurn = 0;
  let footChurn = 0;
  for (let v = 0; v < flowing.pos.length / 3; v++) {
    const x = flowing.pos[v * 3];
    const y = flowing.pos[v * 3 + 1];
    const z = flowing.pos[v * 3 + 2];
    if (x < 19 || x > 24 || z < 19 || z > 24) continue;
    // Between the foot and the lip: everything here is water on its way down
    // the side of the pillar. The mesher works in layers rather than world
    // heights — a chunk-local y fits in a byte and a world one does not — so
    // the window is converted rather than guessed at.
    if (y <= toLayer(FLAT + 2) || y >= toLayer(FLAT + 9)) continue;
    fallVerts++;
    if (flowing.data[v * 4 + 2] !== 0) bobbing++;      // wave amplitude
    // Churn, as a byte. A wall is broken all the way down but not evenly:
    // the top edge carries the cell's own churn and the foot a little over
    // half of it, so the froth thins out as the fall crosses each block. Both
    // edges of a full-height wall sit on whole numbers, so the two are told
    // apart by their value rather than their height.
    const churn = flowing.data[v * 4 + 3];
    if (churn === 255) fullChurn++;
    else if (churn === Math.round(255 * 0.55)) footChurn++;
    else slack++;
  }
  assert('a fall has faces to draw', fallVerts > 0, fallVerts);
  assert('...none of which bob', bobbing === 0, `${bobbing} of ${fallVerts}`);
  assert('...every one of which is broken', slack === 0, `${slack} of ${fallVerts}`);
  assert('...fully at the top of each block and less at its foot',
    fullChurn > 0 && fullChurn === footChurn, `${fullChurn} vs ${footChurn}`);

  // And the other half of the rule: the exposed edge of water that is not
  // going anywhere is not a cataract.
  const { w: ledge } = pool((world) => {
    for (let x = 4; x <= 6; x++) world.setBlock(x, FLAT + 1, 4, WATER);
    world.setBlock(4, FLAT, 4, GRASS); // something under it, so it is not falling
    world.setBlock(5, FLAT, 4, GRASS);
    world.setBlock(6, FLAT, 4, GRASS);
  });
  const edge = meshChunk(ledge, 0, 0, true).water.flowing;
  let stillEdge = null;
  for (let v = 0; v < edge.pos.length / 3; v++) {
    // The top edge of the wall, which carries the cell's own churn; the foot
    // of it carries a little over half as much.
    if (Number.isInteger(edge.pos[v * 3 + 1])) continue;
    const churn = edge.data[v * 4 + 3] / 255;
    if (churn > 0 && churn < 1) stillEdge = churn;
  }
  assert('the edge of standing water is barely broken at all',
    stillEdge !== null && stillEdge < 0.5, stillEdge);
  assert('...which is the number the mesher says it is',
    stillEdge === null || Math.abs(stillEdge - STILL_EDGE_CHURN) < 0.01, stillEdge);
}

// ----------------------------------------------------------------- buckets
//
// The rules are small and every one of them exists because the obvious
// alternative is wrong, so they are all worth writing down.
{
  assert('items live above every block id', ITEM_BASE > WATER_LAST);
  assert('...so no block is ever mistaken for one',
    ![WATER, WATER_LAST, GRASS, AIR, 255 - 1].some((id) => id < ITEM_BASE && isItem(id)));
  assert('a bucket is an item and water is not',
    isItem(BUCKET) && isItem(WATER_BUCKET) && !isItem(WATER));

  const { w } = pool((world) => {
    world.setBlock(4, FLAT + 1, 4, WATER);           // a source, alone
    world.setBlock(10, FLAT + 1, 10, waterId(3));    // some flowing water
  });
  const hit = (x, y, z, nx = 0, ny = 1, nz = 0) => ({ x, y, z, nx, ny, nz });

  const filled = useBucket(w, hit(4, FLAT + 1, 4), BUCKET);
  assert('an empty bucket fills from a source',
    filled?.item === WATER_BUCKET && filled.block === AIR, JSON.stringify(filled));

  const scooped = useBucket(w, hit(10, FLAT + 1, 10), BUCKET);
  assert('...but not from flowing water',
    scooped?.item === undefined && Boolean(scooped?.message), JSON.stringify(scooped));
  assert('...and not from thin air', useBucket(w, hit(20, FLAT + 1, 20), BUCKET) === null);
  assert('an empty bucket used on nothing at all does nothing',
    useBucket(w, null, BUCKET) === null);

  // Pouring. Onto the face of a solid it goes in front of it; onto flowing
  // water it goes *into* it, or you could never finish filling a pond.
  const onGround = useBucket(w, hit(6, FLAT, 6), WATER_BUCKET);
  assert('a full bucket pours onto the face you are looking at',
    onGround?.block === WATER && onGround.y === FLAT + 1, JSON.stringify(onGround));
  assert('...and turns back into an empty one', onGround?.item === BUCKET);

  const intoFlow = useBucket(w, hit(10, FLAT + 1, 10), WATER_BUCKET);
  assert('pouring into flowing water makes it a source',
    intoFlow?.block === WATER && intoFlow.x === 10 && intoFlow.y === FLAT + 1);

  assert('pouring into a source does nothing, rather than eating the bucket',
    useBucket(w, hit(4, FLAT + 1, 4), WATER_BUCKET) === null);
  assert('...and neither does pouring into solid rock',
    useBucket(w, { x: 6, y: FLAT, z: 6, nx: 0, ny: -1, nz: 0 }, WATER_BUCKET) === null);

  // And the thing it is all for: water you carried somewhere spreads when it
  // gets there, exactly like water that was always there.
  const { w: dry, flow } = pool(() => {});
  const poured = useBucket(dry, hit(16, FLAT, 16), WATER_BUCKET);
  dry.setBlock(poured.x, poured.y, poured.z, poured.block);
  flow.touch(poured.x, poured.y, poured.z);
  let steps = 0;
  while (!flow.settled && steps < 400) { flow.step(16, FLAT + 1, 16); steps++; }
  assert('a bucket emptied on dry ground spreads like any other source',
    level(dry, 16 + 3, FLAT + 1, 16) === 3, level(dry, 16 + 3, FLAT + 1, 16));
  assert('...and reaches exactly as far as the sea would',
    level(dry, 16 + 7, FLAT + 1, 16) === 7 && level(dry, 16 + 8, FLAT + 1, 16) === null);
}

// -------------------------------------------------------- aiming at water
{
  // Block targeting goes through water on purpose; a bucket must not.
  const { w } = pool((world) => {
    for (let x = 4; x <= 9; x++) world.setBlock(x, FLAT + 1, 4, WATER);
  });
  const from = { x: 0.5, y: FLAT + 1.5, z: 4.5 };
  const east = { x: 1, y: 0, z: 0 };

  const solid = raycastVoxel(w, from, east, 20);
  assert('the block ray goes straight through the sea',
    solid === null || solid.x > 9, JSON.stringify(solid));

  const fluid = raycastVoxel(w, from, east, 20, { fluids: true });
  assert('a bucket\'s ray stops at the water', fluid?.x === 4, JSON.stringify(fluid));
  assert('...on the face it came in through', fluid?.nx === -1);

  // Standing in it, the first cell is your own head and does not count.
  const inside = { x: 4.5, y: FLAT + 1.5, z: 4.5 };
  const ahead = raycastVoxel(w, inside, east, 20, { fluids: true });
  assert('swimming, a bucket fills from what you are looking at',
    ahead?.x === 5, JSON.stringify(ahead));
}

// ------------------------------------------------- reaching past the flow
//
// The case that made this a rule: a source with flowing water in front of it.
// A stream running over the sea, a waterfall in front of a pool, the thin
// spreading edge of the pond you are trying to top up — all of them used to
// stand between an empty bucket and the water it was pointed at, and all the
// bucket would say was that flowing water runs through your fingers. It does,
// which is why the ray should not have stopped on it.
{
  const { w } = pool((world) => {
    // Three blocks of flow, then the source behind them.
    for (let x = 4; x <= 6; x++) world.setBlock(x, FLAT + 1, 4, waterId(2));
    world.setBlock(7, FLAT + 1, 4, WATER);
    world.setBlock(9, FLAT + 1, 4, GRASS); // a wall past the water
  });
  const from = { x: 0.5, y: FLAT + 1.5, z: 4.5 };
  const east = { x: 1, y: 0, z: 0 };

  const anyWater = raycastVoxel(w, from, east, 20, { fluids: true });
  assert('a full bucket still stops at the first water there is',
    anyWater?.x === 4, JSON.stringify(anyWater));
  assert('...and knows it went through none to get there', !anyWater.throughWater);

  const source = raycastVoxel(w, from, east, 20, { fluids: 'source' });
  assert('an empty bucket looks past the flow to the source behind it',
    source?.x === 7, JSON.stringify(source));
  assert('...and says that it passed through water on the way',
    source.throughWater === true);
  assert('...arriving on the face it came in through', source.nx === -1);

  assert('the flow it passed is exactly what a bucket cannot fill from',
    useBucket(w, anyWater, BUCKET)?.item === undefined);
  const filled = useBucket(w, source, BUCKET);
  assert('...while the source behind it fills the bucket',
    filled?.item === WATER_BUCKET && filled.x === 7, JSON.stringify(filled));

  // Nothing but flow between you and a wall: the ray gets to the wall, and
  // the bucket still has something to say about why it came back empty.
  const { w: dryish } = pool((world) => {
    for (let x = 4; x <= 6; x++) world.setBlock(x, FLAT + 1, 4, waterId(2));
    world.setBlock(7, FLAT + 1, 4, GRASS);
  });
  const wall = raycastVoxel(dryish, from, east, 20, { fluids: 'source' });
  assert('with no source behind it the ray runs on to the rock',
    wall?.x === 7 && wall.throughWater === true, JSON.stringify(wall));
  const nothing = useBucket(dryish, wall, BUCKET);
  assert('...and the bucket says what it found rather than nothing at all',
    nothing?.item === undefined && Boolean(nothing?.message), JSON.stringify(nothing));

  // Which item aims which way is the rule that makes the two cases different.
  assert('an empty bucket seeks sources', fluidAim(BUCKET) === 'source');
  assert('a full one takes any water it can pour into', fluidAim(WATER_BUCKET) === true);
  assert('and a block is aimed at like a block', fluidAim(GRASS) === false);
}

// --------------------------------------------------------------- particles
//
// The pool is the part worth testing: a fixed buffer, dead particles swapped
// to the end of the live range so both spawning and killing are O(1), and
// nothing allocated after the constructor. Get the swap wrong and particles
// quietly inherit each other's velocities, which looks like a physics bug and
// is a bookkeeping one.
{
  const { w } = pool((world) => {
    for (let x = 0; x < 6; x++) {
      for (let z = 0; z < 6; z++) world.setBlock(x, FLAT + 1, z, WATER);
    }
  });
  const scene = new THREE.Scene();
  const fx = new Particles(scene, { max: 64 });

  assert('the pool starts empty', fx.count === 0);
  assert('one draw call for all of it', scene.children.length === 1);

  fx.spawn(1, 20, 1, 0, 0, 0, DROPLET, 1, 0.05, [1, 1, 1]);
  fx.spawn(2, 20, 2, 0, 0, 0, FOAM, 1, 0.05, [1, 1, 1]);
  fx.spawn(3, 20, 3, 0, 0, 0, DROPLET, 1, 0.05, [1, 1, 1]);
  assert('spawning fills the live range', fx.count === 3);

  // Kill the middle one; the last should take its place, not leave a hole.
  fx._kill(1);
  assert('killing swaps the last one down', fx.count === 2 && fx.px[1] === 3,
    `${fx.count} left, slot 1 is at x=${fx.px[1]}`);

  // Fill it past the brim.
  fx.clear();
  for (let i = 0; i < 200; i++) fx.spawn(0, 20, 0, 0, 0, 0, DROPLET, 1, 0.05, [1, 1, 1]);
  assert('the pool never overflows', fx.count === 64, fx.count);
  assert('...and says so rather than throwing',
    fx.spawn(0, 20, 0, 0, 0, 0, DROPLET, 1, 0.05, [1, 1, 1]) === false);

  // A paused game is a still one, particles included.
  fx.clear();
  fx.spawn(1.5, 20, 1.5, 0, -5, 0, DROPLET, 1, 0.05, [1, 1, 1]);
  fx.update(0, w);
  assert('nothing moves while the game is paused',
    fx.count === 1 && fx.py[0] === 20, fx.py[0]);

  // Falling into water ends a droplet: it has joined the water.
  fx.clear();
  fx.spawn(1.5, FLAT + 2.2, 1.5, 0, -6, 0, DROPLET, 4, 0.05, [1, 1, 1]);
  for (let i = 0; i < 60 && fx.count > 0; i++) fx.update(1 / 60, w);
  assert('a droplet that lands in water is gone', fx.count === 0);

  // ...and so does hitting rock.
  fx.clear();
  fx.spawn(20.5, FLAT + 3, 20.5, 0, -6, 0, DROPLET, 4, 0.05, [1, 1, 1]);
  for (let i = 0; i < 60 && fx.count > 0; i++) fx.update(1 / 60, w);
  assert('a droplet that lands on the ground is gone too', fx.count === 0);

  // A bubble rises and pops at the surface rather than flying off into the sky.
  fx.clear();
  fx.bubble(1.5, FLAT + 1.1, 1.5);
  let popped = false;
  for (let i = 0; i < 300; i++) {
    fx.update(1 / 60, w);
    if (fx.count === 0) { popped = true; break; }
    if (fx.py[0] > FLAT + 3) break;
  }
  assert('a bubble pops when it reaches the surface', popped,
    fx.count ? `still going at y=${fx.py[0].toFixed(2)}` : 'gone');

  // How hard you hit the water is the only thing that decides the splash.
  fx.clear();
  fx.splash(1.5, FLAT + 2, 1.5, 2);
  const gentle = fx.count;
  fx.clear();
  fx.splash(1.5, FLAT + 2, 1.5, 20);
  const hard = fx.count;
  assert('a bigger fall makes a bigger splash', hard > gentle * 1.8,
    `${gentle} against ${hard}`);
  assert('...and neither of them empties the pool', hard <= 64);

  // The draw range only ever covers live particles: anything past it is stale
  // memory, and pointing the GPU at it draws last frame's splash for ever.
  fx.clear();
  fx.spawn(1, 20, 1, 0, 0, 0, FOAM, 1, 0.05, [1, 1, 1]);
  fx.update(1 / 60, w);
  assert('the GPU is only shown the live range',
    fx.geometry.drawRange.count === fx.count, fx.geometry.drawRange.count);
}

// ------------------------------------------------------- the render passes
//
// The shading itself is GLSL and cannot be run here, but the arithmetic that
// decides *where* it samples can, and it is the part that is easy to get
// silently wrong. A planar reflection has one property that has to hold: a
// point lying on the water plane must land at the same place on screen
// whether it is projected by the real camera or by the mirrored one. If that
// is true the reflection is anchored to the surface; if it is out by a
// fraction the whole reflection slides as you walk.
{
  const noopRenderer = {
    getDrawingBufferSize: (v) => v.set(64, 64),
    shadowMap: {},
  };
  const view = new WaterView(noopRenderer, { quality: WATER_FAST });
  assert('the lowest setting runs no extra passes',
    !view.wantsRefraction && !view.wantsReflection);
  view.setQuality(WATER_FANCY);
  assert('fancy measures what is behind the water',
    view.wantsRefraction && !view.wantsReflection);
  view.setQuality(WATER_ULTRA);
  assert('...and the top setting mirrors what is above it',
    view.wantsRefraction && view.wantsReflection);

  const material = { defines: {} };
  view.useMaterials([material]);
  assert('the materials are compiled for the passes that are running',
    material.defines.USE_REFRACTION === 1 && material.defines.USE_REFLECTION === 1);
  view.setQuality(WATER_FAST);
  assert('...and recompiled when they stop', material.defines.USE_REFLECTION === 0
    && material.needsUpdate === true);

  // Now the geometry. Camera above the water, looking down at it at an angle.
  const camera = new THREE.PerspectiveCamera(70, 1.5, 0.1, 1000);
  camera.position.set(12, 66.5, -4);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(-0.35, 0.8, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  view.planeY = 62 + 8 / 9;
  view._aimMirror(camera);
  const mirror = view.mirrorCamera;
  assert('the mirrored camera is the same distance the other side',
    near(mirror.position.y, 2 * view.planeY - camera.position.y, 1e-6),
    mirror.position.y.toFixed(4));
  assert('...directly below the real one',
    near(mirror.position.x, camera.position.x, 1e-9)
    && near(mirror.position.z, camera.position.z, 1e-9));

  const forward = (cam) => new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const a = forward(camera);
  const b = forward(mirror);
  assert('...looking the mirror image of the way the real one looks',
    near(a.x, b.x, 1e-6) && near(a.z, b.z, 1e-6) && near(a.y, -b.y, 1e-6),
    `${a.y.toFixed(3)} vs ${b.y.toFixed(3)}`);

  // A mirror matrix would flip the winding of every triangle in the world.
  // Building the reflection out of a position and a look-at keeps it a
  // rotation, and this is the number that says so.
  assert('the mirrored view is a rotation, not a reflection',
    new THREE.Matrix4().extractRotation(mirror.matrixWorld).determinant() > 0.999,
    new THREE.Matrix4().extractRotation(mirror.matrixWorld).determinant().toFixed(4));

  // The property that actually matters, and the only one worth writing down:
  // take something standing above the water, work out where its reflection
  // *should* appear on the surface, and check that the water there looks it up
  // in the right place in the reflection texture.
  //
  // The image in that texture is left-right mirrored — flipping the camera's
  // up vector is what keeps the transform a rotation, and the cost is a
  // mirrored frame — so comparing against the real camera's screen position
  // would be comparing against the wrong thing. The lookup is correct when it
  // agrees with where the *mirrored* camera drew the object.
  const texMatrix = view._reflectionMatrix();
  const eye = camera.position;
  let worst = 0;
  for (const [qx, qy, qz] of [[14, 70, -12], [4, 68, -20], [22, 74, 2]]) {
    const tree = new THREE.Vector3(qx, qy, qz);
    const image = new THREE.Vector3(qx, 2 * view.planeY - qy, qz);
    // Where the line from the eye to the reflected point crosses the water.
    const t = (view.planeY - eye.y) / (image.y - eye.y);
    const onSurface = eye.clone().lerp(image, t);

    const lookup = onSurface.clone().applyMatrix4(texMatrix);
    const drawn = tree.clone().project(mirror);
    worst = Math.max(worst,
      Math.abs(lookup.x - (drawn.x * 0.5 + 0.5)),
      Math.abs(lookup.y - (drawn.y * 0.5 + 0.5)));
  }
  assert('the water looks up a reflection exactly where it was drawn',
    worst < 1e-5, worst.toExponential(2));
}

// ------------------------------------------------------------- the shading
{
  // Absorption is the colour of water now, so the constants are worth an
  // assertion or two of their own.
  const t = (c, d) => Math.exp(-c * d);
  assert('red is absorbed fastest and blue slowest',
    ABSORB.x > ABSORB.y && ABSORB.y > ABSORB.z);
  assert('a hand\'s depth barely tints anything', t(ABSORB.x, 0.5) > 0.8,
    t(ABSORB.x, 0.5).toFixed(3));
  assert('a couple of blocks takes half the red', t(ABSORB.x, 2) < 0.55,
    t(ABSORB.x, 2).toFixed(3));
  assert('...and leaves nearly all the blue', t(ABSORB.z, 2) > 0.9,
    t(ABSORB.z, 2).toFixed(3));
  assert('eight blocks is blue and nothing else',
    t(ABSORB.x, 8) < 0.08 && t(ABSORB.z, 8) > 0.65,
    `${t(ABSORB.x, 8).toFixed(3)} / ${t(ABSORB.z, 8).toFixed(3)}`);
  assert('the sea floor is gone long before the render distance',
    t(ABSORB.z, 64) < 0.07, t(ABSORB.z, 64).toFixed(3));

  // One source of GLSL, used by two shaders. If these ever became two copies,
  // the caustics on the sea floor and the caustics seen from underwater would
  // drift out of step at exactly the waterline, where you would notice.
  assert('the surface and the underwater pass share one caustic function',
    CAUSTIC_GLSL.includes('float caustic(') && CAUSTIC_GLSL.includes('causticRidge'));
  assert('...and one swell', SWELL_GLSL.includes('void swell(')
    && SWELL_GLSL.includes('void ripples('));
  assert('the caustic pattern does not depend on where the origin is',
    !/\/\s*\(?\s*sin/.test(CAUSTIC_GLSL) && !CAUSTIC_GLSL.includes('length('));
}

// ------------------------------------------------------------------ freezing
//
// The rules are Minecraft's `Biome.shouldFreeze`, and the one worth testing
// hardest is the edge rule: ice only forms where the water meets something
// that is not water, which is why a lake freezes from the bank inwards
// instead of turning solid all at once. Everything below is either that rule
// or one of the three that guard it — cold enough, a source, under open sky.

/** Ground at FLAT, a basin dug into it, and a climate fixed below freezing. */
function frozen(build, opts = {}) {
  const w = new World(1, { flat: FLAT, temperature: opts.temperature ?? -0.1 });
  for (let cx = -1; cx < 3; cx++) for (let cz = -1; cz < 2; cz++) w.chunk(cx, cz);
  const flow = new WaterFlow(w);
  // No prospecting: the tests say where the water is, and random columns
  // would make what froze depend on the run.
  const ice = new Freeze(w, flow, { samples: 0, ...opts });
  build(w, flow, ice);
  let steps = 0;
  while (!flow.settled && steps < 400) { flow.step(20, 6, 20); steps++; }
  return { w, flow, ice };
}

/** A pond of sources sunk into the flat ground, so its rim is stone. */
function pond(w, flow, x0, z0, size, y = FLAT) {
  for (let x = x0; x < x0 + size; x++) {
    for (let z = z0; z < z0 + size; z++) {
      w.setBlock(x, y, z, WATER);
      flow.touch(x, y, z);
    }
  }
}

const iceAt = (w, x, y, z) => w.get(x, y, z) === ICE;

// the climate
{
  const mountain = { ocean: 0, plains: 0, forest: 0, desert: 0, mountains: 1 };
  const plains = { ocean: 0, plains: 1, forest: 0, desert: 0, mountains: 0 };
  const half = { ocean: 0, plains: 0.5, forest: 0, desert: 0, mountains: 0.5 };

  assert('mountain ground sits exactly at freezing',
    temperatureWith(mountain, LAPSE_BASE_Y) === 0);
  assert('...so water freezes anywhere the mountains clearly win',
    isFreezing(temperatureWith(mountain, SEA_LEVEL)));
  assert('...and by the snow line it is well below',
    near(temperatureWith(mountain, 120), -0.2, 1e-12), temperatureWith(mountain, 120));
  assert('a mountain half blended into plains does not freeze at sea level',
    !isFreezing(temperatureWith(half, SEA_LEVEL)), temperatureWith(half, SEA_LEVEL));
  assert('...but the same mix does up where the snow is',
    isFreezing(temperatureWith(half, 175)), temperatureWith(half, 175));
  // The sea must not ice over off a beach, and the world stops at 190.
  assert('plains never reach freezing, at any height in the world',
    !isFreezing(temperatureWith(plains, WORLD_MAX_Y)), temperatureWith(plains, WORLD_MAX_Y));
  assert('the biome mix decides it, not the seed',
    temperatureAt(0, SEA_LEVEL, 0, 1) === temperatureWith(biomeWeights(0, 0, 1), SEA_LEVEL));

  const w = new World(1, { flat: FLAT, temperature: -0.3 });
  assert('a world can be given one climate for the whole of it',
    w.temperatureAt(0, 4, 0) === -0.3 && w.temperatureAt(900, 180, -900) === -0.3);
}

// the four rules
{
  const { w, ice } = frozen((world, flow) => pond(world, flow, 18, 18, 5));

  assert('the rim of a pond is at an edge', ice.atEdge(18, FLAT, 18));
  assert('...and the middle of it is not', !ice.atEdge(20, FLAT, 20));
  assert('so the rim freezes', ice.canFreeze(18, FLAT, 18));
  assert('...and the middle waits for it', !ice.canFreeze(20, FLAT, 20));

  // Only a full block of water freezes. Flowing water is on its way
  // somewhere, and Minecraft will not freeze it.
  w.setBlockTransient(24, FLAT + 1, 24, waterId(2));
  assert('flowing water never freezes', !ice.canFreeze(24, FLAT + 1, 24));

  // A roof, which stands in for Minecraft's light check: the one case either
  // rule was ever really about is building over a pond.
  w.setBlock(18, FLAT + 3, 18, STONE);
  assert('water under a roof does not freeze', !ice.canFreeze(18, FLAT, 18));
  assert('...and the freeze does not even find it',
    ice.surfaceWater(18, 18) === null);
  w.setBlock(18, FLAT + 3, 18, AIR);
  assert('take the roof off and it is a candidate again', ice.canFreeze(18, FLAT, 18));
  assert('...and found by looking down the column',
    ice.surfaceWater(18, 18) === FLAT);
  assert('dry land holds no water to freeze', ice.surfaceWater(30, 30) === null);
}

// somewhere warm
{
  const { ice } = frozen((world, flow) => pond(world, flow, 18, 18, 5), { temperature: 0.8 });
  assert('a pond in the warm never freezes, edge or no edge',
    !ice.canFreeze(18, FLAT, 18) && ice.atEdge(18, FLAT, 18));
}

// the sheet grows inwards
//
// The rule says a cell can only freeze while something beside it is not
// water, so the interesting question is not which cells end up as ice — all
// of them do — but whether any cell ever froze out of turn. One cell a step,
// and the whole order is there to check: every cell in it was either on the
// rim, where the pond meets stone, or had a neighbour that had already
// frozen. Nothing ices over in open water.
{
  const { w, ice } = frozen((world, flow) => pond(world, flow, 18, 18, 5), { budget: 1 });
  const rim = (x, z) => x === 18 || x === 22 || z === 18 || z === 22;
  const order = [];
  let steps = 0;
  while (steps < 200 && order.length < 25) {
    const before = new Set(ice.frozen);
    ice.step(20, 20, 20);
    for (const key of ice.frozen) if (!before.has(key)) order.push(key.split(',').map(Number));
    steps++;
  }

  assert('the first thing to freeze is at the bank', order.length > 0 && rim(order[0][0], order[0][2]),
    order[0] && order[0].join(','));
  let outOfTurn = null;
  const already = new Set();
  for (const [x, y, z] of order) {
    const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([dx, dz]) => already.has(`${x + dx},${y},${z + dz}`));
    if (!rim(x, z) && !beside) outOfTurn = `${x},${z}`;
    already.add(`${x},${y},${z}`);
  }
  assert('nothing freezes in open water', outOfTurn === null, outOfTurn);
  assert('...and all twenty-five get there in the end', order.length === 25, order.length);

  let all = true;
  for (let x = 18; x < 23; x++) for (let z = 18; z < 23; z++) if (!iceAt(w, x, FLAT, z)) all = false;
  assert('given long enough the whole pond is ice', all);
  assert('...one cell a step, as budgeted', steps >= 25, steps);
  assert('...and then it settles', ice.step(20, 20, 20) === 0);
}

// what freezing costs the save file: nothing
{
  const { w, ice } = frozen((world, flow) => pond(world, flow, 18, 18, 5));
  const before = w.edits.size;
  while (ice.step(20, 20, 20) > 0);
  assert('ice is never recorded as an edit', w.edits.size === before, w.edits.size);
  assert('...though the world is full of it', ice.frozen.size === 25, ice.frozen.size);
}

// ice is ground, as far as the water is concerned
{
  const { w, flow, ice } = frozen((world, f) => pond(world, f, 18, 18, 5));
  while (ice.step(20, 20, 20) > 0);
  assert('ice is opaque', isOpaque(ICE) && !isWater(ICE));
  // A source poured against the sheet has nowhere to go through it.
  w.setBlock(24, FLAT + 1, 24, WATER);
  flow.touch(24, FLAT + 1, 24);
  let steps = 0;
  while (!flow.settled && steps < 200) { flow.step(20, 6, 20); steps++; }
  assert('water does not flow into ice', iceAt(w, 22, FLAT, 22));
  assert('...it runs over the top of it', isWater(w.get(22, FLAT + 1, 22)));
}

// thawing
{
  const { w, ice } = frozen((world, flow) => pond(world, flow, 18, 18, 5));
  while (ice.step(20, 20, 20) > 0);
  assert('the pond is frozen over', iceAt(w, 20, FLAT, 20));

  // Build over it. Nothing touches the ice itself, so only the rolling
  // review of what we have frozen can notice — which is the point of it.
  for (let x = 18; x < 23; x++) for (let z = 18; z < 23; z++) w.setBlock(x, FLAT + 3, z, STONE);
  let steps = 0;
  while (steps < 200 && ice.frozen.size > 0) { ice.step(20, 20, 20); steps++; }
  assert('a roof thaws the ice under it', !iceAt(w, 20, FLAT, 20));
  assert('...back into the water it was made of', w.get(20, FLAT, 20) === WATER);
  assert('...and the freeze forgets it', ice.frozen.size === 0);
}

// chipping it out
{
  const { w, ice } = frozen((world, flow) => pond(world, flow, 18, 18, 5));
  while (ice.step(20, 20, 20) > 0);
  assert('ice over water leaves water when broken',
    ice.chip(20, FLAT, 20) && w.get(20, FLAT, 20) === WATER);
  assert('...and is no longer ours to watch', ice.frozen.size === 24, ice.frozen.size);

  // Ice hanging over a hole leaves nothing: break the floor out first and it
  // is how you get rid of water you cannot carry away.
  const { w: w2, ice: ice2 } = frozen((world, flow) => {
    world.setBlock(20, FLAT + 1, 20, WATER);
    flow.touch(20, FLAT + 1, 20);
  });
  ice2.freeze(20, FLAT + 1, 20);
  w2.setBlock(20, FLAT, 20, AIR);
  assert('ice over a hole leaves nothing',
    ice2.chip(20, FLAT + 1, 20) && w2.get(20, FLAT + 1, 20) === AIR);
  assert('breaking anything else is not the freeze pass\'s business',
    !ice2.chip(20, FLAT, 20));
}

// a hole in the ice stays a hole, for a while
{
  const { w, ice } = frozen((world, flow) => pond(world, flow, 18, 18, 5),
    { refreezeDelay: 4 });
  while (ice.step(20, 20, 20) > 0);
  ice.chip(20, FLAT, 20);
  ice.step(20, 20, 20);
  assert('a hole chopped in the ice does not close behind you',
    w.get(20, FLAT, 20) === WATER, w.get(20, FLAT, 20));
  for (let i = 0; i < 5; i++) ice.step(20, 20, 20);
  assert('...but it does close', w.get(20, FLAT, 20) === ICE, w.get(20, FLAT, 20));
}

// the two halves talk
{
  const { w, flow, ice } = frozen((world, f) => pond(world, f, 18, 18, 5));
  assert('the flow forwards what it touches to the freeze', flow.ice === ice);
  while (!flow.settled) flow.step(20, 6, 20);
  ice.freeze(18, FLAT, 18);
  assert('...and freezing wakes the flow back up', !flow.settled);
  assert('water taken by the ice is gone from the cell', w.get(18, FLAT, 18) === ICE);
  const changed = ice.step(20, 20, 20);
  assert('the freeze reports what it changed, for the debug screen',
    ice.lastChanged === changed, `${ice.lastChanged} vs ${changed}`);
}

// and in a world that was not built for the test
//
// Everything above fixes the climate to take the biome noise out of it. This
// one does not: it is the game's own seed, a real mountain 507 blocks from
// spawn, bare rock at 97 — above the line where the stone comes through and
// below the one where the snow starts — and a bucket poured out on it.
{
  const w = new World(WORLD_SEED);
  const x = -507;
  const z = 72;
  const ground = w.heightAt(x, z);
  assert('the seed has a mountain where this test says it does',
    ground === 97 && biomeWeights(x, z, WORLD_SEED).mountains > 0.9, ground);
  assert('...and it is below freezing up there',
    isFreezing(w.temperatureAt(x, ground + 1, z)),
    w.temperatureAt(x, ground + 1, z).toFixed(3));

  const flow = new WaterFlow(w);
  const ice = new Freeze(w, flow, { samples: 0 });
  w.setBlock(x, ground + 1, z, WATER);
  flow.touch(x, ground + 1, z);
  let steps = 0;
  while (!flow.settled && steps < 200) { flow.step(x, ground, z); steps++; }
  // It runs off down the mountainside, as it would anywhere else.
  const flowing = [];
  for (let dx = -8; dx <= 8; dx++) {
    for (let dz = -8; dz <= 8; dz++) {
      for (let dy = -6; dy <= 1; dy++) {
        const at = [x + dx, ground + 1 + dy, z + dz];
        if (isWater(w.get(...at)) && !isWaterSource(w.get(...at))) flowing.push(at);
      }
    }
  }
  assert('the bucket runs off down the mountain', flowing.length > 20, flowing.length);

  ice.step(x + 2, ground + 1, z);
  assert('a bucket poured out in the snow freezes', w.get(x, ground + 1, z) === ICE,
    w.get(x, ground + 1, z));
  assert('...and the stream it fed does not, because it is still moving',
    flowing.every(([fx, fy, fz]) => isWater(w.get(fx, fy, fz))));
}

// prospecting: water nothing has disturbed still freezes, eventually
{
  const { w, ice } = frozen((world, flow) => {
    pond(world, flow, 18, 18, 5);
  }, { samples: 64, random: (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })() });
  ice.pending.clear();
  let steps = 0;
  while (steps < 400 && !iceAt(w, 18, FLAT, 18)) { ice.step(20, 20, 20); steps++; }
  assert('random columns find water nothing has touched', iceAt(w, 18, FLAT, 18), `${steps} steps`);
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
