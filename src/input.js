// Keyboard, mouse/trackpad, and touch input.
//
// The tricky device is an iPad with the Magic Keyboard: it reports touch
// support *and* has a trackpad and a keyboard. The old code keyed everything
// off `'ontouchstart' in window`, so it locked itself into touch mode and
// never requested pointer lock — the trackpad could never grab the mouse.
//
// Now the input mode follows whatever the player actually used:
//   - starting with a click (pointerType mouse) or a key  -> pointer lock,
//     Esc releases it, clicking the pause screen re-locks
//   - starting with a finger                              -> on-screen controls
//   - either can take over at any time; the touch UI shows and hides itself
// Pointer lock failures (unsupported browser) fall back to touch controls
// instead of leaving the player stuck on the title screen.

import { clamp } from './utils.js';

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
// F3/F5 do not exist on the iPad Magic Keyboard, so G and V are the primary
// bindings and the function keys are aliases for desktop muscle memory.
const ACTION_KEYS = {
  KeyE: 'inventory',
  KeyI: 'inventory',
  KeyV: 'view',
  F5: 'view',
  KeyG: 'debug',
  F3: 'debug',
  Escape: 'escape',
};

const JOY_RADIUS = 55; // px of finger travel for full deflection
const JOY_DEADZONE = 8; // px before the stick responds

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.touchStarted = false;

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

    this.touch = {
      joy: null, // { id, ox, oy, x, y }
      look: { id: null, px: 0, py: 0, dx: 0, dy: 0 },
      jump: false,
      sprint: false,
      sneak: false,
    };

    this._doubleTap = { forward: { last: 0, active: false } };
    this._joyBase = document.getElementById('joy-base');
    this._joyKnob = document.getElementById('joy-knob');

    this._initKeyboard();
    this._initPointer();
    this._initTouch();
    this._bindButtons();
  }

  /** Game is running: pointer locked (mouse) or a touch session started. */
  get active() {
    return this.locked || this.touchStarted;
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Start playing. `source` is 'touch' for a finger, anything else for a
   * mouse/trackpad/keyboard (which grabs the pointer).
   */
  start(source) {
    if (source === 'touch') {
      this.usingTouch = true;
      this.touchStarted = true;
      return;
    }
    this.usingTouch = false;
    this.requestLock();
  }

  requestLock() {
    if (!this.pointerLockSupported) {
      this._lockFailed();
      return;
    }
    try {
      const p = this.canvas.requestPointerLock();
      // Chrome rejects with a promise if called too soon after Esc.
      if (p && typeof p.catch === 'function') p.catch(() => this._lockFailed());
    } catch {
      this._lockFailed();
    }
  }

  /** Release the mouse (Esc) or end a touch session — the game pauses. */
  release() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
    this.touchStarted = false;
    this.keys.clear();
    this.pressed.break = false;
    this.pressed.place = false;
  }

  /** Release the pointer without ending the session (opening a menu). */
  releasePointerOnly() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  _lockFailed() {
    // No pointer lock available: if this device can be played by touch, do
    // that instead of leaving the player on a dead title screen.
    if (this.hasTouch) {
      this.usingTouch = true;
      this.touchStarted = true;
    }
    this.onAction('lockfailed');
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
        this.onAction(action);
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
      if (!this.locked) {
        this.keys.clear();
        this.pressed.break = false;
        this.pressed.place = false;
      }
    });
    document.addEventListener('pointerlockerror', () => this._lockFailed());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.usingTouch = false;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    // Clicking with a real mouse/trackpad during a touch session grabs the
    // pointer: on an iPad you can tap to start and then click the Magic
    // Keyboard's trackpad to switch to mouse look.
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.usingTouch = false;
      if (!this.locked && this.enabled && this.active) this.requestLock();
    });

    // Break / place with the mouse while the pointer is locked.
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked || !this.enabled) return;
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
      this.onAction('scroll', e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
  }

  // ------------------------------------------------------------------ touch

  _initTouch() {
    if (!this.hasTouch) return;
    const cv = this.canvas;

    cv.addEventListener(
      'touchstart',
      (e) => {
        this.usingTouch = true;
        e.preventDefault();
        if (!this.touchStarted || !this.enabled) return;
        for (const t of e.changedTouches) {
          if (t.clientX < window.innerWidth * 0.45 && !this.touch.joy) {
            this.touch.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
            this._showJoystick(t.clientX, t.clientY);
          } else if (this.touch.look.id === null) {
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
          if (j && t.identifier === j.id) {
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
        if (this.touch.joy && t.identifier === this.touch.joy.id) {
          this.touch.joy = null;
          this._hideJoystick();
        }
        if (this.touch.look.id === t.identifier) this.touch.look.id = null;
      }
    };
    cv.addEventListener('touchend', endTouch);
    cv.addEventListener('touchcancel', endTouch);
  }

  _showJoystick(x, y) {
    this._joyBase.style.left = `${x}px`;
    this._joyBase.style.top = `${y}px`;
    this._joyBase.classList.add('visible');
    this._updateJoystick(0, 0);
  }

  _updateJoystick(dx, dy) {
    const len = Math.hypot(dx, dy);
    const c = len > 44 ? 44 / len : 1; // knob travel cap (base is 140px)
    this._joyKnob.style.left = `calc(50% + ${(dx * c).toFixed(1)}px)`;
    this._joyKnob.style.top = `calc(50% + ${(dy * c).toFixed(1)}px)`;
  }

  _hideJoystick() {
    this._joyBase?.classList.remove('visible');
  }

  /** On-screen buttons: held (jump/break/place), toggled (sprint/sneak) or one-shot. */
  _bindButtons() {
    const hold = (id, apply) => {
      const el = document.getElementById(id);
      if (!el) return;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.usingTouch = e.pointerType !== 'mouse';
        apply(true);
        el.classList.add('active');
      };
      const up = (e) => {
        e?.preventDefault();
        apply(false);
        el.classList.remove('active');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };

    const toggle = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
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
        this.onAction(action);
      });
    };

    hold('btn-jump', (v) => { this.touch.jump = v; });
    hold('btn-break', (v) => {
      this.pressed.break = v;
      if (v) this.onAction('break');
    });
    hold('btn-place', (v) => {
      this.pressed.place = v;
      if (v) this.onAction('place');
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
      return { dx, dy };
    }
    if (this.locked) {
      dx += this.mouseDX;
      dy += this.mouseDY;
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    if (this.touchStarted) {
      dx += this.touch.look.dx;
      dy += this.touch.look.dy;
      this.touch.look.dx = 0;
      this.touch.look.dy = 0;
    }
    return { dx, dy, touch: !this.locked };
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

    let forward = forwardKey;
    let strafe = strafeKey;

    // touch joystick
    if (this.touch.joy) {
      const j = this.touch.joy;
      let dx = j.x - j.ox;
      let dy = j.y - j.oy;
      const len = Math.hypot(dx, dy);
      if (len < JOY_DEADZONE) {
        dx = 0;
        dy = 0;
      } else {
        const scale = Math.min(1, (len - JOY_DEADZONE) / (JOY_RADIUS - JOY_DEADZONE));
        dx = (dx / len) * scale;
        dy = (dy / len) * scale;
      }
      forward += -dy; // thumb up = forward
      strafe += dx; // thumb right = strafe right
    }

    forward = clamp(forward, -1, 1);
    strafe = clamp(strafe, -1, 1);

    return {
      forward,
      strafe,
      jump: this.keys.has('jump') || this.touch.jump,
      sprint: this.keys.has('sprint') || this._doubleTap.forward.active || this.touch.sprint,
      sneak: this.keys.has('sneak') || this.touch.sneak,
    };
  }

  /** Double-tap W starts a sprint that lasts until W is released. */
  _onForwardPress() {
    const now = performance.now();
    const state = this._doubleTap.forward;
    if (now - state.last < 280) state.active = true;
    state.last = now;
  }
}
