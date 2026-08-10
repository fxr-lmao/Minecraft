// Smoke test for the player physics on the real flat world.
import { Player } from '../src/player.js';
import { World, GRASS } from '../src/world.js';
import { PHYSICS_DT } from '../src/constants.js';

const world = new World();

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

// 9. world border clamps
{
  const p = new Player(world);
  p.pos.set(127.9, 4.01, 64.5);
  for (let i = 0; i < 600; i++) p.update(PHYSICS_DT, { forward: 1, strafe: 0, jump: false, sprint: true, sneak: false });
  assert('border clamp keeps x < 127.7', p.pos.x < 127.71, p.pos.x.toFixed(3));
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
  const walled = new World();
  for (let z = 60; z < 70; z++) {
    for (let y = 4; y < 6; y++) walled.setBlock(66, y, z, GRASS); // wall at x=66
  }

  // yaw -pi/2 points "forward" at +x, straight into the wall; strafe then
  // pushes along +z, so forward+strafe runs at it diagonally.
  const runInto = (input, seconds, w = walled) => {
    const p = new Player(w);
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
  const ledge = new World();
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

// 12. running into the world border must not sink the player either
{
  const p = new Player(world);
  p.pos.set(127.0, 4.001, 64.5);
  let minY = p.pos.y;
  for (let i = 0; i < 400; i++) {
    p.update(PHYSICS_DT, { forward: 1, strafe: 1, jump: false, sprint: true, sneak: false });
    minY = Math.min(minY, p.pos.y);
  }
  assert('border contact never sinks', minY > 3.99, minY.toFixed(3));
}

console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
