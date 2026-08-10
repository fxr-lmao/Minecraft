// HUD: transient status messages, the F3-style debug screen, and the
// title/pause menu (settings, fullscreen, reset). The hotbar and inventory
// live in inventory-ui.js; key bindings live in input.js — this file draws
// and reports, it doesn't decide anything.

import { blockName } from './textures.js';
import { WORLD_SIZE, WORLD_LAYERS } from './constants.js';
import { LOOK_FREE, LOOK_TOUCH } from './input.js';

const CARDINALS = ['South (+Z)', 'West (-X)', 'North (-Z)', 'East (+X)'];

export class Hud {
  constructor() {
    this.debugEl = document.getElementById('debug');
    this.statusEl = document.getElementById('status');
    this.overlayEl = document.getElementById('overlay');
    this.titleEl = document.getElementById('overlay-title');
    this.subtitleEl = document.getElementById('overlay-subtitle');
    this.hintEl = document.getElementById('overlay-hint');
    this.crosshairEl = document.getElementById('crosshair');
    this.resumeEl = document.getElementById('btn-resume');
    this.relockEl = document.getElementById('btn-relock');
    this.fullscreenEl = document.getElementById('btn-fullscreen');

    this.debugVisible = false;
    this._statusTimer = null;
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle('visible', this.debugVisible);
  }

  /** Transient centre message (view change, sprinting, ...). */
  showStatus(text) {
    this.statusEl.textContent = text;
    this.statusEl.classList.add('show');
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      this.statusEl.classList.remove('show');
    }, 1800);
  }

  get overlayVisible() {
    return !this.overlayEl.classList.contains('hidden');
  }

  showTitle(input, restored) {
    this.titleEl.textContent = 'MINECRAFT';
    this.subtitleEl.textContent = restored
      ? 'browser clone · alpha 0.4 · world restored'
      : 'browser clone · alpha 0.4';
    this.resumeEl.textContent = 'Play';
    this.overlayEl.classList.remove('hidden');
    this.refreshLookMode(input);
  }

  showPause(input) {
    this.titleEl.textContent = 'PAUSED';
    this.resumeEl.textContent = 'Resume';
    this.overlayEl.classList.remove('hidden');
    this.refreshLookMode(input);
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }

  /**
   * Explain how the mouse is being read. This is the part players actually
   * need: when pointer lock is unavailable (iPadOS Safari) the game still
   * works, but only if you know that the cursor drives the view and that the
   * screen edges keep turning.
   */
  refreshLookMode(input) {
    let hint = '';
    if (input.lookMode === LOOK_FREE) {
      hint =
        'Your browser would not lock the mouse, so the game is using free look: ' +
        'moving the cursor turns the view, and holding it near a screen edge keeps turning. ' +
        'Fullscreen often lets the lock work — try it, then "Lock the mouse".';
    } else if (input.lookMode === LOOK_TOUCH) {
      hint = 'Touch controls: left thumb steers, right thumb looks. Attach a keyboard or trackpad for mouse look.';
    }
    this.hintEl.textContent = hint;
    this.hintEl.classList.toggle('hidden', !hint);
    this.relockEl.classList.toggle('hidden', input.lookMode !== LOOK_FREE);
    this.fullscreenEl.textContent = input.isFullscreen ? 'Leave fullscreen' : 'Fullscreen';
  }

  setCrosshairVisible(visible) {
    this.crosshairEl.classList.toggle('hidden', !visible);
  }

  /** Populate the settings controls and report changes back to the game. */
  initSettings(settings, limits) {
    this._settingInputs = [
      ['sensitivity', 'set-sens', 'out-sens', (v) => `${Number(v).toFixed(2)}×`],
      ['touchSensitivity', 'set-touch', 'out-touch', (v) => `${Number(v).toFixed(2)}×`],
      ['fov', 'set-fov', 'out-fov', (v) => `${Math.round(v)}°`],
    ];
    for (const [key, inputId, outId, fmt] of this._settingInputs) {
      const el = document.getElementById(inputId);
      const out = document.getElementById(outId);
      if (!el) continue;
      const lim = limits[key];
      if (lim) {
        el.min = lim.min;
        el.max = lim.max;
        el.step = lim.step;
      }
      el.value = settings[key];
      out.textContent = fmt(settings[key]);
      el.addEventListener('input', () => {
        out.textContent = fmt(el.value);
        this._onSetting?.(key, Number(el.value));
      });
    }
    const invert = document.getElementById('set-invert');
    if (invert) {
      invert.checked = settings.invertY;
      invert.addEventListener('change', () => this._onSetting?.('invertY', invert.checked));
    }
  }

  bindMenu({ onResume, onFullscreen, onRetryLock, onReset, onSetting }) {
    this._onSetting = onSetting;
    this.resumeEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onResume(e.pointerType);
    });
    this.fullscreenEl.addEventListener('click', (e) => {
      e.stopPropagation();
      onFullscreen();
    });
    this.relockEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRetryLock();
    });
    document.getElementById('btn-reset').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete your saved world and start over?')) onReset();
    });
  }

  updateDebug(info) {
    if (!this.debugVisible) return;
    const dir = info.yawDeg % 360;
    const idx = Math.round((dir + 360) % 360 / 90) % 4;
    const target = info.target
      ? `${blockName(info.targetId)} @ ${info.target.x} ${info.target.y} ${info.target.z}`
      : 'none';
    const lines = [
      `Minecraft [browser clone] alpha 0.4`,
      ``,
      `XYZ: ${info.pos.x.toFixed(3)} / ${info.pos.y.toFixed(3)} / ${info.pos.z.toFixed(3)}`,
      `Block: ${blockName(info.blockUnder)}`,
      `Chunk: ${Math.floor(info.pos.x / 16)} ${Math.floor(info.pos.z / 16)}`,
      `Facing: ${CARDINALS[idx]} (${((dir + 360) % 360).toFixed(1)} / ${info.pitchDeg.toFixed(1)})`,
      `Looking at: ${target}`,
      ``,
      `Speed: ${info.speed.toFixed(2)} m/s  ${info.mode}`,
      `On ground: ${info.onGround}`,
      `View: ${info.view}`,
      ``,
      `FPS: ${info.fps}  (${info.frameMs.toFixed(1)} ms)`,
      `Pixel scale: ${info.pixelScale.toFixed(2)}x  ·  Input: ${info.inputMode}`,
      `World: ${WORLD_SIZE}x${WORLD_SIZE}, height ${WORLD_LAYERS}, ${info.edits} edits saved`,
    ];
    this.debugEl.textContent = lines.join('\n');
  }
}
