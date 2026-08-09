// Keyboard + mouse input: key state, pointer lock mouse look,
// double-tap-W sprint detection (like Minecraft).

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

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;

    this._doubleTap = { forward: { last: 0, active: false } };

    window.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (action) e.preventDefault();
      if (e.repeat) return;
      if (action === 'forward') this._onForwardPress();
      if (action) this.keys.add(action);
    });
    window.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (action) this.keys.delete(action);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  /** Double-tap W starts a sprint that lasts until W is released. */
  _onForwardPress() {
    const now = performance.now();
    const state = this._doubleTap.forward;
    if (now - state.last < 280) {
      state.active = true;
    }
    state.last = now;
    // mark active again on each fresh press while still running? No:
    // double-tap sprint ends when W is released.
  }

  requestLock() {
    const p = this.canvas.requestPointerLock();
    // Chrome rejects with a promise if called too soon after Esc; ignore.
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  /** Consume accumulated mouse deltas since last call. */
  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  /**
   * Build the movement input packet for the player.
   * sprint: hold Ctrl, or double-tap W (active until W released).
   */
  getMovementInput() {
    const forward = (this.keys.has('forward') ? 1 : 0) - (this.keys.has('back') ? 1 : 0);
    const strafe = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);

    if (!this.keys.has('forward')) {
      this._doubleTap.forward.active = false;
    }

    const sprintHeld = this.keys.has('sprint');
    const sprint = sprintHeld || this._doubleTap.forward.active;

    return {
      forward,
      strafe,
      jump: this.keys.has('jump'),
      sprint,
      sneak: this.keys.has('sneak'),
    };
  }
}
