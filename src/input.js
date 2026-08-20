// Keyboard, mouse/trackpad, and touch input.
//
// Look modes
// ----------
// Pointer lock is the best way to read a mouse, but it cannot be relied on:
// iPadOS Safari often refuses it outright in a normal tab, and — crucially —
// it refuses *silently*: requestPointerLock() returns undefined, fires no
// 'pointerlockerror', and simply never locks. Gating mouse look on
// document.pointerLockElement therefore leaves an iPad trackpad completely
// dead with nothing reporting why.
//
// So the pointer is never trusted, it is verified: we ask for the lock, then
// check a moment later whether it actually engaged, and fall back if not.
// Three modes result, and the game plays in all of them:
//
//   'lock'  pointer locked; raw movement deltas, cursor hidden by the browser
//   'free'  no lock available; look follows raw cursor movement, and parking
//           the cursor against a screen edge keeps turning (so you can still
//           spin 360° even though the cursor stops at the screen edge)
//   'touch' finger drag to look
//
// Entering fullscreen first measurably improves the odds of a real lock on
// iPadOS, so a touch-capable device tries that on the same user gesture.
//
// A fourth possibility sits outside those three: when the game runs inside the
// native iPad wrapper (ipad-app/), a real pointer lock is available from UIKit
// and raw deltas come from GCMouse. attachNativeHost() switches to it — the
// host owns the lock, so none of the browser's lock machinery runs.

import {
  playSource as playSourceFromPointer,
  isFingerPointer,
  recentFinger as fingerIsRecent,
  wantsTouchUi as computeWantsTouchUi,
  idleHold, holdEvent,
  joystickFromDelta, joystickKnobOffset, homeJoystickOrigin, touchRole,
  combineMove, jumpTap, haptic,
  JOY_KNOB_CAP, FINGER_MEMORY_MS,
} from './touch-controls.js';

export { playSourceFromPointer as playSource };

export const LOOK_LOCK = 'lock';
export const LOOK_FREE = 'free';
export const LOOK_TOUCH = 'touch';

/** How long to wait before deciding requestPointerLock() silently failed. */
const LOCK_VERIFY_MS = 400;

/**
 * A refused lock is not always a permanent one. Browsers impose a cooldown
 * after the *user* exits a lock with Esc — Chrome rejects a new request for
 * about a second — so the very common "Esc, then click Play again" refuses
 * once and would succeed a moment later. Falling back to free look on that
 * first refusal stranded the player in the fallback for the rest of the
 * session, which read as "the mouse stopped locking after the first time".
 *
 * So a refusal is retried on a rising delay, and only the last one gives up.
 */
const LOCK_RETRY_MS = [250, 600, 1200];

const KEYMAP = {
  KeyW: 'forward',
  KeyA: 'left',
  KeyS: 'back',
  KeyD: 'right',
  ArrowUp: 'forward',
  ArrowLeft: 'left',
  ArrowDown: 'back',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sneak',
  ShiftRight: 'sneak',
  ControlLeft: 'sprint',
  ControlRight: 'sprint',
};

// One-shot keys -> action names emitted to the game.
// F3/F5/F11 do not exist on the iPad Magic Keyboard, so G, V and F are the
// primary bindings and the function keys are aliases.
const ACTION_KEYS = {
  KeyE: 'inventory',
  KeyI: 'inventory',
  KeyV: 'view',
  F5: 'view',
  KeyG: 'debug',
  F3: 'debug',
  KeyF: 'fullscreen',
  F11: 'fullscreen',
  KeyC: 'gamemode',
  // Q throws the selected stack on the floor, one at a time; Ctrl+Q throws
  // the lot. Minecraft's binding exactly, and the modifier is read at the
  // keydown rather than from the movement state, because Ctrl is also
  // sprint and the sprint flag says nothing about whether it is down *now*.
  KeyQ: 'drop',
  Escape: 'escape',
};

// Free-look edge turning: how close to the edge (fraction of the viewport)
// starts a turn, and how fast the turn runs at the very edge.
const EDGE_ZONE = 0.12;
const EDGE_SPEED = 900; // equivalent mouse px per second

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;

    /** The game is running (started, not paused). */
    this.sessionActive = false;
    /** How look input is being read right now. */
    this.lookMode = LOOK_LOCK;
    /** True once a lock attempt was verified as failed; stops auto-retrying. */
    this.lockUnavailable = false;
    /** Native wrapper, if any: { lock(), unlock() }. See native.js. */
    this.nativeHost = null;
    /** True while the native host reports the pointer captured. */
    this.nativeLocked = false;

    this.hasTouch =
      typeof window !== 'undefined' &&
      (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);
    this.pointerLockSupported = typeof canvas.requestPointerLock === 'function';
    /** True when the last thing the player used was a finger. */
    this.usingTouch = false;
    /** False while a menu owns the input (inventory screen). */
    this.enabled = true;
    /** Mouse/touch buttons currently held, for break/place auto-repeat. */
    this.pressed = { break: false, place: false };
    /** Set by the game to receive one-shot actions. */
    this.onAction = () => {};

    // free-look cursor tracking
    this.pointer = { x: 0, y: 0, seen: false, inside: true };

    this.touch = {
      joy: null, // { id, ox, oy, x, y }
      look: { id: null, px: 0, py: 0, dx: 0, dy: 0 },
      jump: false,
      sprint: false,
      sneak: false,
    };

    this._doubleTap = { forward: { last: 0, active: false } };
    /** Last Space / jump-button press, for the double-tap that toggles creative flight. */
    this._lastJumpAt = 0;
    /** Last real `touchstart` (ms), used to recover from iOS reporting a finger as a mouse. */
    this._fingerAt = 0;
    this._joyBase = document.getElementById('joy-base');
    this._joyKnob = document.getElementById('joy-knob');
    this._joyHome = document.getElementById('joy-home');
    this._lockTimer = null;
    this._retryTimer = null;
    this._lockAttempt = 0;

    this._initKeyboard();
    this._initPointer();
    this._initTouch();
    this._bindButtons();
  }

  /** True if a finger touched the page in the last couple of seconds. */
  get recentFinger() {
    return this.hasTouch && fingerIsRecent(performance.now(), this._fingerAt, FINGER_MEMORY_MS);
  }

  /**
   * Show the movement pad and jump/break/place cluster.
   *
   * Hidden while a real pointer lock owns the mouse — those buttons would sit
   * there unable to be clicked. Shown for touch play, and also for any
   * touch-capable session that is not locked, so a phone that started Play
   * with a bogus `pointerType: 'mouse'` still gets buttons it can press.
   */
  get wantsTouchUi() {
    return computeWantsTouchUi({
      locked: this.locked,
      nativeLocked: this.nativeLocked,
      usingTouch: this.usingTouch,
      lookMode: this.lookMode,
      hasTouch: this.hasTouch,
      sessionActive: this.sessionActive,
    });
  }

  /** Record that a real finger landed, for Play-source recovery. */
  noteFinger() {
    this._fingerAt = performance.now();
    this.usingTouch = true;
    if (this.sessionActive) this.lookMode = LOOK_TOUCH;
  }

  /** Game is running (in any look mode). */
  get active() {
    return this.sessionActive;
  }

  /** Human-readable mode, for the debug screen and the pause menu. */
  get lookModeLabel() {
    if (this.lookMode === LOOK_TOUCH) return 'touch';
    if (this.lookMode === LOOK_FREE) return 'mouse (free look)';
    if (this.nativeHost) return this.nativeLocked ? 'mouse (native lock)' : 'mouse (native)';
    return this.locked ? 'mouse (locked)' : 'mouse';
  }

  // -------------------------------------------------------------- native host

  /**
   * Run under the native iPad wrapper. The host captures the pointer through
   * UIKit and pushes raw deltas in, so the browser lock — and the free-look
   * fallback that exists only to survive Safari refusing it — are both unused.
   */
  attachNativeHost(host) {
    this.nativeHost = host;
    this.lockUnavailable = false;
    this.lookMode = LOOK_LOCK;
  }

  /** The host captured or released the pointer. */
  setNativeLocked(on) {
    this.nativeLocked = Boolean(on);
    if (this.nativeLocked) this.lookMode = LOOK_LOCK;
    this.onAction('lookmode', this.lookMode);
  }

  /** Raw mouse delta from GCMouse, already in browser sign convention. */
  nativeLook(dx, dy) {
    if (!this.enabled || !this.sessionActive) return;
    this.usingTouch = false;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Mouse button from GCMouse: 0 left, 1 middle, 2 right. */
  nativeButton(index, down) {
    if (!this.sessionActive || !this.enabled) return;
    if (index === 0) {
      this.pressed.break = down;
      if (down) this.onAction('break');
    } else if (index === 2) {
      this.pressed.place = down;
      if (down) this.onAction('place');
    } else if (index === 1 && down) {
      this.onAction('pick');
    }
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Start playing. `source` is 'touch' for a finger, anything else for a
   * mouse/trackpad/keyboard.
   */
  start(source) {
    if (source === 'touch') {
      this.usingTouch = true;
      this.lookMode = LOOK_TOUCH;
      this.sessionActive = true;
      return;
    }
    this.usingTouch = false;
    // The native wrapper is already fullscreen and its lock never fails, so
    // it skips the Safari workarounds entirely.
    if (this.nativeHost) {
      this.requestLock();
      this.sessionActive = true;
      return;
    }
    // A touch-capable device that is being driven by a keyboard/trackpad is
    // almost certainly an iPad with the Magic Keyboard: going fullscreen on
    // this same gesture is what makes Safari willing to lock the pointer.
    if (this.hasTouch) this.enterFullscreen();
    // The session starts either way — if the lock never engages we play in
    // free-look mode rather than stranding the player on the title screen.
    // It is set *before* asking, because a synchronous refusal checks it to
    // decide whether retrying is still worth it.
    this.sessionActive = true;
    this.requestLock();
  }

  requestLock() {
    if (this.nativeHost) {
      this.lookMode = LOOK_LOCK;
      this.nativeHost.lock();
      return;
    }
    this._lockAttempt = 0;
    this._attemptLock();
  }

  _attemptLock() {
    clearTimeout(this._retryTimer);
    if (!this.pointerLockSupported) {
      this._giveUpOnLock();
      return;
    }
    this.lookMode = LOOK_LOCK;
    try {
      const p = this.canvas.requestPointerLock();
      // Chrome returns a promise and rejects if called too soon after Esc.
      // Safari returns undefined and reports nothing at all, hence the timer.
      if (p && typeof p.catch === 'function') p.catch(() => this._lockVerifyFailed());
    } catch {
      this._lockVerifyFailed();
      return;
    }
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => {
      if (!this.locked) this._lockVerifyFailed();
    }, LOCK_VERIFY_MS);
  }

  /** Ask for the lock again after the player explicitly requested a retry. */
  retryLock() {
    this.lockUnavailable = false;
    this.enterFullscreen();
    this.requestLock();
  }

  /**
   * A lock attempt did not take. Try again on a rising delay before deciding
   * the browser will never grant one — a refusal right after Esc is a
   * cooldown, not a verdict.
   */
  _lockVerifyFailed() {
    clearTimeout(this._lockTimer);
    if (this.locked) return;
    const delay = LOCK_RETRY_MS[this._lockAttempt];
    if (delay === undefined || !this.sessionActive) {
      this._giveUpOnLock();
      return;
    }
    this._lockAttempt++;
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      if (!this.locked && this.sessionActive) this._attemptLock();
    }, delay);
  }

  /** Out of retries — play with cursor-movement look instead. */
  _giveUpOnLock() {
    clearTimeout(this._lockTimer);
    clearTimeout(this._retryTimer);
    if (this.locked || this.lockUnavailable) return; // announce it once
    this.lockUnavailable = true;
    this.lookMode = this.usingTouch ? LOOK_TOUCH : LOOK_FREE;
    this.onAction('lookmode', this.lookMode);
  }

  /** Release the mouse (Esc) — the game pauses. */
  release() {
    clearTimeout(this._lockTimer);
    clearTimeout(this._retryTimer);
    if (this.nativeHost) this.nativeHost.unlock();
    else if (this.locked && document.exitPointerLock) document.exitPointerLock();
    this.sessionActive = false;
    this.keys.clear();
    this.pressed.break = false;
    this.pressed.place = false;
  }

  /** Release the pointer without ending the session (opening a menu). */
  releasePointerOnly() {
    clearTimeout(this._lockTimer);
    clearTimeout(this._retryTimer);
    if (this.nativeHost) this.nativeHost.unlock();
    else if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  /** Re-acquire the pointer after a menu closes. */
  resumePointer() {
    if (this.nativeHost) {
      this.requestLock();
      return;
    }
    if (this.lookMode === LOOK_TOUCH || this.lockUnavailable) return;
    this.requestLock();
  }

  // ---------------------------------------------------------- fullscreen

  get isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  enterFullscreen() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return false;
    try {
      const p = fn.call(el);
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  exitFullscreen() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fn) return;
    try {
      const p = fn.call(document);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  toggleFullscreen() {
    if (this.isFullscreen) this.exitFullscreen();
    else this.enterFullscreen();
  }

  /** Menus disable movement/look without ending the session. */
  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.touch.joy = null;
      this.touch.jump = false;
      this.pressed.break = false;
      this.pressed.place = false;
      this.mouseDX = 0;
      this.mouseDY = 0;
      this._hideJoystick();
    }
  }

  // -------------------------------------------------------------- keyboard

  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.altKey) return; // leave browser shortcuts alone
      const action = ACTION_KEYS[e.code];
      const move = KEYMAP[e.code];
      if (move || action) {
        this.usingTouch = false;
        if (e.code !== 'Escape') e.preventDefault();
      }
      if (e.repeat) return;

      if (action) {
        // `drop` is the one action with a modifier: Ctrl+Q throws the whole
        // stack. The flag is read off the event rather than from `this.keys`,
        // because Ctrl is also sprint and the sprint key being *held* is a
        // different question from Ctrl being down at this instant.
        this.onAction(action, action === 'drop' ? e.ctrlKey || e.shiftKey : undefined);
        return;
      }
      if (/^Digit[1-9]$/.test(e.code)) {
        this.usingTouch = false;
        e.preventDefault();
        this.onAction('slot', Number(e.code.slice(5)) - 1);
        return;
      }
      if (move) {
        if (move === 'forward') this._onForwardPress();
        // Double-tapping jump is how Minecraft toggles creative flight. The
        // game decides whether that means anything; input only reports it.
        if (move === 'jump') {
          const now = performance.now();
          if (now - this._lastJumpAt < 280) {
            this._lastJumpAt = 0;
            this.onAction('fly');
          } else {
            this._lastJumpAt = now;
          }
        }
        this.keys.add(move);
      }
    });

    window.addEventListener('keyup', (e) => {
      const move = KEYMAP[e.code];
      if (move) this.keys.delete(move);
    });

    // A window that loses focus would otherwise keep "W held down" forever.
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pressed.break = false;
      this.pressed.place = false;
    });
  }

  // --------------------------------------------------------- mouse / lock

  _initPointer() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) {
        clearTimeout(this._lockTimer);
        clearTimeout(this._retryTimer);
        this._lockAttempt = 0;
        this.lookMode = LOOK_LOCK;
        this.lockUnavailable = false;
      } else {
        this.keys.clear();
        this.pressed.break = false;
        this.pressed.place = false;
      }
    });
    document.addEventListener('pointerlockerror', () => this._lockVerifyFailed());

    // Locked look: raw deltas straight from the driver.
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.usingTouch = false;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    // Free look: no lock, so derive deltas from cursor movement ourselves.
    // movementX/Y is unreliable outside pointer lock, client coords are not.
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.usingTouch = false;
      const p = this.pointer;
      if (this.lookMode === LOOK_FREE && this.sessionActive && this.enabled && p.seen) {
        this.mouseDX += e.clientX - p.x;
        this.mouseDY += e.clientY - p.y;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      p.seen = true;
      p.inside = true;
    });
    // Leaving the window must not leave the edge-turn running forever.
    document.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget && e.pointerType !== 'touch') this.pointer.inside = false;
    });
    window.addEventListener('blur', () => { this.pointer.inside = false; });

    // Clicking with a real mouse/trackpad during a touch session takes over.
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || this.nativeLocked) return;
      this.usingTouch = false;
      if (!this.locked && !this.lockUnavailable && this.enabled && this.sessionActive) {
        this.requestLock();
      }
    });

    // Break / place. Works in every mouse mode, not just when locked.
    // While the native host holds the pointer, clicks arrive through the
    // bridge instead — taking both would break and place twice per click.
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.nativeLocked) return;
      if (!this.sessionActive || !this.enabled || this.lookMode === LOOK_TOUCH) return;
      e.preventDefault();
      if (e.button === 0) {
        this.pressed.break = true;
        this.onAction('break');
      } else if (e.button === 2) {
        this.pressed.place = true;
        this.onAction('place');
      } else if (e.button === 1) {
        this.onAction('pick');
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.pressed.break = false;
      if (e.button === 2) this.pressed.place = false;
    });
    // Right-click must place a block, not open the context menu.
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('wheel', (e) => {
      if (!this.active || !this.enabled || e.deltaY === 0) return;
      this.onAction(e.shiftKey ? 'zoom' : 'scroll', e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
  }

  /**
   * Extra look movement from parking the cursor near a screen edge.
   * Only used in free-look, where the cursor physically cannot travel
   * further. Returns the same units as a mouse delta.
   */
  edgeLook(dt) {
    const p = this.pointer;
    if (this.lookMode !== LOOK_FREE || !this.sessionActive || !this.enabled) return null;
    if (!p.seen || !p.inside) return null;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const zoneX = w * EDGE_ZONE;
    const zoneY = h * EDGE_ZONE;
    let dx = 0;
    let dy = 0;
    if (p.x < zoneX) dx = -(1 - p.x / zoneX);
    else if (p.x > w - zoneX) dx = 1 - (w - p.x) / zoneX;
    if (p.y < zoneY) dy = -(1 - p.y / zoneY);
    else if (p.y > h - zoneY) dy = 1 - (h - p.y) / zoneY;
    if (dx === 0 && dy === 0) return null;
    // ease in so the turn starts gently instead of snapping
    const ease = (v) => Math.sign(v) * v * v;
    return { dx: ease(dx) * EDGE_SPEED * dt, dy: ease(dy) * EDGE_SPEED * dt };
  }

  // ------------------------------------------------------------------ touch

  _initTouch() {
    if (typeof window !== 'undefined') {
      window.addEventListener('touchstart', () => { this._fingerAt = performance.now(); }, {
        capture: true,
        passive: true,
      });
    }
    if (!this.hasTouch) return;
    const cv = this.canvas;

    cv.addEventListener(
      'touchstart',
      (e) => {
        this.noteFinger();
        e.preventDefault();
        if (!this.sessionActive || !this.enabled) return;
        for (const t of e.changedTouches) {
          const role = touchRole(
            t.clientX, window.innerWidth,
            Boolean(this.touch.joy), this.touch.look.id !== null,
          );
          if (role === 'joy') {
            this.touch.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
            this._showJoystick(t.clientX, t.clientY);
          } else if (role === 'look') {
            this.touch.look = { id: t.identifier, px: t.clientX, py: t.clientY, dx: 0, dy: 0 };
          }
        }
      },
      { passive: false }
    );

    cv.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        for (const t of e.changedTouches) {
          const j = this.touch.joy;
          // `home` sticks are keyed by pointerId, which lives in a different
          // number space than Touch.identifier — matching across the two lets
          // a look finger with a colliding id steal the pad.
          if (j && !j.home && t.identifier === j.id) {
            j.x = t.clientX;
            j.y = t.clientY;
            this._updateJoystick(j.x - j.ox, j.y - j.oy);
          } else if (this.touch.look.id === t.identifier) {
            const l = this.touch.look;
            l.dx += t.clientX - l.px;
            l.dy += t.clientY - l.py;
            l.px = t.clientX;
            l.py = t.clientY;
          }
        }
      },
      { passive: false }
    );

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (this.touch.joy && !this.touch.joy.home && t.identifier === this.touch.joy.id) {
          this.touch.joy = null;
          this._hideJoystick();
        }
        if (this.touch.look.id === t.identifier) this.touch.look.id = null;
      }
    };
    cv.addEventListener('touchend', endTouch);
    cv.addEventListener('touchcancel', endTouch);

    this._bindJoyHome();
  }

  _bindJoyHome() {
    const el = this._joyHome;
    if (!el) return;
    const mine = (e) => {
      const j = this.touch.joy;
      return j && j.home === true && j.id === e.pointerId ? j : null;
    };
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isFingerPointer(e.pointerType)) this.noteFinger();
      if (this.touch.joy) return;
      if (!this.sessionActive || !this.enabled) return;
      const { ox, oy } = homeJoystickOrigin(el.getBoundingClientRect());
      this.touch.joy = { id: e.pointerId, ox, oy, x: e.clientX, y: e.clientY, home: true };
      try { el.setPointerCapture(e.pointerId); } catch { /* not every stub has capture */ }
      this._showJoystick(ox, oy);
      this._updateJoystick(e.clientX - ox, e.clientY - oy);
    };
    const move = (e) => {
      const j = mine(e);
      if (!j) return;
      j.x = e.clientX;
      j.y = e.clientY;
      this._updateJoystick(j.x - j.ox, j.y - j.oy);
    };
    const up = (e) => {
      if (!mine(e)) return;
      this.touch.joy = null;
      this._hideJoystick();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    // Capture normally retargets the release to the pad, but if it was
    // refused the finger lifts somewhere else entirely — without this the
    // stick stays pushed and the player walks off on their own.
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _showJoystick(x, y) {
    if (!this._joyBase || !this._joyKnob) return;
    this._joyBase.style.left = `${x}px`;
    this._joyBase.style.top = `${y}px`;
    this._joyBase.classList.add('visible');
    this._updateJoystick(0, 0);
  }

  _updateJoystick(dx, dy) {
    if (!this._joyKnob) return;
    const { x, y } = joystickKnobOffset(dx, dy, JOY_KNOB_CAP);
    this._joyKnob.style.left = `calc(50% + ${x.toFixed(1)}px)`;
    this._joyKnob.style.top = `calc(50% + ${y.toFixed(1)}px)`;
  }

  _hideJoystick() {
    this._joyBase?.classList.remove('visible');
  }

  /**
   * On-screen buttons: held (jump/break/place), toggled (sprint/sneak) or
   * one-shot. Hold uses the pure state machine in touch-controls.js so a
   * Safari `pointerleave` on press cannot unpress Jump in the same frame.
   */
  _bindButtons() {
    const hold = (id, apply) => {
      const el = document.getElementById(id);
      if (!el) return;
      let state = idleHold();
      const run = (type, e) => {
        if (e) {
          e.preventDefault?.();
          e.stopPropagation?.();
        }
        const result = holdEvent(state, type, e);
        const wasDown = state.down;
        state = result.state;
        if (result.start && !wasDown) {
          if (isFingerPointer(e?.pointerType)) this.noteFinger();
          try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
          apply(true);
          el.classList.add('active');
        }
        if (result.end && wasDown) {
          apply(false);
          el.classList.remove('active');
        }
      };
      el.addEventListener('pointerdown', (e) => run('pointerdown', e));
      el.addEventListener('pointerup', (e) => run('pointerup', e));
      el.addEventListener('pointercancel', (e) => run('pointercancel', e));
      el.addEventListener('lostpointercapture', (e) => run('lostpointercapture', e));
      el.addEventListener('pointerleave', (e) => run('pointerleave', e));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      // Same fallback as the movement pad: if capture was refused the release
      // lands on whatever is under the finger, not on the button.
      const away = (type) => (e) => {
        if (!state.down) return;
        if (e.pointerId !== state.pointerId) return;
        run(type, e);
      };
      window.addEventListener('pointerup', away('pointerup'));
      window.addEventListener('pointercancel', away('pointercancel'));
    };

    const toggle = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isFingerPointer(e.pointerType)) this.noteFinger();
        this.touch[prop] = !this.touch[prop];
        el.classList.toggle('active', this.touch[prop]);
      });
    };

    const tap = (id, action) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isFingerPointer(e.pointerType)) this.noteFinger();
        this.onAction(action);
      });
    };

    hold('btn-jump', (v) => {
      this.touch.jump = v;
      if (v) {
        haptic(8);
        const tap = jumpTap(performance.now(), this._lastJumpAt);
        this._lastJumpAt = tap.last;
        if (tap.fly) this.onAction('fly');
      }
    });
    hold('btn-break', (v) => {
      this.pressed.break = v;
      if (v) {
        haptic(8);
        this.onAction('break');
      }
    });
    hold('btn-place', (v) => {
      this.pressed.place = v;
      if (v) {
        haptic(8);
        this.onAction('place');
      }
    });
    toggle('btn-sprint', 'sprint');
    toggle('btn-sneak', 'sneak');
    tap('btn-view', 'view');
    tap('btn-inventory', 'inventory');
    tap('btn-debug', 'debug');
    tap('btn-pause', 'escape');
  }

  // ------------------------------------------------------------------ state

  /** Consume accumulated look deltas (mouse and/or touch). */
  consumeLook() {
    let dx = 0;
    let dy = 0;
    if (!this.enabled) {
      this.mouseDX = this.mouseDY = 0;
      this.touch.look.dx = this.touch.look.dy = 0;
      return { dx, dy, touch: false };
    }
    dx += this.mouseDX;
    dy += this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    const touch = this.lookMode === LOOK_TOUCH;
    if (touch) {
      dx += this.touch.look.dx;
      dy += this.touch.look.dy;
      this.touch.look.dx = 0;
      this.touch.look.dy = 0;
    }
    return { dx, dy, touch };
  }

  /**
   * Build the movement input packet for the player.
   * Combines keyboard state with touch joystick/buttons.
   */
  getMovementInput() {
    if (!this.enabled) {
      return { forward: 0, strafe: 0, jump: false, sprint: false, sneak: false };
    }
    const forwardKey = (this.keys.has('forward') ? 1 : 0) - (this.keys.has('back') ? 1 : 0);
    const strafeKey = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);

    if (!this.keys.has('forward')) this._doubleTap.forward.active = false;

    // The stick is read by the same pure function the tests pin, so a thumb
    // pushed all the way forward sprints — that is the only way to sprint on
    // a phone without taking a hand off the screen to hit the toggle.
    const j = this.touch.joy;
    const joy = j ? joystickFromDelta(j.x - j.ox, j.y - j.oy) : null;

    return combineMove(
      { forward: forwardKey, strafe: strafeKey },
      joy,
      {
        jump: this.keys.has('jump') || this.touch.jump,
        sprint: this.keys.has('sprint') || this.touch.sprint,
        doubleTapSprint: this._doubleTap.forward.active,
        sneak: this.keys.has('sneak') || this.touch.sneak,
      },
    );
  }

  /** Double-tap W starts a sprint that lasts until W is released. */
  _onForwardPress() {
    const now = performance.now();
    const state = this._doubleTap.forward;
    if (now - state.last < 280) state.active = true;
    state.last = now;
  }
}
