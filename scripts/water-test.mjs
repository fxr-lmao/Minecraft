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
import { WaterFlow, DROP_OFF, SLOPE_FIND_DISTANCE } from '../src/water.js';
import { meshChunk } from '../src/blocks.js';
import {
  fluidCornerHeight, fluidFlow, fluidOwnHeight, STILL, FLOWING,
} from '../src/water-mesh.js';
import {
  WATER, WATER_LEVELS, WATER_MAX_AMOUNT, AIR, GRASS,
  isWater, waterLevel, waterId, waterHeight, waterAmount, waterIdForAmount,
  isOpaque, isWaterSource, SEA_LEVEL,
} from '../src/terrain.js';
import { WORLD_SEED, CHUNK_SIZE, toLayer, FLOW_PUSH_SPEED } from '../src/constants.js';

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

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
