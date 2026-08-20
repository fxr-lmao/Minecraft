// How a press on an inventory slot is read.
//
// A mouse has two buttons and the inventory uses both: left takes the whole
// stack, right takes half — and, with a stack in hand, right places a single
// item. Touch has one, and every one of those right-button behaviours is
// load-bearing. Without them a tap moves all 64 planks into one crafting
// cell and empties the slot they came from, so there is nothing left to put
// in the second cell and none of the two-plank recipes can be built at all.
//
// So on touch a press held past LONG_PRESS_MS means what the right button
// means. A mouse is untouched: it still resolves on pointerdown.
//
// This file has no DOM and no THREE — it takes an object with
// addEventListener and is unit-tested in Node.

/** How long a touch has to be held before it counts as a right-click. */
export const LONG_PRESS_MS = 350;

/**
 * Fire `run(slotEl, secondary, event)` once per press on a slot inside
 * `host`. `resolve(event)` picks the slot element out of the event, or
 * returns null to ignore the press entirely.
 *
 * Touch resolves on release for a primary press, and the moment the hold
 * passes LONG_PRESS_MS for a secondary one — fired there rather than on
 * release, so holding has an endpoint you can feel.
 *
 * @param {{addEventListener: Function}} host
 * @param {(e: any) => any} resolve
 * @param {(el: any, secondary: boolean, e: any) => void} run
 * @param {{now?: () => number, setTimer?: Function, clearTimer?: Function}} [deps]
 */
export function bindSlotPress(host, resolve, run, deps = {}) {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));

  let timer = null;
  let held = null;
  let fired = false;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    held = null;
  };

  host.addEventListener('pointerdown', (e) => {
    const el = resolve(e);
    if (!el) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    if (e.pointerType !== 'touch') {
      run(el, e.button === 2, e);
      return;
    }
    cancel();
    held = el;
    fired = false;
    timer = setTimer(() => {
      timer = null;
      fired = true;
      run(el, true, e);
    }, LONG_PRESS_MS);
  });

  // Touch implicitly captures the pointer, so the release lands here even if
  // the finger slid off the slot first. Deliberately no `pointerleave`: under
  // that same capture it fires just before `pointerup` and would eat the tap.
  host.addEventListener('pointerup', (e) => {
    if (!held) return;
    const el = held;
    const pending = timer;
    cancel();
    if (pending !== null && !fired) run(el, false, e);
    fired = false;
  });

  host.addEventListener('pointercancel', () => {
    cancel();
    fired = false;
  });
}
