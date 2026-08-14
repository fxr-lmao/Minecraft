// Smoke test for the player physics.
// Runs on a superflat world (surface at y=3, so the player stands at y=4):
// generated hills would make "walk forward for five seconds" untestable.
import { Player } from '../src/player.js';
import { World, GRASS, AIR, WATER } from '../src/world.js';
import { PHYSICS_DT, WORLD_MIN_Y, SPEED_WALK, JUMP_VELOCITY } from '../src/constants.js';

const world = new World(1, { flat: 3 });

function simulate(input, seconds) {
  const p = new Player(world);
  const steps = Math.round(seconds / PHYSICS_DT);
  let maxY = p.pos.y;
  for (let i = 0; i < steps; i++) {
    p.update(PHYSICS_DT, input);
    maxY = Math.max(maxY, p.pos.y);
  }
  return { p, maxY };
}

const results = [];
const assert = (name, cond, detail) => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

// 1. walk speed → 4.317
{
  const { p } = simulate({ forward: 1, strafe: 0, jump: false, sprint: false, sneak: false }, 5);
  assert('walk reaches 4.317 m/s', Math.abs(p.horizontalSpeed - 4.317) < 0.02, p.horizontalSpeed.toFixed(3));
  assert('stays on ground', p.onGround && p.pos.y > 3.99 && p.pos.y < 4.01, p.pos.y.toFixed(4));
}

// 2. sprint speed → 5.612
{
  const { p } = simulate({ forward: 1, strafe: 0, jump: false, sprint: true, sneak: false }, 5);
  assert('sprint reaches 5.612 m/s', Math.abs(p.horizontalSpeed - 5.612) < 0.02, p.horizontalSpeed.toFixed(3));
  assert('sprint flag on', p.sprinting);
}

// 3. sneak speed → 1.295
{
  const { p } = simulate({ forward: 1, strafe: 0, jump: false, sprint: false, sneak: true }, 5);
  assert('sneak reaches 1.295 m/s', Math.abs(p.horizontalSpeed - 1.295) < 0.02, p.horizontalSpeed.toFixed(3));
  assert('sneak flag on', p.sneaking);
}

// 4. jump height ≈ 1.25 blocks (hold jump: each landing re-jumps, peak is stable)
{
  const { p, maxY } = simulate({ forward: 1, strafe: 0, jump: true, sprint: false, sneak: false }, 2);
  const jumpHeight = maxY - 4.0;
  assert('jump height ~1.25 blocks', jumpHeight > 1.20 && jumpHeight < 1.30, jumpHeight.toFixed(3));
}

// 4b. release jump -> falls back and lands; gravity works (no flight)
{
  const p = new Player(world);
  for (let i = 0; i < 48; i++) p.update(PHYSICS_DT, { forward: 0, strafe: 0, jump: true, sprint: false, sneak: false }); // jump
  for (let i = 0; i < 200; i++) p.update(PHYSICS_DT, { forward: 0, strafe: 0, jump: false, sprint: false, sneak: false }); // fall
  assert('lands after releasing jump', p.onGround && Math.abs(p.pos.y - 4.0001) < 0.01, p.pos.y.toFixed(4));
}

// 5. sprint-jump keeps sprinting
{
  const { p } = simulate({ forward: 1, strafe: 0, jump: true, sprint: true, sneak: false }, 2);
  assert('sprint jump keeps sprint flag', p.sprinting);
}

// 6. releasing input stops you (ground friction)
{
  const { p } = simulate({ forward: 1, strafe: 0, jump: false, sprint: false, sneak: false }, 3);
  simulate; // noop
  const p2 = new Player(world);
  // get up to speed, then let go
  for (let i = 0; i < 300; i++) p2.update(PHYSICS_DT, { forward: 1, strafe: 0, jump: false, sprint: false, sneak: false });
  for (let i = 0; i < 120; i++) p2.update(PHYSICS_DT, { forward: 0, strafe: 0, jump: false, sprint: false, sneak: false });
  assert('stops quickly after release (<0.5 m/s)', p2.horizontalSpeed < 0.5, p2.horizontalSpeed.toFixed(3));
  void p;
}

// 7. diagonal isn't faster than straight
{
  const a = simulate({ forward: 1, strafe: 0, jump: false, sprint: true, sneak: false }, 4);
  const b = simulate({ forward: 1, strafe: 1, jump: false, sprint: true, sneak: false }, 4);
  assert('diagonal sprint speed <= straight sprint', b.p.horizontalSpeed <= a.p.horizontalSpeed + 0.05,
    `${b.p.horizontalSpeed.toFixed(3)} vs ${a.p.horizontalSpeed.toFixed(3)}`);
}

// 8. facing degrees convention
{
  const p = new Player(world);
  p.yaw = 0;
  assert('yaw 0 faces North (180°)', Math.abs(p.facingDegrees() - 180) < 1, p.facingDegrees().toFixed(1));
  p.yaw = Math.PI;
  assert('yaw pi faces South (0°)', Math.abs(p.facingDegrees() - 0) < 1, p.facingDegrees().toFixed(1));
}

// 9. the world is infinite: sprinting a long way just keeps going
{
  const p = new Player(world);
  p.pos.set(0.5, 4.01, 0.5);
  for (let i = 0; i < 1800; i++) p.update(PHYSICS_DT, { forward: 1, strafe: 0, jump: false, sprint: true, sneak: false });
  assert('no border stops you', p.pos.z > 60, p.pos.z.toFixed(1));
  assert('still on the ground far from spawn', p.onGround && Math.abs(p.pos.y - 4) < 0.01, p.pos.y.toFixed(4));
}

// 10. fast fall from high up lands cleanly (one-step resolution, no sinking)
{
  const p = new Player(world);
  p.pos.set(64.5, 40, 64.5);
  for (let i = 0; i < 400; i++) p.update(PHYSICS_DT, { forward: 0, strafe: 0, jump: false, sprint: false, sneak: false });
  assert('fast fall lands on ground', p.onGround && Math.abs(p.pos.y - 4.0001) < 0.01, p.pos.y.toFixed(4));
}

// 11. walking into blocks — regression for the auto-step bug that dropped the
//     player through the floor to y = -3 whenever one axis was blocked and the
//     other was free (running along a wall at an angle).
{
  const walled = new World(1, { flat: 3 });
  for (let z = 60; z < 70; z++) {
    for (let y = 4; y < 6; y++) walled.setBlock(66, y, z, GRASS); // wall at x=66
  }

  // yaw -pi/2 points "forward" at +x, straight into the wall; strafe then
  // pushes along +z, so forward+strafe runs at it diagonally.
  const runInto = (input, seconds, w = walled) => {
    const p = new Player(w);
    p.autoJump = false; // these cases are about collision, not traversal
    p.pos.set(64.5, 4.001, 64.5);
    p.yaw = -Math.PI / 2;
    let minY = p.pos.y;
    let maxY = p.pos.y;
    const steps = Math.round(seconds / PHYSICS_DT);
    for (let i = 0; i < steps; i++) {
      p.update(PHYSICS_DT, input);
      minY = Math.min(minY, p.pos.y);
      maxY = Math.max(maxY, p.pos.y);
    }
    return { p, minY, maxY };
  };

  const straight = runInto({ forward: 1, strafe: 0, jump: false, sprint: false, sneak: false }, 2);
  assert('wall stops you at its face',
    Math.abs(straight.p.pos.x - 65.7) < 0.01, straight.p.pos.x.toFixed(3));
  assert('walking into a wall never sinks',
    straight.minY > 3.99, straight.minY.toFixed(3));

  const diagonal = runInto({ forward: 1, strafe: 1, jump: false, sprint: false, sneak: false }, 2);
  assert('diagonal wall contact never sinks',
    diagonal.minY > 3.99, diagonal.minY.toFixed(3));
  assert('diagonal wall contact never pops up',
    diagonal.maxY < 4.01, diagonal.maxY.toFixed(3));
  assert('you slide along the wall instead of stopping',
    diagonal.p.pos.z > 66, diagonal.p.pos.z.toFixed(3));

  const sprintDiag = runInto({ forward: 1, strafe: 1, jump: false, sprint: true, sneak: false }, 2);
  assert('sprinting into a wall stays on the ground',
    sprintDiag.minY > 3.99 && sprintDiag.p.onGround, sprintDiag.minY.toFixed(3));

  // a full block cannot be walked up — you have to jump, like Minecraft
  const noStep = runInto({ forward: 1, strafe: 0, jump: false, sprint: false, sneak: false }, 3);
  assert('a full block is not auto-climbed',
    Math.abs(noStep.p.pos.y - 4.0) < 0.01, noStep.p.pos.y.toFixed(3));

  // ...and jumping up onto a one-block-high ledge does work
  const ledge = new World(1, { flat: 3 });
  for (let x = 66; x < 80; x++) {
    for (let z = 60; z < 70; z++) ledge.setBlock(x, 4, z, GRASS);
  }
  const jumped = runInto({ forward: 1, strafe: 0, jump: true, sprint: false, sneak: false }, 3, ledge);
  assert('you can jump up onto a ledge',
    jumped.p.pos.x > 67 && jumped.p.pos.y >= 4.99,
    `x=${jumped.p.pos.x.toFixed(2)} y=${jumped.p.pos.y.toFixed(3)}`);

  // walking at the same ledge without jumping gets you nowhere
  const walkedAtLedge = runInto({ forward: 1, strafe: 0, jump: false, sprint: false, sneak: false }, 3, ledge);
  assert('the ledge blocks you without a jump',
    Math.abs(walkedAtLedge.p.pos.x - 65.7) < 0.01 && Math.abs(walkedAtLedge.p.pos.y - 4) < 0.01,
    `x=${walkedAtLedge.p.pos.x.toFixed(2)} y=${walkedAtLedge.p.pos.y.toFixed(3)}`);
}

// 12. walking into negative coordinates works like anywhere else
{
  const p = new Player(world);
  p.pos.set(-40.5, 4.001, -40.5);
  let minY = p.pos.y;
  for (let i = 0; i < 400; i++) {
    p.update(PHYSICS_DT, { forward: 1, strafe: 1, jump: false, sprint: true, sneak: false });
    minY = Math.min(minY, p.pos.y);
  }
  assert('negative coordinates are solid ground', minY > 3.99 && p.onGround, minY.toFixed(3));
}

// 13. auto jump: generated terrain steps up a block every few paces, so
//     walking has to carry you over single blocks without tapping space.
{
  const w = new World(1, { flat: 3 });
  // a raised plateau one block high, so landing on top is observable
  for (let x = 66; x < 90; x++) {
    for (let z = 0; z < 40; z++) w.setBlock(x, 4, z, GRASS);
  }

  const walk = (autoJump, seconds) => {
    const p = new Player(w);
    p.autoJump = autoJump;
    p.pos.set(60.5, 4.001, 20.5);
    p.yaw = -Math.PI / 2; // forward = +x, into the ledge
    const steps = Math.round(seconds / PHYSICS_DT);
    for (let i = 0; i < steps; i++) {
      p.update(PHYSICS_DT, { forward: 1, strafe: 0, jump: false, sprint: false, sneak: false });
    }
    return p;
  };

  const hopped = walk(true, 4);
  assert('auto jump carries you over a single block',
    hopped.pos.x > 67 && Math.abs(hopped.pos.y - 5) < 0.05,
    `x=${hopped.pos.x.toFixed(2)} y=${hopped.pos.y.toFixed(3)}`);

  const stuck = walk(false, 4);
  assert('with auto jump off the ledge still blocks you',
    Math.abs(stuck.pos.x - 65.7) < 0.01, stuck.pos.x.toFixed(3));

  // a two-block wall is not hoppable either way
  const tall = new World(1, { flat: 3 });
  for (let z = 0; z < 40; z++) {
    tall.setBlock(70, 4, z, GRASS);
    tall.setBlock(70, 5, z, GRASS);
  }
  const p2 = new Player(tall);
  p2.autoJump = true;
  p2.pos.set(67.5, 4.001, 20.5);
  p2.yaw = -Math.PI / 2;
  for (let i = 0; i < 480; i++) {
    p2.update(PHYSICS_DT, { forward: 1, strafe: 0, jump: false, sprint: false, sneak: false });
  }
  assert('auto jump does not climb a two-block wall',
    p2.pos.x < 70 && p2.pos.y < 6.5, `x=${p2.pos.x.toFixed(2)} y=${p2.pos.y.toFixed(2)}`);

  // flat ground must not trigger spurious hops
  const flat = new World(1, { flat: 3 });
  const p3 = new Player(flat);
  p3.autoJump = true;
  let maxY = p3.pos.y;
  for (let i = 0; i < 600; i++) {
    p3.update(PHYSICS_DT, { forward: 1, strafe: 0, jump: false, sprint: true, sneak: false });
    maxY = Math.max(maxY, p3.pos.y);
  }
  assert('no hopping on flat ground', maxY < 4.02, maxY.toFixed(3));
  assert('flat sprint still hits full speed', Math.abs(p3.horizontalSpeed - 5.612) < 0.02,
    p3.horizontalSpeed.toFixed(3));
}

// Mining down must not teleport you back to the surface.
//
// The fall-out-of-the-world backstop was a hard-coded y = -32, from when the
// world floor was y = 0. Once the world reached -70 that number sat in the
// middle of the caves, so digging past it respawned you at the top.
{
  const deep = new World(1, { flat: 3 });
  const idle = { forward: 0, strafe: 0, jump: false, sprint: false, sneak: false };
  const spawnY = new Player(deep).pos.y;

  // A superflat world is solid rock all the way down, so mine a shaft first —
  // exactly what a player does to get down there.
  const SHAFT_FLOOR = -50;
  for (let y = SHAFT_FLOOR; y <= 3; y++) deep.setBlock(0, y, 0, AIR);

  // Standing on the shaft floor, well past the old -32 threshold.
  // The lowest carved block is SHAFT_FLOOR, so the solid block under it is at
  // SHAFT_FLOOR - 1 and the player's feet rest at SHAFT_FLOOR.
  const p = new Player(deep);
  p.pos.set(0.5, SHAFT_FLOOR, 0.5);
  p.vel.set(0, 0, 0);
  for (let i = 0; i < 240; i++) p.update(PHYSICS_DT, idle);
  assert('standing below -32 does not respawn you', p.pos.y < -40, p.pos.y.toFixed(2));
  assert('...and you are on the shaft floor',
    p.onGround && Math.abs(p.pos.y - SHAFT_FLOOR) < 0.01, p.pos.y.toFixed(3));

  // Falling down the shaft past -32 — the exact reported symptom.
  const q = new Player(deep);
  q.pos.set(0.5, 3.5, 0.5);
  q.vel.set(0, 0, 0);
  for (let i = 0; i < 600; i++) q.update(PHYSICS_DT, idle);
  assert('falling past -32 does not teleport you to the surface',
    q.pos.y < -32 && Math.abs(q.pos.y - spawnY) > 1, q.pos.y.toFixed(2));
  assert('you land at the bottom of the shaft instead',
    q.onGround && Math.abs(q.pos.y - SHAFT_FLOOR) < 0.01, q.pos.y.toFixed(3));

  // The backstop still exists for anything that ends up under the floor.
  const r = new Player(deep);
  r.pos.set(0.5, WORLD_MIN_Y - 20, 0.5);
  r.update(PHYSICS_DT, idle);
  assert('under the floor still respawns', Math.abs(r.pos.y - r.spawn.y) < 1e-6, r.pos.y.toFixed(2));
}

// Water. Minecraft's per-tick water model is drag 0.8, acceleration 0.02
// (0.026 sprinting), gravity 0.02 and +0.04 a tick on jump; the terminal
// speeds those give are what these check.
{
  const idle = { forward: 0, strafe: 0, jump: false, sprint: false, sneak: false };
  const swim = { forward: 1, strafe: 0, jump: false, sprint: false, sneak: false };
  const swimFast = { forward: 1, strafe: 0, jump: false, sprint: true, sneak: false };
  const up = { forward: 0, strafe: 0, jump: true, sprint: false, sneak: false };

  // A deep pool: ground at y=3, water from y=4 to y=13.
  const sea = new World(1, { flat: 3 });
  for (let x = -40; x <= 40; x++) {
    for (let z = -40; z <= 40; z++) {
      for (let y = 4; y <= 13; y++) sea.setBlock(x, y, z, WATER);
    }
  }

  const swimmer = (input, seconds, y = 8) => {
    const p = new Player(sea);
    p.pos.set(0.5, y, 0.5);
    p.vel.set(0, 0, 0);
    for (let i = 0; i < Math.round(seconds / PHYSICS_DT); i++) p.update(PHYSICS_DT, input);
    return p;
  };

  const still = swimmer(idle, 0.1);
  assert('the player knows they are in water', still.inWater && still.submerged);

  const paddling = swimmer(swim, 6);
  assert('swimming settles at 2.0 m/s', Math.abs(paddling.horizontalSpeed - 2.0) < 0.05,
    paddling.horizontalSpeed.toFixed(3));
  const sprinting = swimmer(swimFast, 6);
  assert('sprint-swimming settles at 2.6 m/s', Math.abs(sprinting.horizontalSpeed - 2.6) < 0.05,
    sprinting.horizontalSpeed.toFixed(3));
  assert('swimming is far slower than walking', paddling.horizontalSpeed < SPEED_WALK * 0.55,
    `${paddling.horizontalSpeed.toFixed(2)} vs ${SPEED_WALK}`);

  // Sinking is slow: 2 m/s against 78.4 m/s of open air. Measured on the way
  // down — long enough to reach terminal (the time constant is 0.22 s), short
  // enough not to have hit the bottom.
  const sinking = swimmer(idle, 1.5, 13);
  assert('you sink at 2.0 m/s, not terminal velocity',
    Math.abs(sinking.vel.y + 2.0) < 0.05, sinking.vel.y.toFixed(3));
  assert('...and are still falling through water', sinking.inWater && !sinking.onGround,
    sinking.pos.y.toFixed(2));

  // Holding jump swims you up at a steady 1.2 m/s.
  const rising = swimmer(up, 3);
  assert('holding jump lifts you at 1.2 m/s', Math.abs(rising.vel.y - 1.2) < 0.05,
    rising.vel.y.toFixed(3));
  assert('...which is a fraction of a jump', rising.vel.y < JUMP_VELOCITY * 0.2,
    `${rising.vel.y.toFixed(2)} vs ${JUMP_VELOCITY}`);

  // And you can actually get out: swim up from the bottom, and the surface
  // is reachable rather than a ceiling.
  const climber = new Player(sea);
  climber.pos.set(0.5, 4, 0.5);
  climber.vel.set(0, 0, 0);
  for (let i = 0; i < Math.round(8 / PHYSICS_DT); i++) climber.update(PHYSICS_DT, up);
  assert('you can swim up to the surface', climber.pos.y > 12, climber.pos.y.toFixed(2));

  // ---------------------------------------------------------- swimming mode
  //
  // Sprinting in water is not just a faster paddle: Minecraft lays you out
  // flat, shrinks the hitbox to a 0.6 cube with the eye at 0.4, and steers
  // you along the whole look vector instead of its flattened shadow.
  {
    const crawler = swimmer(swimFast, 1);
    assert('sprinting in water starts a swim', crawler.swimming);
    assert('...which shrinks the hitbox to 0.6', crawler.height === 0.6, crawler.height);
    assert('...and drops the eye to 0.4', crawler.eyeHeight === 0.4, crawler.eyeHeight);

    // Sprinting on the ground needs a foothold; in water there is none, so
    // being in it has to be enough or you could never start.
    const fromRest = new Player(sea);
    fromRest.pos.set(0.5, 8, 0.5);
    fromRest.vel.set(0, 0, 0);
    fromRest.update(PHYSICS_DT, swimFast);
    assert('...and it starts out of your depth, with nothing to push off',
      fromRest.swimming && !fromRest.onGround);

    // Letting go of forward ends it, exactly as it ends a sprint.
    const stopped = new Player(sea);
    stopped.pos.set(0.5, 8, 0.5);
    for (let i = 0; i < 60; i++) stopped.update(PHYSICS_DT, swimFast);
    stopped.update(PHYSICS_DT, idle);
    assert('...letting go of forward ends it', !stopped.swimming);
    assert('...and you stand back up', stopped.height === 1.8, stopped.height);

    const dry = new Player(world);
    for (let i = 0; i < 60; i++) dry.update(PHYSICS_DT, swimFast);
    assert('sprinting on land is not swimming', dry.sprinting && !dry.swimming);
  }

  // Aiming is steering: the whole look vector, not its flattened shadow.
  {
    const diver = new Player(sea);
    diver.pos.set(0.5, 12, 0.5);
    diver.pitch = -Math.PI / 2 + 0.02; // straight down
    for (let i = 0; i < Math.round(2 / PHYSICS_DT); i++) diver.update(PHYSICS_DT, swimFast);
    assert('looking down while swimming takes you down', diver.pos.y < 8.5,
      diver.pos.y.toFixed(2));

    const riser = new Player(sea);
    riser.pos.set(0.5, 5, 0.5);
    riser.pitch = Math.PI / 2 - 0.02; // straight up
    for (let i = 0; i < Math.round(5 / PHYSICS_DT); i++) riser.update(PHYSICS_DT, swimFast);
    assert('...and looking up brings you back to the surface', riser.pos.y > 13,
      riser.pos.y.toFixed(2));

    // Level means level. Out in the middle of the water column that means
    // holding your depth — no slow sink into the dark, no drift upwards.
    const cruiser = new Player(sea);
    cruiser.pos.set(0.5, 10, 0.5);
    cruiser.pitch = 0;
    for (let i = 0; i < Math.round(6 / PHYSICS_DT); i++) cruiser.update(PHYSICS_DT, swimFast);
    assert('swimming level holds its depth', Math.abs(cruiser.pos.y - 10) < 0.4,
      cruiser.pos.y.toFixed(2));

    // Near the top it means the waterline: the float pulls you up to it and
    // parks you there with your head out.
    const floater = new Player(sea);
    floater.pos.set(0.5, 12.6, 0.5);
    floater.pitch = 0;
    for (let i = 0; i < Math.round(5 / PHYSICS_DT); i++) floater.update(PHYSICS_DT, swimFast);
    const surface = 13 + 8 / 9;
    assert('...and at the top, the waterline',
      Math.abs(floater.pos.y + floater.eyeHeight - surface) < 0.35,
      (floater.pos.y + floater.eyeHeight).toFixed(2));
    assert('...with your head out of the water', !floater.submerged);

    // ...but the float must not reel a diver back up.
    const deepDiver = new Player(sea);
    deepDiver.pos.set(0.5, 12, 0.5);
    deepDiver.pitch = -0.9;
    for (let i = 0; i < Math.round(4 / PHYSICS_DT); i++) deepDiver.update(PHYSICS_DT, swimFast);
    assert('...and a dive is not reeled back in', deepDiver.pos.y < 6,
      deepDiver.pos.y.toFixed(2));
  }

  // A flooded one-block tunnel: swimmable, not walkable, and you cannot stand
  // up inside it however hard you let go of the controls.
  {
    const tunnel = new World(1, { flat: 3 });
    for (let x = -2; x <= 30; x++) {
      for (let z = -2; z <= 2; z++) {
        for (let y = 4; y <= 8; y++) tunnel.setBlock(x, y, z, 1); // solid roof
      }
    }
    for (let x = 0; x <= 24; x++) tunnel.setBlock(x, 4, 0, WATER); // a 1-high bore
    const rat = new Player(tunnel);
    rat.pos.set(0.5, 4, 0.5);
    rat.vel.set(0, 0, 0);
    rat.yaw = -Math.PI / 2; // +x
    for (let i = 0; i < Math.round(4 / PHYSICS_DT); i++) rat.update(PHYSICS_DT, swimFast);
    assert('you can swim down a one-block flooded tunnel', rat.pos.x > 4,
      rat.pos.x.toFixed(2));
    for (let i = 0; i < 30; i++) rat.update(PHYSICS_DT, idle);
    assert('...and cannot stand up inside it', rat.swimming && rat.height === 0.6);
  }

  // On land nothing changed.
  const walker = new Player(world);
  for (let i = 0; i < 600; i++) {
    walker.update(PHYSICS_DT, { forward: 1, strafe: 0, jump: false, sprint: false, sneak: false });
  }
  assert('dry land is untouched by any of this',
    !walker.inWater && Math.abs(walker.horizontalSpeed - SPEED_WALK) < 0.02,
    walker.horizontalSpeed.toFixed(3));
}

console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
