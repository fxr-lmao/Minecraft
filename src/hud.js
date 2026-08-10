// HUD: transient status messages, the F3-style debug screen, and the
// title/pause overlay. (The hotbar and inventory live in inventory-ui.js;
// key bindings live in input.js — this file only draws.)

import { blockName } from './textures.js';
import { WORLD_SIZE, WORLD_LAYERS } from './constants.js';

const CARDINALS = ['South (+Z)', 'West (-X)', 'North (-Z)', 'East (+X)'];

export class Hud {
  constructor() {
    this.debugEl = document.getElementById('debug');
    this.statusEl = document.getElementById('status');
    this.overlayEl = document.getElementById('overlay');
    this.titleEl = document.getElementById('overlay-title');
    this.hintEl = document.getElementById('overlay-hint');
    this.crosshairEl = document.getElementById('crosshair');

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
    }, 1500);
  }

  get overlayVisible() {
    return !this.overlayEl.classList.contains('hidden');
  }

  /** `mode` is 'title' on first load and 'paused' after releasing the mouse. */
  showOverlay(mode = 'paused', hint = '') {
    this.titleEl.textContent = mode === 'title' ? 'MINECRAFT' : 'PAUSED';
    this.hintEl.textContent = hint;
    this.hintEl.classList.toggle('hidden', !hint);
    this.overlayEl.classList.remove('hidden');
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }

  setCrosshairVisible(visible) {
    this.crosshairEl.classList.toggle('hidden', !visible);
  }

  updateDebug(info) {
    if (!this.debugVisible) return;
    const dir = info.yawDeg % 360;
    const idx = Math.round((dir + 360) % 360 / 90) % 4;
    const target = info.target
      ? `${blockName(info.targetId)} @ ${info.target.x} ${info.target.y} ${info.target.z}`
      : 'none';
    const lines = [
      `Minecraft [browser clone] alpha 0.3`,
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
      `World: ${WORLD_SIZE}x${WORLD_SIZE}, height ${WORLD_LAYERS}`,
    ];
    this.debugEl.textContent = lines.join('\n');
  }
}
