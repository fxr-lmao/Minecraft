// Pointer-lock behaviour, and the native iPad bridge.
//
// Two things are pinned down here. First, that a refused lock is retried
// rather than treated as a verdict — browsers refuse for a second after the
// user presses Esc, and giving up on that refusal left the mouse in free look
// for the rest of the session. Second, the native bridge contract: a plain
// browser is completely unaffected by it, and under a host the browser's lock
// machinery is bypassed rather than run in parallel with UIKit's.

import { Input, LOOK_LOCK, LOOK_FREE } from '../src/input.js';
import { installNativeBridge, nativeHandler } from '../src/native.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

// ------------------------------------------------------------ DOM stub
// Input only ever adds listeners and reads a couple of elements, so a
// recorder is enough to both construct it and fire events at it.
function makeTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    fire(type, event = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

function installDom({ native = false } = {}) {
  const canvas = makeTarget();
  const doc = makeTarget();
  const win = makeTarget();

  canvas.requestPointerLock = () => {
    canvas.lockRequested = (canvas.lockRequested ?? 0) + 1;
  };
  doc.getElementById = () => null;
  doc.exitPointerLock = () => {
    doc.exitCount = (doc.exitCount ?? 0) + 1;
  };
  doc.pointerLockElement = null;
  doc.fullscreenElement = null;
  doc.documentElement = {
    requestFullscreen() {
      doc.fullscreenElement = doc.documentElement;
    },
  };

  win.innerWidth = 1024;
  win.innerHeight = 768;
  if (native) {
    win.__MC_NATIVE_HOST__ = true;
    win.posted = [];
    win.webkit = {
      messageHandlers: { mcnative: { postMessage: (m) => win.posted.push(m) } },
    };
  }

  globalThis.window = win;
  globalThis.document = doc;
  // Node 22 ships a read-only global navigator, hence defineProperty.
  Object.defineProperty(globalThis, 'navigator', {
    value: { maxTouchPoints: 5 }, // pretend to be an iPad
    configurable: true,
    writable: true,
  });
  return { canvas, doc, win };
}

function teardown() {
  delete globalThis.window;
  delete globalThis.document;
}

// ---------------------------------------------------- a plain browser
{
  const { canvas, doc } = installDom({ native: false });
  const input = new Input(canvas);

  assert('no host detected without the flag', nativeHandler() === null);
  assert('bridge does not install in a browser', installNativeBridge(input) === null);
  assert('no host attached', input.nativeHost === null);
  assert('MCN is not defined', globalThis.window.MCN === undefined);

  // The ordinary pointer-lock path still runs untouched.
  input.start('key');
  assert('browser start requests a real lock', canvas.lockRequested === 1, canvas.lockRequested);
  assert('session is active', input.active);

  // ...and the silent-failure fallback still fires once the retries run out.
  input._giveUpOnLock();
  assert('still falls back to free look', input.lookMode === LOOK_FREE, input.lookMode);

  input.locked = true;
  input.release();
  assert('browser release exits pointer lock', doc.exitCount === 1, doc.exitCount);
  teardown();
}

// ------------------------------------------------------- under the host
{
  const { canvas, win } = installDom({ native: true });
  const input = new Input(canvas);
  const api = installNativeBridge(input);

  assert('bridge installs under a host', api !== null);
  assert('MCN is exposed to Swift', win.MCN === api);
  assert('bridge announces itself', win.posted.some((m) => m.type === 'ready'));
  assert('host is attached', input.nativeHost !== null);
  assert('look mode is lock, not free', input.lookMode === LOOK_LOCK, input.lookMode);

  // Starting must ask the host, and must NOT touch the browser lock: that
  // request is what fails silently on iPadOS in the first place.
  win.posted.length = 0;
  input.start('key');
  assert('start asks the host to lock', win.posted.some((m) => m.type === 'lock'));
  assert('start never calls requestPointerLock', canvas.lockRequested === undefined);
  assert('start never enters fullscreen', !input.isFullscreen);
  assert('session is active', input.active);

  // Deltas arrive already in the browser's sign convention.
  api.lockChanged(true);
  assert('lock state is reported', input.nativeLocked === true);
  api.look(12, -4);
  api.look(3, 1);
  const look = input.consumeLook();
  assert('deltas accumulate', look.dx === 15 && look.dy === -3, `${look.dx},${look.dy}`);
  assert('not treated as touch look', look.touch === false);

  // Buttons map onto the same actions as a browser mouse.
  const fired = [];
  input.onAction = (name, arg) => fired.push([name, arg]);
  api.button(0, true);
  assert('left button breaks', fired.at(-1)?.[0] === 'break');
  assert('break repeats while held', input.pressed.break === true);
  api.button(0, false);
  assert('releasing stops the repeat', input.pressed.break === false);
  api.button(2, true);
  assert('right button places', fired.at(-1)?.[0] === 'place');
  api.button(1, true);
  assert('middle button picks', fired.at(-1)?.[0] === 'pick');

  // A click that leaks through the web view while the host holds the pointer
  // would break the block twice.
  fired.length = 0;
  canvas.fire('mousedown', { button: 0, preventDefault() {} });
  assert('browser clicks are ignored while natively locked', fired.length === 0, fired.length);

  api.lockChanged(false);
  fired.length = 0;
  canvas.fire('mousedown', { button: 0, preventDefault() {} });
  assert('browser clicks work again once unlocked', fired.at(-1)?.[0] === 'break');

  // Esc pauses, which must release the real pointer through the host.
  win.posted.length = 0;
  input.release();
  assert('release asks the host to unlock', win.posted.some((m) => m.type === 'unlock'));
  assert('session ended', input.active === false);

  // Backgrounding the app pauses the game.
  fired.length = 0;
  api.escape();
  assert('escape reaches the game', fired.some(([n]) => n === 'escape'));

  // Menus release the pointer without ending the session, then take it back.
  input.start('key');
  win.posted.length = 0;
  input.releasePointerOnly();
  assert('opening a menu unlocks', win.posted.some((m) => m.type === 'unlock'));
  assert('session survives the menu', input.active === true);
  input.resumePointer();
  assert('closing a menu re-locks', win.posted.some((m) => m.type === 'lock'));

  // The free-look fallback must never engage here — there is a real lock.
  assert('never falls back to free look', input.lookMode === LOOK_LOCK, input.lookMode);
  assert('lock is not marked unavailable', input.lockUnavailable === false);
  teardown();
}

// ------------------------------------------------------ a hostile host
// The flag alone is not enough: without the message handler there is nobody
// to talk to, and installing anyway would strand the player with no lock and
// no fallback.
{
  const { canvas, win } = installDom({ native: true });
  delete win.webkit;
  const input = new Input(canvas);
  assert('flag without a handler is ignored', installNativeBridge(input) === null);
  assert('no host attached', input.nativeHost === null);
  teardown();
}

// --------------------------------------------------- the lock retry ladder
{
  const { canvas, doc } = installDom({ native: false });
  const input = new Input(canvas);
  const modes = [];
  input.onAction = (name, arg) => { if (name === 'lookmode') modes.push(arg); };

  input.start('key');
  assert('the first attempt is made immediately', canvas.lockRequested === 1);

  // The browser refuses (Esc cooldown). That must not be the end of it.
  input._lockVerifyFailed();
  assert('a refusal does not fall back yet', input.lookMode === LOOK_LOCK, input.lookMode);
  assert('...and does not mark the lock unavailable', input.lockUnavailable === false);
  assert('...and reports no mode change', modes.length === 0, JSON.stringify(modes));

  await sleep(400);
  assert('it retries on its own', canvas.lockRequested === 2, canvas.lockRequested);

  // Suppose the retry succeeds: the ladder resets for next time.
  doc.pointerLockElement = canvas;
  doc.fire('pointerlockchange', {});
  assert('a successful lock is reported', input.locked === true);
  assert('the retry counter resets', input._lockAttempt === 0);

  teardown();
}

// A browser that refuses every single time still ends up in free look.
{
  const { canvas } = installDom({ native: false });
  const input = new Input(canvas);
  const modes = [];
  input.onAction = (name, arg) => { if (name === 'lookmode') modes.push(arg); };

  input.start('key');
  for (let i = 0; i < 6; i++) {
    input._lockVerifyFailed();
    await sleep(1400);
  }
  assert('it gives up eventually', input.lookMode === LOOK_FREE, input.lookMode);
  assert('and says so once', modes.filter((m) => m === LOOK_FREE).length === 1,
    JSON.stringify(modes));
  assert('the retries were bounded', canvas.lockRequested <= 5, canvas.lockRequested);
  teardown();
}

// Pausing must stop a retry in flight, or it would grab the mouse back while
// the pause menu is open.
{
  const { canvas } = installDom({ native: false });
  const input = new Input(canvas);
  input.start('key');
  input._lockVerifyFailed();
  input.release();
  const before = canvas.lockRequested;
  await sleep(400);
  assert('a pending retry is cancelled by pausing', canvas.lockRequested === before,
    `${before} -> ${canvas.lockRequested}`);
  teardown();
}

// ---------------------------------------------------------------- report
let failures = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
