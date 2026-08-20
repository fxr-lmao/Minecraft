// Touch-control rules: hold buttons, joystick, Play source, hotbar swipe,
// item-sprite maps. Pure — no DOM, no THREE. The on-screen buttons used to
// unpress on iOS because pointerleave fired on press; that rule lives in
// holdLeave and is pinned down here so it cannot silently regress.

import {
  playSource, isFingerPointer, recentFinger, wantsTouchUi,
  idleHold, holdDown, holdUp, holdLeave, holdCancel, holdLostCapture, holdEvent,
  joystickFromDelta, joystickKnobOffset, touchRole,
  jumpTap, forwardTap, hotbarGesture, combineMove,
  beginJoystick, moveJoystick, endJoystick,
  beginLook, moveLook, endLook, consumeLookDeltas,
  toggleFlag, hudBodyClasses, homeJoystickOrigin,
  spriteMapErrors, spriteOpaqueCount, spriteBounds,
  JOY_RADIUS, JOY_DEADZONE, JOY_SPRINT, JOY_SPRINT_FORWARD,
  DOUBLE_TAP_MS, FINGER_MEMORY_MS, HOTBAR_SWIPE_PX, JOY_KNOB_CAP,
} from '../src/touch-controls.js';
import { LOOK_LOCK, LOOK_FREE, LOOK_TOUCH } from '../src/input.js';
import {
  STICK_PX, PICKAXE_PX, SHOVEL_PX, BUCKET_PX, WATER_BUCKET_PX,
  HAFT, HEAD_WOOD, HEAD_STONE, HEAD_IRON, BUCKET_PALETTE,
} from '../src/item-sprites.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

const almost = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ============================================================ playSource
{
  assert('a touch pointer starts in touch mode', playSource('touch') === 'touch');
  assert('a pen pointer starts in touch mode', playSource('pen') === 'touch');
  assert('a mouse pointer starts in mouse mode', playSource('mouse') === 'mouse');
  assert('an undefined pointer starts in mouse mode', playSource(undefined) === 'mouse');
  assert('a null pointer starts in mouse mode', playSource(null) === 'mouse');
  assert('a mouse with a recent finger is still touch', playSource('mouse', true) === 'touch');
  assert('a mouse without a recent finger stays mouse', playSource('mouse', false) === 'mouse');
  assert('empty string is not a finger', playSource('') === 'mouse');
  assert('isFingerPointer(touch)', isFingerPointer('touch') === true);
  assert('isFingerPointer(pen)', isFingerPointer('pen') === true);
  assert('isFingerPointer(mouse)', isFingerPointer('mouse') === false);
  assert('isFingerPointer(undefined)', isFingerPointer(undefined) === false);
}

// ============================================================ recentFinger
{
  assert('a touch 0ms ago is recent', recentFinger(1000, 1000) === true);
  assert('a touch 1999ms ago is recent', recentFinger(3000, 1001) === true);
  assert('a touch at the window is not recent', recentFinger(1000 + FINGER_MEMORY_MS, 1000) === false);
  assert('a touch in the future is not recent', recentFinger(1000, 2000) === false);
  assert('NaN is not recent', recentFinger(NaN, 0) === false);
  assert('missing at is not recent', recentFinger(1000, undefined) === false);
}

// ============================================================ wantsTouchUi
{
  assert('hidden while pointer-locked', wantsTouchUi({
    locked: true, usingTouch: true, lookMode: LOOK_TOUCH, hasTouch: true, sessionActive: true,
  }) === false);
  assert('hidden while natively locked', wantsTouchUi({
    nativeLocked: true, usingTouch: true, sessionActive: true, hasTouch: true,
  }) === false);
  assert('shown while usingTouch', wantsTouchUi({
    usingTouch: true, locked: false, sessionActive: true,
  }) === true);
  assert('shown in LOOK_TOUCH', wantsTouchUi({
    lookMode: LOOK_TOUCH, locked: false, usingTouch: false, sessionActive: true,
  }) === true);
  assert('shown on a phone that started as mouse', wantsTouchUi({
    hasTouch: true, sessionActive: true, locked: false, usingTouch: false, lookMode: LOOK_LOCK,
  }) === true);
  assert('hidden on a desktop before Play', wantsTouchUi({
    hasTouch: false, sessionActive: false, locked: false, usingTouch: false, lookMode: LOOK_LOCK,
  }) === false);
  assert('hidden on a desktop after Play', wantsTouchUi({
    hasTouch: false, sessionActive: true, locked: false, usingTouch: false, lookMode: LOOK_LOCK,
  }) === false);
  assert('null state is hidden', wantsTouchUi(null) === false);
  assert('empty state is hidden', wantsTouchUi({}) === false);
}

// ============================================================ hold: the iOS bug
{
  const idle = idleHold();
  assert('idle is not down', idle.down === false && idle.pointerId === null);

  const down = holdDown(idle, { pointerId: 7, pointerType: 'touch' });
  assert('pointerdown starts the hold', down.start === true && down.state.down === true);
  assert('pointerdown records the id', down.state.pointerId === 7);
  assert('pointerdown records the type', down.state.pointerType === 'touch');

  const leave = holdLeave(down.state, { pointerId: 7, pointerType: 'touch' });
  assert('pointerleave does NOT end a finger hold', leave.end === false && leave.state.down === true,
    `end=${leave.end} down=${leave.state.down}`);

  const up = holdUp(leave.state, { pointerId: 7, pointerType: 'touch' });
  assert('pointerup ends a finger hold', up.end === true && up.state.down === false);
  assert('pointerup clears the id', up.state.pointerId === null);
}

{
  // The exact Safari sequence: down, leave, up.
  let s = idleHold();
  s = holdEvent(s, 'pointerdown', { pointerId: 1, pointerType: 'touch' }).state;
  const mid = holdEvent(s, 'pointerleave', { pointerId: 1, pointerType: 'touch' });
  assert('Safari leave mid-press keeps Jump held', mid.end === false && mid.state.down === true);
  const end = holdEvent(mid.state, 'pointerup', { pointerId: 1, pointerType: 'touch' });
  assert('Safari leave then up finally releases', end.end === true && end.state.down === false);
}

{
  // Mouse really can leave the button.
  let s = idleHold();
  s = holdDown(s, { pointerId: 2, pointerType: 'mouse' }).state;
  const leave = holdLeave(s, { pointerId: 2, pointerType: 'mouse' });
  assert('pointerleave DOES end a mouse hold', leave.end === true && leave.state.down === false);
}

{
  // Pen is a finger as far as the buttons are concerned.
  let s = idleHold();
  s = holdDown(s, { pointerId: 3, pointerType: 'pen' }).state;
  const leave = holdLeave(s, { pointerId: 3, pointerType: 'pen' });
  assert('pointerleave does not end a pen hold', leave.end === false && leave.state.down === true);
}

{
  // A second finger cannot steal the hold.
  let s = idleHold();
  const first = holdDown(s, { pointerId: 1, pointerType: 'touch' });
  const second = holdDown(first.state, { pointerId: 2, pointerType: 'touch' });
  assert('a second pointerdown is ignored', second.start === false && second.state.pointerId === 1);
  const otherUp = holdUp(second.state, { pointerId: 2, pointerType: 'touch' });
  assert('the other finger lifting does not release', otherUp.end === false && otherUp.state.down === true);
  const ownUp = holdUp(otherUp.state, { pointerId: 1 });
  assert('the original finger lifting does release', ownUp.end === true);
}

{
  const s = holdDown(idleHold(), { pointerId: 9, pointerType: 'touch' }).state;
  const cancel = holdCancel(s, { pointerId: 9 });
  assert('pointercancel ends a finger hold', cancel.end === true && cancel.state.down === false);
}

{
  const s = holdDown(idleHold(), { pointerId: 9, pointerType: 'touch' }).state;
  const lost = holdLostCapture(s, { pointerId: 9 });
  assert('lostpointercapture ends a finger hold', lost.end === true);
}

{
  const idle = holdUp(idleHold(), { pointerId: 1 });
  assert('pointerup with nothing held is a no-op', idle.end === false);
  const leaveIdle = holdLeave(idleHold(), { pointerId: 1, pointerType: 'touch' });
  assert('pointerleave with nothing held is a no-op', leaveIdle.end === false);
}

{
  const s = holdDown(idleHold(), { pointerType: 'touch' }).state;
  assert('missing pointerId still starts (treated as 0)', s.down === true && s.pointerId === 0);
  const up = holdUp(s, {});
  assert('missing pointerId on up still matches', up.end === true);
}

{
  const unknown = holdEvent(idleHold(), 'pointermove', { pointerId: 1 });
  assert('unknown event types do nothing', unknown.start === false && unknown.end === false);
}

{
  // Break and Place are the same state machine as Jump. Pin that a cancel
  // mid-dig actually stops the hold, which is what stops a mining loop after
  // the browser steals the pointer for a system gesture.
  let breakHold = idleHold();
  breakHold = holdEvent(breakHold, 'pointerdown', { pointerId: 4, pointerType: 'touch' }).state;
  assert('break starts', breakHold.down === true);
  const cancelled = holdEvent(breakHold, 'pointercancel', { pointerId: 4, pointerType: 'touch' });
  assert('a system-gesture cancel stops breaking', cancelled.end === true && cancelled.state.down === false);
}

// ============================================================ joystick
{
  const rest = joystickFromDelta(0, 0);
  assert('resting stick is zero', rest.forward === 0 && rest.strafe === 0 && rest.sprint === false);
  const tiny = joystickFromDelta(3, -3);
  assert('inside the deadzone is zero', tiny.forward === 0 && tiny.scale === 0, `scale=${tiny.scale}`);
  const just = joystickFromDelta(0, -(JOY_DEADZONE - 1));
  assert('one pixel inside the deadzone is still zero', just.scale === 0);
}

{
  const up = joystickFromDelta(0, -JOY_RADIUS);
  assert('full up is forward 1', almost(up.forward, 1) && almost(up.strafe, 0), `${up.forward},${up.strafe}`);
  assert('full up is a sprint', up.sprint === true && up.scale === 1);
  const down = joystickFromDelta(0, JOY_RADIUS);
  assert('full down is backward 1', almost(down.forward, -1), `${down.forward}`);
  assert('full down is not a sprint', down.sprint === false);
  const right = joystickFromDelta(JOY_RADIUS, 0);
  assert('full right is strafe 1', almost(right.strafe, 1) && almost(right.forward, 0), `${right.strafe}`);
  assert('full right is not a sprint', right.sprint === false);
  const left = joystickFromDelta(-JOY_RADIUS, 0);
  assert('full left is strafe -1', almost(left.strafe, -1));
}

{
  const diag = joystickFromDelta(30, -30);
  assert('diagonal has both axes', diag.forward > 0 && diag.strafe > 0);
  assert('diagonal is not longer than 1', diag.scale <= 1);
  const far = joystickFromDelta(0, -400);
  assert('beyond the radius still clamps to 1', far.scale === 1 && almost(far.forward, 1));
}

{
  const knob = joystickKnobOffset(400, 0, JOY_KNOB_CAP);
  assert('knob is capped', almost(knob.x, JOY_KNOB_CAP) && almost(knob.y, 0), `${knob.x}`);
  const inner = joystickKnobOffset(10, -10, JOY_KNOB_CAP);
  assert('knob inside the cap is 1:1', almost(inner.x, 10) && almost(inner.y, -10));
  const zero = joystickKnobOffset(0, 0);
  assert('knob at rest is origin', zero.x === 0 && zero.y === 0);
}

{
  assert('left half starts the stick', touchRole(100, 400, false, false) === 'joy');
  assert('right half looks', touchRole(300, 400, false, false) === 'look');
  assert('left half looks if the stick is taken', touchRole(100, 400, true, false) === 'look');
  assert('a third finger is ignored', touchRole(300, 400, true, true) === null);
  assert('zero width does not throw', touchRole(0, 0, false, false) === 'joy');
}

{
  const first = beginJoystick(null, 1, 40, 80);
  assert('beginJoystick records origin', first.id === 1 && first.ox === 40 && first.oy === 80);
  const ignored = beginJoystick(first, 2, 9, 9);
  assert('a second stick is refused', ignored === first);
  const moved = moveJoystick(first, 1, 70, 50);
  assert('moveJoystick updates the finger', moved.x === 70 && moved.y === 50 && moved.ox === 40);
  const other = moveJoystick(moved, 99, 0, 0);
  assert('moveJoystick ignores other ids', other === moved);
  const ended = endJoystick(moved, 1);
  assert('endJoystick clears on its id', ended === null);
  const kept = endJoystick(moved, 2);
  assert('endJoystick keeps other ids', kept === moved);
}

{
  const look = beginLook(null, 5, 200, 100);
  assert('beginLook records the start', look.id === 5 && look.px === 200 && look.dx === 0);
  const taken = beginLook(look, 6, 0, 0);
  assert('beginLook refuses a second finger', taken === look);
  const dragged = moveLook(look, 5, 210, 90);
  assert('moveLook accumulates dx', dragged.dx === 10 && dragged.dy === -10, `${dragged.dx},${dragged.dy}`);
  const again = moveLook(dragged, 5, 220, 90);
  assert('moveLook keeps accumulating', again.dx === 20 && again.dy === -10);
  const ended = endLook(again, 5);
  assert('endLook drops the id but keeps leftover dx', ended.id === null && ended.dx === 20);
}

{
  const out = consumeLookDeltas({ dx: 3, dy: 4 }, { dx: 10, dy: 2, id: 1 }, LOOK_TOUCH, true);
  assert('touch look is mixed in', out.dx === 13 && out.dy === 6 && out.touch === true);
  assert('touch look is consumed', out.look.dx === 0 && out.look.dy === 0);
  const mouseOnly = consumeLookDeltas({ dx: 3, dy: 4 }, { dx: 10, dy: 2, id: 1 }, LOOK_LOCK, true);
  assert('locked look ignores leftover touch', mouseOnly.dx === 3 && mouseOnly.touch === false);
  const paused = consumeLookDeltas({ dx: 3, dy: 4 }, { dx: 10, dy: 2 }, LOOK_TOUCH, false);
  assert('disabled look is zero', paused.dx === 0 && paused.dy === 0 && paused.touch === false);
}

// ============================================================ jump / sprint taps
{
  const first = jumpTap(1000, 0);
  assert('first jump is not fly', first.fly === false && first.last === 1000);
  const second = jumpTap(1000 + DOUBLE_TAP_MS - 1, first.last);
  assert('second jump inside the window is fly', second.fly === true && second.last === 0);
  const late = jumpTap(1000 + DOUBLE_TAP_MS, 1000);
  assert('second jump on the window is not fly', late.fly === false);
  const sprint = forwardTap(500, 300);
  assert('double-tap W inside the window sprints', sprint.active === true && sprint.last === 500);
  const walk = forwardTap(500, 0);
  assert('a single W is not a sprint', walk.active === false);
}

// ============================================================ hotbar swipe
{
  const tap = hotbarGesture(100, 10, 105, 12, 3);
  assert('a small move is a tap', tap.type === 'tap' && tap.slot === 3 && tap.dir === 0);
  const left = hotbarGesture(100, 10, 100 - HOTBAR_SWIPE_PX, 12, 3);
  assert('swipe left selects the next slot', left.type === 'swipe' && left.dir === 1);
  const right = hotbarGesture(100, 10, 100 + HOTBAR_SWIPE_PX, 12, 3);
  assert('swipe right selects the previous slot', right.type === 'swipe' && right.dir === -1);
  const vert = hotbarGesture(100, 10, 100, 10 + HOTBAR_SWIPE_PX + 20, 3);
  assert('a vertical slide is still a tap', vert.type === 'tap');
  const diag = hotbarGesture(100, 10, 100 + HOTBAR_SWIPE_PX + 10, 10 + 5, 4);
  assert('mostly-horizontal diagonal is a swipe', diag.type === 'swipe');
}

// ============================================================ combineMove
{
  const keys = combineMove({ forward: 1, strafe: 0 }, null, { jump: true });
  assert('keyboard forward', keys.forward === 1 && keys.jump === true && keys.sprint === false);
  const both = combineMove({ forward: 1, strafe: 0 }, { forward: 1, strafe: 0.2 });
  assert('stick plus key is clamped', both.forward === 1 && both.strafe === 0.2);
  const joySprint = combineMove({ forward: 0, strafe: 0 }, { forward: 1, sprint: true });
  assert('full-tilt stick sprints', joySprint.sprint === true);
  const sneak = combineMove({ forward: 1, strafe: 0 }, { sprint: true }, { sneak: true, sprint: true });
  assert('sneak suppresses sprint', sneak.sneak === true && sneak.sprint === false);
  const dtap = combineMove({ forward: 1, strafe: 0 }, null, { doubleTapSprint: true });
  assert('double-tap W sprints', dtap.sprint === true);
  const back = combineMove({ forward: -1, strafe: -1 }, { forward: -1, strafe: -1 });
  assert('backward plus stick is clamped to -1', back.forward === -1 && back.strafe === -1);
}

{
  assert('toggle off->on', toggleFlag(false) === true);
  assert('toggle on->off', toggleFlag(true) === false);
}

{
  const origin = homeJoystickOrigin({ left: 10, top: 20, width: 100, height: 80 });
  assert('home origin is the centre', origin.ox === 60 && origin.oy === 60);
  const missing = homeJoystickOrigin(null);
  assert('missing rect is origin 0', missing.ox === 0 && missing.oy === 0);
}

{
  const classes = hudBodyClasses({
    wantsTouch: true, pointerLocked: false, freeLookPlaying: false, hasTouch: true,
  });
  assert('touch class on', classes.touch === true && classes['has-touch'] === true);
  assert('pointer-locked class off', classes['pointer-locked'] === false);
  const locked = hudBodyClasses({
    wantsTouch: false, pointerLocked: true, freeLookPlaying: false, hasTouch: true,
  });
  assert('locked play hides touch class', locked.touch === false && locked['pointer-locked'] === true);
  const free = hudBodyClasses({
    wantsTouch: false, pointerLocked: false, freeLookPlaying: true, hasTouch: false,
  });
  assert('free look hides the cursor', free.nocursor === true);
}

// ============================================================ item sprites
{
  const woodPick = { ...HAFT, ...HEAD_WOOD };
  const stonePick = { ...HAFT, ...HEAD_STONE };
  const ironPick = { ...HAFT, ...HEAD_IRON };
  const woodShovel = { ...HAFT, ...HEAD_WOOD };
  const stoneShovel = { ...HAFT, ...HEAD_STONE };
  const ironShovel = { ...HAFT, ...HEAD_IRON };

  const maps = [
    ['stick', STICK_PX, HAFT],
    ['wood pickaxe', PICKAXE_PX, woodPick],
    ['stone pickaxe', PICKAXE_PX, stonePick],
    ['iron pickaxe', PICKAXE_PX, ironPick],
    ['wood shovel', SHOVEL_PX, woodShovel],
    ['stone shovel', SHOVEL_PX, stoneShovel],
    ['iron shovel', SHOVEL_PX, ironShovel],
    ['bucket', BUCKET_PX, BUCKET_PALETTE],
    ['water bucket', WATER_BUCKET_PX, BUCKET_PALETTE],
  ];

  for (const [name, rows, pal] of maps) {
    const errors = spriteMapErrors(rows, pal, name);
    assert(`${name} is a valid 16x16 map`, errors.length === 0, errors.join('; '));
    const opaque = spriteOpaqueCount(rows);
    assert(`${name} has opaque pixels`, opaque >= 16, `opaque=${opaque}`);
    const box = spriteBounds(rows);
    assert(`${name} spans a useful area`, box.width >= 6 && box.height >= 8,
      `${box.width}x${box.height}`);
  }

  const stickBox = spriteBounds(STICK_PX);
  assert('the stick is a diagonal (taller than it is wide-ish)', stickBox.height >= 10);
  const pickBox = spriteBounds(PICKAXE_PX);
  assert('the pickaxe head sits higher than the stick', pickBox.minY < stickBox.minY,
    `${pickBox.minY} vs ${stickBox.minY}`);
  assert('the pickaxe is at least as wide as a stick', pickBox.width >= 10);
  const shovelBox = spriteBounds(SHOVEL_PX);
  assert('the shovel blade sits near the top', shovelBox.minY <= 2);

  // Water bucket must actually contain water letters, empty bucket must not.
  const waterLetters = WATER_BUCKET_PX.join('');
  const emptyLetters = BUCKET_PX.join('');
  assert('water bucket uses surface pixels', waterLetters.includes('s'));
  assert('water bucket uses body pixels', waterLetters.includes('w'));
  assert('water bucket uses depth pixels', waterLetters.includes('b'));
  assert('empty bucket has no water letters', !emptyLetters.includes('s') && !emptyLetters.includes('w') && !emptyLetters.includes('b'));

  // Shared handle letters so a wooden pickaxe is visibly the same shaft as a stick.
  const stickSet = new Set(STICK_PX.join('').replace(/\./g, ''));
  const pickHandle = PICKAXE_PX.join('').split('').filter((c) => 'ODMH'.includes(c));
  assert('the pickaxe reuses the stick handle letters', pickHandle.length > 0);
  for (const ch of stickSet) {
    assert(`stick letter ${ch} is in the haft palette`, HAFT[ch] !== undefined);
  }

  // A truncated row must fail the checker, so the checker is doing work.
  const broken = [...STICK_PX];
  broken[3] = '....';
  const brokenErrors = spriteMapErrors(broken, HAFT, 'broken');
  assert('a short row is rejected', brokenErrors.some((e) => e.includes('length')));
  const unknown = spriteMapErrors(['................'.repeat(1)], { X: '#fff' }, 'tiny');
  assert('wrong row count is rejected', unknown.some((e) => e.includes('rows')));
  const badChar = spriteMapErrors(STICK_PX, { O: '#000' }, 'partial');
  assert('a missing palette key is rejected', badChar.length > 0);

  assert('spriteMapErrors on a non-array', spriteMapErrors(null, HAFT, 'nope').length > 0);
  assert('spriteOpaqueCount on a non-array is 0', spriteOpaqueCount(null) === 0);
  assert('spriteBounds on empty is zero size', spriteBounds(['................']).width === 0);
}

// Palettes: every head letter exists so wood/stone/iron actually differ.
{
  for (const letter of ['o', 'd', 'm', 'h']) {
    assert(`wood head has ${letter}`, HEAD_WOOD[letter] !== undefined);
    assert(`stone head has ${letter}`, HEAD_STONE[letter] !== undefined);
    assert(`iron head has ${letter}`, HEAD_IRON[letter] !== undefined);
  }
  assert('wood and iron heads are different colours', HEAD_WOOD.m !== HEAD_IRON.m);
  assert('stone and iron heads are different colours', HEAD_STONE.m !== HEAD_IRON.m);
  assert('wood and stone heads are different colours', HEAD_WOOD.m !== HEAD_STONE.m);
  for (const letter of ['o', 'd', 'm', 'h', 's', 'w', 'b']) {
    assert(`bucket palette has ${letter}`, BUCKET_PALETTE[letter] !== undefined);
  }
}

// Constants stay in the range the rest of the game already assumed.
{
  assert('JOY_RADIUS is a useful travel', JOY_RADIUS >= 40 && JOY_RADIUS <= 80);
  assert('JOY_DEADZONE is inside the radius', JOY_DEADZONE > 0 && JOY_DEADZONE < JOY_RADIUS);
  assert('JOY_SPRINT is a high fraction', JOY_SPRINT > 0.7 && JOY_SPRINT <= 1);
  assert('JOY_SPRINT_FORWARD is a majority-forward push', JOY_SPRINT_FORWARD > 0.4 && JOY_SPRINT_FORWARD < 1);
  assert('DOUBLE_TAP_MS matches the keyboard window', DOUBLE_TAP_MS === 280);
  assert('FINGER_MEMORY_MS covers an iOS tap', FINGER_MEMORY_MS >= 1000);
  assert('HOTBAR_SWIPE_PX is a thumb-width', HOTBAR_SWIPE_PX >= 24 && HOTBAR_SWIPE_PX <= 80);
  assert('JOY_KNOB_CAP fits the 140px base', JOY_KNOB_CAP < 70);
}

// A few more hold sequences that showed up on real phones.
{
  // pointerdown, pointerleave (Safari), pointerleave again, pointerup.
  let s = idleHold();
  s = holdEvent(s, 'pointerdown', { pointerId: 8, pointerType: 'touch' }).state;
  s = holdEvent(s, 'pointerleave', { pointerId: 8, pointerType: 'touch' }).state;
  s = holdEvent(s, 'pointerleave', { pointerId: 8, pointerType: 'touch' }).state;
  assert('repeated Safari leaves still held', s.down === true);
  const end = holdEvent(s, 'pointerup', { pointerId: 8, pointerType: 'touch' });
  assert('then a real up releases once', end.end === true);
  const extra = holdEvent(end.state, 'pointerup', { pointerId: 8, pointerType: 'touch' });
  assert('a second up does not release again', extra.end === false);
}

{
  // Mouse: down, leave (end), then a stray up from the same id is a no-op.
  let s = idleHold();
  s = holdEvent(s, 'pointerdown', { pointerId: 1, pointerType: 'mouse' }).state;
  const leave = holdEvent(s, 'pointerleave', { pointerId: 1, pointerType: 'mouse' });
  assert('mouse leave ends', leave.end === true);
  const stray = holdEvent(leave.state, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
  assert('mouse up after leave is a no-op', stray.end === false);
}

// LOOK_* strings the HUD classes depend on.
{
  assert('LOOK_TOUCH is the string touch-controls uses', LOOK_TOUCH === 'touch');
  assert('LOOK_LOCK is lock', LOOK_LOCK === 'lock');
  assert('LOOK_FREE is free', LOOK_FREE === 'free');
  assert('wantsTouchUi in LOOK_FREE on a phone still shows buttons', wantsTouchUi({
    lookMode: LOOK_FREE, hasTouch: true, sessionActive: true, locked: false, usingTouch: false,
  }) === true);
}

// ---------------------------------------------------------------- report
let failures = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
