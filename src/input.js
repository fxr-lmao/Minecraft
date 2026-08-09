// Keyboard, mouse, and touch input.
//
// Desktop: pointer-lock mouse look, WASD, Ctrl/double-tap-W sprint.
// If pointer lock can't be acquired (embedded previews, iframes without
// the allow-pointer-lock flag, browsers that reject the request), a
// fallback mode kicks in: click-drag on the canvas to look, arrow keys
// steer.
// Touch devices (iPad etc.): virtual joystick (left thumb) + drag to look
// (right thumb) + on-screen jump / sprint / sneak buttons. The keyboard
// still works if one is attached.

import { clamp } from './utils.js';

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const ARROW_YAW_SPEED = 2.4; // rad/s
const ARROW_PITCH_SPEED = 1.8; // rad/s

const KEYMAP = {
  KeyW: 'forward',
  KeyA: 'left',
  KeyS: 'back',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'sneak',
  ShiftRight: 'sneak',
  ControlLeft: 'sprint',
  ControlRight: 'sprint',
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

    // pointer-lock fallback: click-drag look + arrow-key steering
    this.fallbackEnabled = false;
    this.dragging = false;
    this._dragLast = { x: 0, y: 0 };
    this.dragDX = 0;
    this.dragDY = 0;
    this.arrows = new Set();

    this.touchMode =
      typeof window !== 'undefined' &&
      'ontouchstart' in window &&
      navigator.maxTouchPoints > 0;
    this.touchStarted = false;

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

    // ---- keyboard ----
    window.addEventListener('keydown', (e) => {
      // arrow keys steer the camera in fallback mode
      if (ARROW_KEYS.has(e.code)) {
        if (this.fallbackEnabled && !this.locked) {
          e.preventDefault(); // keep the page from scrolling
          this.arrows.add(e.code);
        }
        return;
      }
      const action = KEYMAP[e.code];
      if (action) e.preventDefault();
      if (e.repeat) return;
      if (action === 'forward') this._onForwardPress();
      if (action) this.keys.add(action);
    });
    window.addEventListener('keyup', (e) => {
      if (ARROW_KEYS.has(e.code)) {
        this.arrows.delete(e.code);
        return;
      }
      const action = KEYMAP[e.code];
      if (action) this.keys.delete(action);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.arrows.clear();
      this.dragging = false;
    });

    // ---- pointer lock ----
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
    });

    // ---- mouse ----
    document.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        return;
      }
      if (this.dragging) {
        this.dragDX += e.clientX - this._dragLast.x;
        this.dragDY += e.clientY - this._dragLast.y;
        this._dragLast.x = e.clientX;
        this._dragLast.y = e.clientY;
      }
    });

    // ---- fallback drag look (pointer lock unavailable) ----
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.fallbackEnabled || this.locked) return;
      this.dragging = true;
      this._dragLast.x = e.clientX;
      this._dragLast.y = e.clientY;
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });

    // ---- touch ----
    if (this.touchMode) this._initTouch();
    this._bindButtons();
  }

  /** Game is running: pointer locked, fallback engaged, or started (touch). */
  get active() {
    return this.locked || this.fallbackEnabled || (this.touchMode && this.touchStarted);
  }

  /** Called from the start overlay. */
  start() {
    if (this.touchMode) this.touchStarted = true;
    else this.requestLock();
  }

  requestLock() {
    if (typeof this.canvas.requestPointerLock !== 'function') return;
    let p;
    try {
      p = this.canvas.requestPointerLock();
    } catch {
      return; // e.g. document not focused; the fallback path will engage
    }
    // Chrome rejects with a promise if called too soon after Esc; ignore.
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  /** Enable mouse-look fallback: click-drag to look, arrow keys steer. */
  enableFallback() {
    this.fallbackEnabled = true;
  }

  /** Leave fallback mode (back to the start overlay). */
  endFallback() {
    this.fallbackEnabled = false;
    this.dragging = false;
    this.arrows.clear();
    this.keys.clear();
  }

  /**
   * Consume accumulated look deltas (mouse lock, drag, touch).
   * Returns { dx, dy, arrowDX, arrowDY } — `dx/dy` are raw pixel deltas the
   * caller scales by a sensitivity; `arrowDX/arrowDY` are already radians
   * in the same sign convention (positive = look right / look down).
   */
  consumeLook(dt = 0) {
    let dx = 0;
    let dy = 0;
    let arrowDX = 0;
    let arrowDY = 0;
    if (this.locked) {
      dx += this.mouseDX;
      dy += this.mouseDY;
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    if (this.touchMode && this.touchStarted) {
      dx += this.touch.look.dx;
      dy += this.touch.look.dy;
      this.touch.look.dx = 0;
      this.touch.look.dy = 0;
    }
    if (this.fallbackEnabled && !this.locked) {
      dx += this.dragDX;
      dy += this.dragDY;
      this.dragDX = 0;
      this.dragDY = 0;
      if (dt > 0) {
        arrowDX =
          ((this.arrows.has('ArrowRight') ? 1 : 0) - (this.arrows.has('ArrowLeft') ? 1 : 0)) *
          ARROW_YAW_SPEED * dt;
        arrowDY =
          ((this.arrows.has('ArrowDown') ? 1 : 0) - (this.arrows.has('ArrowUp') ? 1 : 0)) *
          ARROW_PITCH_SPEED * dt;
      }
    }
    return { dx, dy, arrowDX, arrowDY };
  }

  /**
   * Build the movement input packet for the player.
   * Combines keyboard state with touch joystick/buttons.
   */
  getMovementInput() {
    const forwardKey = (this.keys.has('forward') ? 1 : 0) - (this.keys.has('back') ? 1 : 0);
    const strafeKey = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);

    if (!this.keys.has('forward')) this._doubleTap.forward.active = false;

    let forward = forwardKey;
    let strafe = strafeKey;

    // touch joystick
    if (this.touchMode && this.touch.joy) {
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
      jump: this.keys.has('jump') || (this.touchMode && this.touch.jump),
      sprint:
        this.keys.has('sprint') ||
        this._doubleTap.forward.active ||
        (this.touchMode && this.touch.sprint),
      sneak: this.keys.has('sneak') || (this.touchMode && this.touch.sneak),
    };
  }

  /** Double-tap W starts a sprint that lasts until W is released. */
  _onForwardPress() {
    const now = performance.now();
    const state = this._doubleTap.forward;
    if (now - state.last < 280) state.active = true;
    state.last = now;
  }

  // ---------------------------------------------------------------- touch

  _initTouch() {
    const cv = this.canvas;
    cv.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (!this.touchStarted) return;
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
    this._joyBase.classList.remove('visible');
  }

  _bindButtons() {
    const bind = (id, prop, toggle) => {
      const el = document.getElementById(id);
      if (!el) return;
      const set = (v) => {
        this.touch[prop] = toggle ? !this.touch[prop] : v;
        el.classList.toggle('active', this.touch[prop]);
      };
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        set(true);
      });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!toggle) set(false);
      });
      el.addEventListener('touchcancel', () => {
        if (!toggle) set(false);
      });
      // mouse fallback (desktop testing)
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        set(true);
      });
      el.addEventListener('mouseup', () => {
        if (!toggle) set(false);
      });
    };
    bind('btn-jump', 'jump', false);
    bind('btn-sprint', 'sprint', true);
    bind('btn-sneak', 'sneak', true);
  }
}
