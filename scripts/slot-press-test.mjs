// How a slot press is read: mouse on pointerdown, touch on release, and a
// held touch standing in for the right button. Pure — no DOM, no THREE.

import { bindSlotPress, LONG_PRESS_MS } from '../src/slot-press.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

/** The smallest thing that behaves like an element for this purpose. */
function fakeHost() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    emit(type, e = {}) {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
  };
}

/** A clock we drive by hand, so the tests never actually wait. */
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    deps: {
      setTimer(fn, ms) { const id = next++; pending.set(id, { fn, ms }); return id; },
      clearTimer(id) { pending.delete(id); },
    },
    /** Fire everything due at or before `ms`. */
    advance(ms) {
      for (const [id, t] of [...pending]) {
        if (t.ms <= ms) { pending.delete(id); t.fn(); }
      }
    },
    get count() { return pending.size; },
  };
}

const SLOT = { id: 'slot' };
function harness() {
  const host = fakeHost();
  const timers = fakeTimers();
  const calls = [];
  bindSlotPress(host, () => SLOT, (el, secondary) => calls.push(secondary), timers.deps);
  return { host, timers, calls };
}

// ---- mouse: unchanged, resolves on pointerdown ----
{
  const h = harness();
  h.host.emit('pointerdown', { pointerType: 'mouse', button: 0 });
  check('left click runs at once', h.calls.length === 1 && h.calls[0] === false);
  h.host.emit('pointerdown', { pointerType: 'mouse', button: 2 });
  check('right click is the secondary action', h.calls.length === 2 && h.calls[1] === true);
  h.host.emit('pointerup', { pointerType: 'mouse' });
  check('the mouse release adds nothing', h.calls.length === 2);
  check('the mouse sets no timer', h.timers.count === 0);
}

// ---- touch: a quick tap is the primary action, and only on release ----
{
  const h = harness();
  h.host.emit('pointerdown', { pointerType: 'touch' });
  check('a touch does nothing yet', h.calls.length === 0);
  h.timers.advance(LONG_PRESS_MS - 1); // not long enough
  check('a short hold does not fire', h.calls.length === 0);
  h.host.emit('pointerup', { pointerType: 'touch' });
  check('the tap fires on release', h.calls.length === 1 && h.calls[0] === false);
  check('the timer is cleaned up', h.timers.count === 0);
}

// ---- touch: a held press is the right button, fired on the hold ----
{
  const h = harness();
  h.host.emit('pointerdown', { pointerType: 'touch' });
  h.timers.advance(LONG_PRESS_MS);
  check('the hold fires without waiting for release', h.calls.length === 1 && h.calls[0] === true);
  h.host.emit('pointerup', { pointerType: 'touch' });
  check('releasing after a hold does not fire again', h.calls.length === 1);
}

// ---- a cancelled touch does nothing at all ----
{
  const h = harness();
  h.host.emit('pointerdown', { pointerType: 'touch' });
  h.host.emit('pointercancel', {});
  h.timers.advance(LONG_PRESS_MS * 4);
  check('a cancelled press never fires', h.calls.length === 0);
  h.host.emit('pointerup', { pointerType: 'touch' });
  check('...and its release is ignored too', h.calls.length === 0);
}

// ---- a press the resolver rejects is left alone ----
{
  const host = fakeHost();
  const timers = fakeTimers();
  const calls = [];
  bindSlotPress(host, () => null, () => calls.push(true), timers.deps);
  let prevented = false;
  host.emit('pointerdown', { pointerType: 'touch', preventDefault() { prevented = true; } });
  host.emit('pointerup', { pointerType: 'touch' });
  check('a press outside a slot does nothing', calls.length === 0);
  check('...and is not swallowed', prevented === false);
}

// ---- two presses in a row both count ----
{
  const h = harness();
  for (let i = 0; i < 3; i++) {
    h.host.emit('pointerdown', { pointerType: 'touch' });
    h.host.emit('pointerup', { pointerType: 'touch' });
  }
  check('repeated taps each fire once', h.calls.length === 3 && h.calls.every((c) => c === false));
  h.host.emit('pointerdown', { pointerType: 'touch' });
  h.timers.advance(LONG_PRESS_MS);
  check('a hold after taps is still secondary', h.calls.length === 4 && h.calls[3] === true);
}

// ---- a stray release with no press behind it is harmless ----
{
  const h = harness();
  h.host.emit('pointerup', { pointerType: 'touch' });
  check('a release with no press does nothing', h.calls.length === 0);
}

check('the hold threshold is 350ms', LONG_PRESS_MS === 350);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
