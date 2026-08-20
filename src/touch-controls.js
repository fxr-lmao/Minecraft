// Pure touch-control rules.
//
// The on-screen buttons used to live entirely inside input.js as DOM
// listeners, which meant the thing that was broken — Jump/Break/Place
// unpressing the instant a finger landed — could not be unit-tested in Node.
// Everything that decides *whether* a press is still held, *how far* a
// joystick is pushed, *which* hotbar gesture a swipe was, and *whether* Play
// should start in touch mode lives here, with no document and no THREE.
//
// input.js still owns the listeners. It asks these functions what to do.

/** Look mode string used when a finger is driving the camera. Kept as a
 *  literal here so this file does not import input.js (input.js imports us). */
const LOOK_TOUCH = 'touch';

/** Finger travel, in CSS pixels, that counts as full joystick deflection. */
export const JOY_RADIUS = 55;
/** Pixels of travel ignored so a resting thumb does not drift the player. */
export const JOY_DEADZONE = 8;
/** Deflection at which a forward push becomes a sprint. */
export const JOY_SPRINT = 0.92;
/** Forward component required on top of JOY_SPRINT so a side-strafe does not sprint. */
export const JOY_SPRINT_FORWARD = 0.55;
/** How long a second jump counts as a double-tap (creative flight). */
export const DOUBLE_TAP_MS = 280;
/** How recently a real touchstart must have happened to override a fake mouse pointerType. */
export const FINGER_MEMORY_MS = 2000;
/** Horizontal travel, in CSS pixels, that turns a hotbar press into a swipe. */
export const HOTBAR_SWIPE_PX = 40;
/** Knob travel cap inside the 140px on-screen base. */
export const JOY_KNOB_CAP = 44;
/** Left half of the screen (plus a little) starts the floating joystick. */
export const JOY_SCREEN_FRACTION = 0.45;

/** True for a finger or a stylus, which both want LOOK_TOUCH. */
export function isFingerPointer(pointerType) {
  return pointerType === 'touch' || pointerType === 'pen';
}

/**
 * How Play should start, given the pointer that pressed it.
 *
 * iOS Safari sometimes reports a tap as `pointerType: 'mouse'`. If a real
 * `touchstart` landed in the last couple of seconds we still start in touch
 * mode, otherwise a phone would ask for a pointer lock that will never come
 * and hide the on-screen buttons.
 *
 * An iPad with a Magic Keyboard is the other case: a real mouse click has no
 * recent touchstart, so we start in mouse mode and ask for the lock.
 */
export function playSource(pointerType, recentFinger = false) {
  if (isFingerPointer(pointerType)) return 'touch';
  if (recentFinger) return 'touch';
  return 'mouse';
}

/** True if `at` (ms) is a finger-touch still in living memory at `now`. */
export function recentFinger(now, at, windowMs = FINGER_MEMORY_MS) {
  if (!Number.isFinite(now) || !Number.isFinite(at)) return false;
  return now - at >= 0 && now - at < windowMs;
}

/**
 * Show the movement pad and the jump/break/place cluster.
 *
 * Hidden while a real pointer lock owns the mouse — those buttons would sit
 * there unable to be clicked. Shown for touch play, and also for any
 * touch-capable session that is not locked, so a phone that started Play
 * with a bogus `pointerType: 'mouse'` still gets buttons it can press.
 */
export function wantsTouchUi(state) {
  if (!state) return false;
  if (state.locked || state.nativeLocked) return false;
  if (state.usingTouch) return true;
  if (state.lookMode === LOOK_TOUCH) return true;
  return Boolean(state.hasTouch && state.sessionActive);
}

/** Empty hold-button state. `pointerId` is null while nothing is pressed. */
export function idleHold() {
  return { pointerId: null, pointerType: null, down: false };
}

function samePointer(state, e) {
  if (state.pointerId === null) return false;
  if (!e || e.pointerId === undefined || e.pointerId === null) return true;
  return e.pointerId === state.pointerId;
}

/**
 * A press on Jump / Break / Place.
 *
 * Returns `{ start, state }`. `start` is true only for the first pointer that
 * lands — a second finger on the same button is ignored, which is what stops
 * a palm rest from cancelling a jump.
 */
export function holdDown(state, e) {
  const next = state ?? idleHold();
  if (next.down) return { start: false, state: next };
  const pointerId = e?.pointerId ?? 0;
  const pointerType = e?.pointerType ?? 'mouse';
  return {
    start: true,
    state: { pointerId, pointerType, down: true },
  };
}

/**
 * The matching release. A pointerup from a *different* finger is ignored so
 * a second tap cannot steal the hold out from under the first.
 */
export function holdUp(state, e) {
  const next = state ?? idleHold();
  if (!next.down) return { end: false, state: next };
  if (!samePointer(next, e)) return { end: false, state: next };
  return { end: true, state: idleHold() };
}

/**
 * `pointerleave` on a held button.
 *
 * This is the whole of the mobile-button bug. Safari on iOS fires
 * `pointerleave` immediately after `pointerdown` on a `<button>`, which made
 * Jump/Break/Place press and unpress in the same frame — they "did nothing".
 * A mouse cursor really can leave, so mouse still ends the hold. A finger
 * does not: it is captured, and only pointerup / pointercancel /
 * lostpointercapture may end it.
 */
export function holdLeave(state, e) {
  const next = state ?? idleHold();
  if (!next.down) return { end: false, state: next };
  const type = next.pointerType || e?.pointerType;
  if (isFingerPointer(type)) return { end: false, state: next };
  if (isFingerPointer(e?.pointerType)) return { end: false, state: next };
  return holdUp(next, e);
}

/** `pointercancel` always ends the hold, even for a finger. */
export function holdCancel(state, e) {
  return holdUp(state, e);
}

/** Capture was lost (the browser took the pointer back). Same as a cancel. */
export function holdLostCapture(state, e) {
  return holdUp(state, e);
}

/**
 * Dispatch a pointer event against a hold. `type` is the DOM event name.
 * Returns `{ start, end, state }` so the listener can apply() and toggle CSS.
 */
export function holdEvent(state, type, e) {
  if (type === 'pointerdown') {
    const r = holdDown(state, e);
    return { start: r.start, end: false, state: r.state };
  }
  if (type === 'pointerup') {
    const r = holdUp(state, e);
    return { start: false, end: r.end, state: r.state };
  }
  if (type === 'pointercancel' || type === 'lostpointercapture') {
    const r = holdCancel(state, e);
    return { start: false, end: r.end, state: r.state };
  }
  if (type === 'pointerleave') {
    const r = holdLeave(state, e);
    return { start: false, end: r.end, state: r.state };
  }
  return { start: false, end: false, state: state ?? idleHold() };
}

/**
 * Joystick deflection from a finger delta, in the same units the player
 * already understands: forward in [-1, 1], strafe in [-1, 1], plus whether
 * the push is hard enough forward to count as a sprint.
 *
 * Thumb up is forward (so dy is negated). A resting thumb inside the
 * deadzone is zero, not a tiny drift.
 */
export function joystickFromDelta(dx, dy, opts = {}) {
  const radius = opts.radius ?? JOY_RADIUS;
  const deadzone = opts.deadzone ?? JOY_DEADZONE;
  const sprintAt = opts.sprint ?? JOY_SPRINT;
  const sprintForward = opts.sprintForward ?? JOY_SPRINT_FORWARD;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || len < deadzone) {
    return { forward: 0, strafe: 0, scale: 0, sprint: false, len: len || 0 };
  }
  const span = Math.max(1e-6, radius - deadzone);
  const scale = Math.min(1, (len - deadzone) / span);
  const nx = (dx / len) * scale;
  const ny = (dy / len) * scale;
  const forward = -ny;
  const strafe = nx;
  const sprint = scale >= sprintAt && forward >= sprintForward;
  return { forward, strafe, scale, sprint, len };
}

/**
 * Where the on-screen knob sits inside the 140px base, given the same delta.
 * Capped so the knob never leaves the ring.
 */
export function joystickKnobOffset(dx, dy, cap = JOY_KNOB_CAP) {
  const len = Math.hypot(dx, dy);
  const c = len > cap && len > 0 ? cap / len : 1;
  return { x: dx * c, y: dy * c };
}

/**
 * Left-half of the screen starts the floating stick; the right half looks.
 * The home pad is a separate hit target and is not decided here.
 */
export function touchRole(clientX, width, joyTaken, lookTaken) {
  const w = width > 0 ? width : 1;
  const left = clientX < w * JOY_SCREEN_FRACTION;
  if (left && !joyTaken) return 'joy';
  if (!lookTaken) return 'look';
  return null;
}

/**
 * A second jump within DOUBLE_TAP_MS is creative flight; otherwise it is
 * just a jump, and `last` is updated so the next press can see it.
 *
 * Returns `{ fly, last }`. The game decides whether fly means anything.
 */
export function jumpTap(now, last, windowMs = DOUBLE_TAP_MS) {
  if (Number.isFinite(last) && now - last > 0 && now - last < windowMs) {
    return { fly: true, last: 0 };
  }
  return { fly: false, last: now };
}

/**
 * Double-tap W: the sprint sticks until W is released. Same window as jump.
 */
export function forwardTap(now, last, windowMs = DOUBLE_TAP_MS) {
  const active = Number.isFinite(last) && now - last > 0 && now - last < windowMs;
  return { active, last: now };
}

/**
 * A press on the hotbar: a mostly-horizontal swipe changes slot, a tap
 * selects the slot the finger started on. Vertical movement is ignored so a
 * thumb sliding up toward Jump does not flip slots.
 */
export function hotbarGesture(startX, startY, endX, endY, slot, threshold = HOTBAR_SWIPE_PX) {
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy)) {
    return { type: 'swipe', dir: dx > 0 ? -1 : 1, slot };
  }
  return { type: 'tap', dir: 0, slot };
}

/**
 * Combine keyboard axes with a joystick sample. Each axis is clamped to
 * [-1, 1] so holding D and pushing the stick right does not make you faster
 * than a full stick on its own.
 */
export function combineMove(keyboard, joy, extras = {}) {
  const forward = clampAxis((keyboard?.forward ?? 0) + (joy?.forward ?? 0));
  const strafe = clampAxis((keyboard?.strafe ?? 0) + (joy?.strafe ?? 0));
  const sneak = Boolean(extras.sneak);
  const sprint = !sneak && Boolean(
    extras.sprint
    || extras.doubleTapSprint
    || joy?.sprint
  );
  return {
    forward,
    strafe,
    jump: Boolean(extras.jump),
    sprint,
    sneak,
  };
}

function clampAxis(v) {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v || 0;
}

/** A short buzz on supported phones. No-op everywhere else. */
export function haptic(ms = 8) {
  try {
    const n = typeof navigator !== 'undefined' ? navigator : null;
    if (n && typeof n.vibrate === 'function') n.vibrate(ms);
  } catch {
    /* ignore: not every browser lets you vibrate */
  }
}

/**
 * Should this canvas touch start the floating joystick, given the existing
 * one? Used by the tests to pin the "one stick at a time" rule.
 */
export function beginJoystick(existing, id, x, y) {
  if (existing) return existing;
  return { id, ox: x, oy: y, x, y };
}

/** Move an existing stick. Unknown ids are ignored. */
export function moveJoystick(joy, id, x, y) {
  if (!joy || joy.id !== id) return joy;
  return { ...joy, x, y };
}

/** End the stick if the lifted finger owns it. */
export function endJoystick(joy, id) {
  if (!joy || joy.id !== id) return joy;
  return null;
}

/** Same trio for the look finger. */
export function beginLook(existing, id, x, y) {
  if (existing && existing.id !== null && existing.id !== undefined) return existing;
  return { id, px: x, py: y, dx: 0, dy: 0 };
}

export function moveLook(look, id, x, y) {
  if (!look || look.id !== id) return look;
  return {
    ...look,
    dx: look.dx + (x - look.px),
    dy: look.dy + (y - look.py),
    px: x,
    py: y,
  };
}

export function endLook(look, id) {
  if (!look || look.id !== id) return look;
  return { ...look, id: null };
}

/**
 * Consume accumulated look deltas. Touch look is only mixed in while the
 * look mode is LOOK_TOUCH, so a leftover finger drag cannot turn the view
 * after a keyboard has taken over.
 */
export function consumeLookDeltas(mouse, look, lookMode, enabled) {
  if (!enabled) {
    return {
      dx: 0,
      dy: 0,
      touch: false,
      mouse: { dx: 0, dy: 0 },
      look: look ? { ...look, dx: 0, dy: 0 } : look,
    };
  }
  let dx = mouse?.dx ?? 0;
  let dy = mouse?.dy ?? 0;
  const touch = lookMode === LOOK_TOUCH;
  let nextLook = look;
  if (touch && look) {
    dx += look.dx || 0;
    dy += look.dy || 0;
    nextLook = { ...look, dx: 0, dy: 0 };
  }
  return { dx, dy, touch, mouse: { dx: 0, dy: 0 }, look: nextLook };
}

/**
 * Toggle sprint/sneak. Returns the new flag. A press while already on turns
 * it off — these are latches, not holds, so a thumb can leave the button.
 */
export function toggleFlag(current) {
  return !current;
}

/**
 * Body classes the HUD frame writes. Split out so the "when do the buttons
 * show" rule is the same function the tests call.
 */
export function hudBodyClasses({ wantsTouch, pointerLocked, freeLookPlaying, hasTouch }) {
  return {
    touch: Boolean(wantsTouch),
    'pointer-locked': Boolean(pointerLocked),
    nocursor: Boolean(freeLookPlaying),
    'has-touch': Boolean(hasTouch),
  };
}

/**
 * Origin of the home joystick: the centre of its element, not the finger.
 * A floating stick originates at the finger instead. Both then use the same
 * joystickFromDelta on (finger - origin).
 */
export function homeJoystickOrigin(rect) {
  if (!rect) return { ox: 0, oy: 0 };
  return {
    ox: rect.left + rect.width / 2,
    oy: rect.top + rect.height / 2,
  };
}

/**
 * Sanity for a 16×16 item map: every row is 16 chars, there are 16 rows,
 * and every non-`.` character is in the palette. Used by the sprite tests
 * so a typo in a pickaxe row cannot ship as a hole in the head.
 */
export function spriteMapErrors(rows, palette, name = 'sprite') {
  const errors = [];
  if (!Array.isArray(rows)) {
    errors.push(`${name}: not an array`);
    return errors;
  }
  if (rows.length !== 16) errors.push(`${name}: ${rows.length} rows, want 16`);
  rows.forEach((row, y) => {
    if (typeof row !== 'string') {
      errors.push(`${name} row ${y}: not a string`);
      return;
    }
    if (row.length !== 16) errors.push(`${name} row ${y}: length ${row.length}, want 16`);
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      if (!palette || palette[ch] === undefined) {
        errors.push(`${name} row ${y} col ${x}: unknown '${ch}'`);
      }
    }
  });
  return errors;
}

/** Count opaque cells — a blank map would pass the size check and still be wrong. */
export function spriteOpaqueCount(rows) {
  if (!Array.isArray(rows)) return 0;
  let n = 0;
  for (const row of rows) {
    if (typeof row !== 'string') continue;
    for (const ch of row) if (ch !== '.') n++;
  }
  return n;
}

/**
 * Bounding box of opaque cells. Tools should occupy a diagonal band, not a
 * blob in one corner; the tests pin a minimum span so a truncated pickaxe
 * fails rather than shipping.
 */
export function spriteBounds(rows) {
  let minX = 16;
  let minY = 16;
  let maxX = -1;
  let maxY = -1;
  if (!Array.isArray(rows)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    if (typeof row !== 'string') continue;
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
