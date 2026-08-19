// Weather: the cycle, what falls where, and the water it puts in the air.
//
// Two halves, and they fail in different ways. The cycle is arithmetic on a
// clock and the thing to get wrong is the ramp — a downpour that arrives
// between two frames rather than over five seconds. What falls where is the
// climate, and the thing to get wrong there is the boundary: rain that turns
// to snow at the wrong height, or a desert that gets a shower.
//
// The emitter half runs on a superflat world with a fixed climate, so
// "spawn a hundred drops and see where they went" has an exact answer.
import * as THREE from '../vendor/three.module.min.js';
import { World, STONE, WATER } from '../src/world.js';
import {
  Weather, CLEAR, RAIN, DRY, RAINING, SNOWING,
  CLEAR_MIN, CLEAR_RANGE, RAIN_MIN, RAIN_RANGE,
  FIRST_CLEAR_MIN, FIRST_CLEAR_RANGE, RAMP_RATE,
} from '../src/weather.js';
import {
  Particles, RAIN as RAIN_KIND, SNOW as SNOW_KIND, FOAM,
  PRECIPITATION_RATE, PRECIPITATION_RADIUS,
} from '../src/particles.js';
import {
  FREEZING_POINT, NO_PRECIPITATION_TEMPERATURE, temperatureWith, SEA_LEVEL,
} from '../src/terrain.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const FLAT = 3;

/** A cycle that always makes the same weather, so a test can predict it. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x80000000;
  };
}

/** Flat ground, chunks preloaded, and one climate for the whole world. */
function world(temperature) {
  const w = new World(1, { flat: FLAT, temperature });
  for (let cx = -2; cx < 3; cx++) for (let cz = -2; cz < 3; cz++) w.chunk(cx, cz);
  return w;
}

/** Run the cycle until it changes state, and say how long that took. */
function untilTurn(weather, dt = 1, cap = 20000) {
  const was = weather.state;
  let t = 0;
  while (weather.state === was && t < cap) { weather.update(dt); t += dt; }
  return t;
}

// ------------------------------------------------------------------ the cycle
{
  const w = new Weather({ random: seeded() });
  assert('a world starts clear', w.state === CLEAR && !w.raining);
  assert('...and dry, not merely un-rained-on', w.level === 0);
  assert('the first spell is a short one', w.left >= FIRST_CLEAR_MIN
    && w.left <= FIRST_CLEAR_MIN + FIRST_CLEAR_RANGE, w.left.toFixed(1));

  const waited = untilTurn(w);
  assert('...and it ends when it says it will',
    waited >= FIRST_CLEAR_MIN && waited <= FIRST_CLEAR_MIN + FIRST_CLEAR_RANGE + 1, waited);
  assert('what follows a clear spell is rain', w.raining);
  assert('rain lasts ten to twenty minutes, as it does in Minecraft',
    w.left >= RAIN_MIN && w.left <= RAIN_MIN + RAIN_RANGE, w.left.toFixed(0));

  // Every spell after the first is the real thing.
  const rained = untilTurn(w, 5);
  assert('...and then it stops', !w.raining, rained);
  assert('clear spells are the long ones', w.left >= CLEAR_MIN, w.left.toFixed(0));
  assert('...up to a little over two hours',
    w.left <= CLEAR_MIN + CLEAR_RANGE, w.left.toFixed(0));
  assert('the spells are counted', w.spells === 2, w.spells);
}

// the ramp
{
  const w = new Weather({ random: seeded(3) });
  w.turn();
  assert('rain does not arrive between two frames', w.level === 0);
  w.update(1);
  assert('...it comes up at the rate it is given', near(w.level, RAMP_RATE, 1e-9), w.level);
  for (let i = 0; i < 5; i++) w.update(1);
  assert('...and takes five seconds to get there', w.level === 1);

  w.turn();
  for (let i = 0; i < 4; i++) w.update(1);
  assert('and dies away just as slowly', near(w.level, 1 - 4 * RAMP_RATE, 1e-9), w.level);
  for (let i = 0; i < 3; i++) w.update(1);
  assert('...down to nothing, and no further', w.level === 0);
}

// a paused game has paused weather
{
  const w = new Weather({ random: seeded(5), state: RAIN, seconds: 30 });
  assert('a cycle can be started mid-storm', w.raining && w.level === 1);
  const left = w.left;
  for (let i = 0; i < 100; i++) w.update(0);
  assert('nothing moves on a zero step', w.left === left && w.level === 1);
}

// --------------------------------------------------------- what falls where
{
  const w = new Weather({ random: seeded(7), state: RAIN, seconds: 600 });

  const warm = world(0.8);   // plains
  const cold = world(-0.1);  // up a mountain
  const hot = world(2.0);    // desert

  assert('rain falls on the plains',
    w.fallAt(warm, 0, FLAT + 1, 0) === RAINING);
  assert('...and comes down as snow where the water would freeze',
    w.fallAt(cold, 0, FLAT + 1, 0) === SNOWING);
  assert('...and not at all on the desert',
    w.fallAt(hot, 0, FLAT + 1, 0) === DRY);

  // The boundary is the freezing point itself, and it is the same number the
  // ice uses: the snow line and the ice line cannot drift apart.
  const justAbove = world(FREEZING_POINT);
  const justBelow = world(FREEZING_POINT - 1e-6);
  assert('at the freezing point exactly it is still rain',
    w.fallAt(justAbove, 0, FLAT + 1, 0) === RAINING);
  assert('...and a hair below it is snow',
    w.fallAt(justBelow, 0, FLAT + 1, 0) === SNOWING);
  assert('the dry line is where the desert takes the column',
    w.fallAt(world(NO_PRECIPITATION_TEMPERATURE - 1e-6), 0, FLAT + 1, 0) === RAINING
    && w.fallAt(world(NO_PRECIPITATION_TEMPERATURE), 0, FLAT + 1, 0) === DRY);

  // Height is half the answer: the same storm over the same column is rain at
  // the shore and snow at the top of the mountain behind it.
  const real = new World(1);
  const mountain = { ocean: 0, plains: 0, forest: 0, desert: 0, mountains: 1 };
  assert('a real mountain is snow at the top and rain at the bottom',
    temperatureWith(mountain, SEA_LEVEL) < FREEZING_POINT);
  assert('...and the plains under it never see snow, at any height',
    temperatureWith({ ocean: 0, plains: 1, forest: 0, desert: 0, mountains: 0 }, 190)
      >= FREEZING_POINT);
  assert('a world is asked for its own temperature, not a global one',
    real.temperatureAt(0, 64, 0) !== real.temperatureAt(4000, 64, 4000));

  const clear = new Weather({ random: seeded(9) });
  assert('nothing falls when it is not raining',
    clear.fallAt(warm, 0, FLAT + 1, 0) === DRY);
}

// the sky has to be able to reach you
{
  const w = new Weather({ random: seeded(11), state: RAIN, seconds: 600 });
  const wo = world(0.8);
  assert('standing on the ground you are rained on', w.openSky(wo, 0, FLAT + 1, 0));
  wo.setBlock(0, FLAT + 4, 0, STONE);
  assert('...and under a roof you are not', !w.openSky(wo, 0, FLAT + 1, 0));
  assert('...while the block beside it still is', w.openSky(wo, 1, FLAT + 1, 0));
  assert('and on top of the roof you are back out in it',
    w.openSky(wo, 0, FLAT + 5, 0));
}

// ------------------------------------------------------------ water in the air
{
  const wo = world(0.8);
  const scene = new THREE.Scene();
  // A pool with room for a whole second of it: the rate is what is under
  // test here, not the share of the pool weather is allowed.
  const fx = new Particles(scene, { max: 2048 });
  const w = new Weather({ random: seeded(13), state: RAIN, seconds: 600 });

  let made = 0;
  for (let i = 0; i < 60; i++) made += fx.precipitation(1 / 60, wo, w, 0, FLAT + 2, 0);
  assert('a second of rain is a second of rain', made > 0, made);
  assert('...at about the rate it was asked for',
    Math.abs(made - PRECIPITATION_RATE) <= 2, `${made} of ${PRECIPITATION_RATE}`);
  // A hitch is not an excuse for a cloudburst: one enormous frame is capped
  // rather than dumping a second and a half of rain in a single step.
  const hitched = new Particles(new THREE.Scene(), { max: 2048 });
  assert('a long frame does not arrive all at once',
    hitched.precipitation(3, wo, w, 0, FLAT + 2, 0) <= 64);
  let allRain = true;
  let above = true;
  let inRange = true;
  for (let i = 0; i < fx.count; i++) {
    if (fx.kind[i] !== RAIN_KIND) allRain = false;
    if (fx.py[i] <= FLAT + 2) above = false;
    if (Math.abs(fx.px[i]) > PRECIPITATION_RADIUS + 1) inRange = false;
  }
  assert('...all of it rain', allRain);
  assert('...spawned above the camera, so it falls past you', above);
  assert('...and only where you could see it', inRange);
  assert('rain falls, and only falls',
    fx.vy[0] < 0 && fx.vx[0] === 0 && fx.vz[0] === 0, fx.vy[0]);

  // A frame is not a bucket: the rate is carried as a fraction, so a hundred
  // short frames make the same rain as one long one.
  const fine = new Particles(new THREE.Scene(), { max: 2048 });
  let total = 0;
  for (let i = 0; i < 120; i++) total += fine.precipitation(1 / 120, wo, w, 0, FLAT + 2, 0);
  assert('a fast frame rate does not thin the rain out',
    Math.abs(total - PRECIPITATION_RATE) <= 3, `${total} of ${PRECIPITATION_RATE}`);
}

// snow, indoors, and clear skies
{
  const scene = new THREE.Scene();
  const w = new Weather({ random: seeded(17), state: RAIN, seconds: 600 });

  const cold = world(-0.1);
  const snowy = new Particles(scene, { max: 512 });
  snowy.precipitation(1, cold, w, 0, FLAT + 2, 0);
  let allSnow = true;
  let drifts = false;
  for (let i = 0; i < snowy.count; i++) if (snowy.kind[i] !== SNOW_KIND) allSnow = false;
  assert('where it is cold enough to freeze, it snows', snowy.count > 0 && allSnow);
  const before = snowy.py[0];
  snowy.update(0.5, cold);
  for (let i = 0; i < snowy.count; i++) if (snowy.vx[i] !== 0 || snowy.vz[i] !== 0) drifts = true;
  assert('...and snow wanders on the way down', drifts);
  assert('...far more slowly than rain falls', before - snowy.py[0] < 1, before - snowy.py[0]);

  const hot = world(2.0);
  const dry = new Particles(new THREE.Scene(), { max: 512 });
  dry.precipitation(1, hot, w, 0, FLAT + 2, 0);
  assert('nothing falls on the desert', dry.count === 0, dry.count);

  const indoors = world(0.8);
  for (let x = -20; x <= 20; x++) {
    for (let z = -20; z <= 20; z++) indoors.setBlock(x, FLAT + 6, z, STONE);
  }
  const sheltered = new Particles(new THREE.Scene(), { max: 512 });
  sheltered.precipitation(1, indoors, w, 0, FLAT + 2, 0);
  assert('and nothing falls indoors', sheltered.count === 0, sheltered.count);

  const clear = new Weather({ random: seeded(19) });
  const none = new Particles(new THREE.Scene(), { max: 512 });
  none.precipitation(1, world(0.8), clear, 0, FLAT + 2, 0);
  assert('nor on a clear day', none.count === 0, none.count);
}

// landing
{
  const wo = world(0.8);
  const w = new Weather({ random: seeded(23), state: RAIN, seconds: 600 });
  const fx = new Particles(new THREE.Scene(), { max: 512 });
  fx.precipitation(1, wo, w, 0, FLAT + 2, 0);
  const started = fx.count;

  // Three seconds: longer than the longest fall from the top of the barrel,
  // so anything still in the air is a drop that never landed.
  let splashes = 0;
  for (let i = 0; i < 180; i++) {
    fx.update(1 / 60, wo);
    for (let j = 0; j < fx.count; j++) if (fx.kind[j] === FOAM) splashes++;
  }
  let left = 0;
  for (let i = 0; i < fx.count; i++) if (fx.kind[i] === RAIN_KIND) left++;
  assert('rain lands and is gone', left < started * 0.2, `${left} of ${started}`);
  assert('...and some of it splashes when it does', splashes > 0, splashes);
  let underground = false;
  for (let i = 0; i < fx.count; i++) if (fx.py[i] < FLAT) underground = true;
  assert('nothing falls through the floor', !underground);
}

// the pool belongs to everyone
{
  const wo = world(0.8);
  const w = new Weather({ random: seeded(29), state: RAIN, seconds: 600 });
  const fx = new Particles(new THREE.Scene(), { max: 64 });
  for (let i = 0; i < 20; i++) fx.precipitation(1, wo, w, 0, FLAT + 2, 0);
  assert('weather never fills the pool', fx.count <= 64 * 0.7, fx.count);
  assert('...leaving room for the splash you make yourself',
    fx.count + 20 <= 64, fx.count);
}

// water lands in water
{
  const wo = world(0.8);
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) wo.setBlock(x, FLAT, z, WATER);
  const w = new Weather({ random: seeded(31), state: RAIN, seconds: 600 });
  const fx = new Particles(new THREE.Scene(), { max: 256 });
  fx.precipitation(0.2, wo, w, 0, FLAT + 2, 0, 6);
  const started = fx.count;
  for (let i = 0; i < 150; i++) fx.update(1 / 60, wo);
  let onTheSurface = 0;
  for (let i = 0; i < fx.count; i++) if (fx.kind[i] === RAIN_KIND) onTheSurface++;
  assert('rain falling on water is rain that has landed',
    started > 0 && onTheSurface < started * 0.2, `${onTheSurface} of ${started}`);
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
