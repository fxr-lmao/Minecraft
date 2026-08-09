// HUD: crosshair (CSS), hotbar with block icons, status messages,
// and the F3-style debug screen with position / speed / FPS.

import { BLOCK_DEFS, getBlockAssets } from './textures.js';
import { WORLD_SIZE } from './constants.js';

const CARDINALS = ['South (+Z)', 'West (-X)', 'North (-Z)', 'East (+X)'];
const BLOCK_NAMES = new Map(BLOCK_DEFS.map((b) => [b.id, b.name]));

export class Hud {
  constructor() {
    this.hotbarEl = document.getElementById('hotbar');
    this.debugEl = document.getElementById('debug');
    this.statusEl = document.getElementById('status');
    this.overlayEl = document.getElementById('overlay');

    this.selectedSlot = 0;
    this.debugVisible = false;
    this._statusTimer = null;

    this._buildHotbar();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggleDebug();
      }
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        this.selectSlot(num - 1);
        this.showStatus(`Selected: ${BLOCK_DEFS[this.selectedSlot].name}`);
      }
    });
    window.addEventListener('wheel', (e) => {
      if (e.deltaY > 0) this.selectSlot((this.selectedSlot + 1) % 9);
      else if (e.deltaY < 0) this.selectSlot((this.selectedSlot + 8) % 9);
    }, { passive: true });
  }

  _buildHotbar() {
    this.hotbarEl.innerHTML = '';
    BLOCK_DEFS.forEach((def, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === 0 ? ' selected' : '');
      const img = document.createElement('img');
      img.src = getBlockAssets(def).iconUrl;
      img.alt = def.name;
      img.title = def.name;
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = i + 1;
      slot.appendChild(img);
      slot.appendChild(key);
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectSlot(i);
        this.showStatus(`Selected: ${def.name}`);
      });
      this.hotbarEl.appendChild(slot);
    });
  }

  selectSlot(i) {
    this.selectedSlot = i;
    const slots = this.hotbarEl.children;
    for (let k = 0; k < slots.length; k++) {
      slots[k].classList.toggle('selected', k === i);
    }
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle('visible', this.debugVisible);
  }

  /** Transient center message (sprint toggle, block select, ...). */
  showStatus(text) {
    this.statusEl.textContent = text;
    this.statusEl.classList.add('show');
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      this.statusEl.classList.remove('show');
    }, 1500);
  }

  showOverlay() {
    this.overlayEl.classList.remove('hidden');
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }

  updateDebug(info) {
    if (!this.debugVisible) return;
    const dir = info.yawDeg % 360;
    const idx = Math.round((dir + 360) % 360 / 90) % 4;
    const lines = [
      `Minecraft [browser clone] alpha 0.3`,
      ``,
      `XYZ: ${info.pos.x.toFixed(3)} / ${info.pos.y.toFixed(3)} / ${info.pos.z.toFixed(3)}`,
      `Block: ${BLOCK_NAMES.get(info.blockUnder) ?? '?'}`,
      `Chunk: ${Math.floor(info.pos.x / 16)} ${Math.floor(info.pos.z / 16)}`,
      `Facing: ${CARDINALS[idx]} (${((dir + 360) % 360).toFixed(1)} / ${info.pitchDeg.toFixed(1)})`,
      `Camera: ${info.cameraName}`,
      ``,
      `Speed: ${info.speed.toFixed(2)} m/s  ${info.mode}`,
      `On ground: ${info.onGround}`,
      ``,
      `FPS: ${info.fps}  (${info.frameMs.toFixed(1)} ms · target ${info.fpsTarget} · display ${info.displayHz}Hz)`,
      `Pixel scale: ${info.pixelScale.toFixed(2)}x  ·  Touch: ${info.touch ? 'on' : 'off'}`,
      `World: ${WORLD_SIZE}x${WORLD_SIZE} flat`,
    ];
    this.debugEl.textContent = lines.join('\n');
  }
}
