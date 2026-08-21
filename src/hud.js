// HUD: transient status messages, the F3-style debug screen, and the
// title/pause menu (settings, fullscreen, reset). The hotbar and inventory
// live in inventory-ui.js; key bindings live in input.js — this file draws
// and reports, it doesn't decide anything.

import {
  blockName, heartUrl, heartEmptyUrl, bubbleUrl,
  drumstickUrl, drumstickEmptyUrl, armourUrl, armourEmptyUrl,
} from './textures.js';
import {
  CHUNK_SIZE, WORLD_MIN_Y, WORLD_MAX_Y, MAX_HEALTH, MAX_AIR,
} from './constants.js';
import { MAX_FOOD } from './hunger.js';
import { LOOK_FREE, LOOK_TOUCH } from './input.js';

const CARDINALS = ['South (+Z)', 'West (-X)', 'North (-Z)', 'East (+X)'];

/** Pickup feed: how long a line sits, how long it fades, how many at once. */
const PICKUP_HOLD_MS = 2600;
const PICKUP_FADE_MS = 400;
const PICKUP_MAX = 5;
/** Two pickups of the same thing inside this window are one counting line. */
const PICKUP_MERGE_MS = 4000;

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

    this.vitalsEl = document.getElementById('vitals');
    this.healthEl = document.getElementById('health');
    this.airEl = document.getElementById('air');
    this.hungerEl = document.getElementById('hunger');
    this.armourEl = document.getElementById('armour');
    this.modeEl = document.getElementById('mode-badge');
    this.clockEl = document.getElementById('clock');
    this.xpWrap = document.getElementById('xp-wrap');
    this.xpBar = document.getElementById('xp-bar');
    this.xpLevel = document.getElementById('xp-level');
    this.eatingEl = document.getElementById('eating');
    this.eatingBarEl = document.getElementById('eating-bar');

    this.pickupEl = document.getElementById('pickups');

    this.debugVisible = false;
    this._statusTimer = null;
    /** Live rows in the pickup feed, oldest first. */
    this._pickups = [];
    this._buildVitals();
  }

  /**
   * Ten hearts and ten bubbles, built once.
   *
   * Minecraft's twenty hit points are drawn as ten hearts, so each pip is two
   * points and half of one is a real state rather than a rounding: the last
   * half heart is the difference between a swim you can just make and one you
   * cannot.
   */
  _buildVitals() {
    if (!this.healthEl) return;
    const empty = heartEmptyUrl();
    const full = heartUrl();
    const bubble = bubbleUrl();
    const drumEmpty = drumstickEmptyUrl();
    const drumFull = drumstickUrl();
    const armourEmpty = armourEmptyUrl();
    const armourFull = armourUrl();
    this.hearts = [];
    this.bubbles = [];
    this.drumsticks = [];
    this.armours = [];
    // Armour pips sit above the hearts and only appear while some is worn —
    // a hidden bar when bare, exactly as Minecraft hides it.
    for (let i = 0; i < 10; i++) {
      const socket = document.createElement('i');
      socket.style.backgroundImage = `url(${armourEmpty})`;
      const fill = document.createElement('b');
      fill.style.backgroundImage = `url(${armourFull})`;
      socket.appendChild(fill);
      this.armourEl.appendChild(socket);
      this.armours.push(fill);
    }
    for (let i = 0; i < MAX_HEALTH / 2; i++) {
      const socket = document.createElement('i');
      socket.style.backgroundImage = `url(${empty})`;
      const fill = document.createElement('b');
      fill.style.backgroundImage = `url(${full})`;
      socket.appendChild(fill);
      this.healthEl.appendChild(socket);
      this.hearts.push(fill);
    }
    for (let i = 0; i < 10; i++) {
      const pip = document.createElement('i');
      const fill = document.createElement('b');
      fill.style.backgroundImage = `url(${bubble})`;
      pip.appendChild(fill);
      this.airEl.appendChild(pip);
      this.bubbles.push(fill);
    }
    // Ten drumsticks, same socket-and-fill construction as the hearts, so
    // half a drumstick is a clipped sprite rather than a second drawing.
    for (let i = 0; i < MAX_FOOD / 2; i++) {
      const socket = document.createElement('i');
      socket.style.backgroundImage = `url(${drumEmpty})`;
      const fill = document.createElement('b');
      fill.style.backgroundImage = `url(${drumFull})`;
      socket.appendChild(fill);
      this.hungerEl.appendChild(socket);
      this.drumsticks.push(fill);
    }
  }

  /**
   * Draw the health, the breath and the hunger.
   *
   * The air row is only there when it is telling you something — Minecraft
   * hides a full bar too, and a row of bubbles over the hotbar while you are
   * walking across a field is just furniture. The drumsticks are the same
   * socket-and-fill construction as the hearts, and round up exactly the same
   * way: a sliver of food still shows as half a drumstick.
   */
  setVitals(health, air, food, armour, visible = true) {
    if (!this.hearts) return;
    this.vitalsEl.classList.toggle('hidden', !visible);
    if (!visible) return;
    for (let i = 0; i < this.hearts.length; i++) {
      // Two hit points a heart, and the half is the sprite cut down the
      // middle rather than a second picture of one.
      //
      // Health here is a continuous number — drowning takes it a hundred and
      // twentieth of a hit point at a time — but a heart is empty, half or
      // whole and nothing in between, so it rounds *up*: a sliver of health
      // still shows as half a heart, and an empty socket always means empty.
      const points = Math.max(0, Math.min(2, health - i * 2));
      this.hearts[i].style.width = `${Math.ceil(points) * 50}%`;
    }
    const bubbles = Math.max(0, Math.ceil((air / MAX_AIR) * this.bubbles.length));
    for (let i = 0; i < this.bubbles.length; i++) {
      this.bubbles[i].style.width = i < bubbles ? '100%' : '0';
    }
    this.airEl.style.visibility = air >= MAX_AIR ? 'hidden' : 'visible';
    // Two shanks a drumstick, same rounding-up as the hearts.
    for (let i = 0; i < this.drumsticks.length; i++) {
      const points = Math.max(0, Math.min(2, food - i * 2));
      this.drumsticks[i].style.width = `${Math.ceil(points) * 50}%`;
    }
    // Armour, one pip per point, hidden entirely while none is worn.
    for (let i = 0; i < this.armours.length; i++) {
      this.armours[i].style.width = i < Math.max(0, armour) ? '100%' : '0';
    }
    this.armourEl.style.visibility = armour > 0 ? 'visible' : 'hidden';
  }

  /** The screen that says what got you, and offers to put you back. */
  showDeath(cause) {
    this.titleEl.textContent = 'YOU DIED';
    this.subtitleEl.textContent = cause ? `You ${cause}` : '';
    this.resumeEl.textContent = 'Respawn';
    this.overlayEl.classList.remove('hidden');
    this.hintEl.textContent = '';
    this.hintEl.classList.add('hidden');
    this.relockEl.classList.add('hidden');
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle('visible', this.debugVisible);
  }

  /**
   * Mode badge: shows CREATIVE in creative mode (with a flight indicator),
   * hides itself in survival. Minecraft does not draw a mode badge, but this
   * game has no F3-only mode line players can be assumed to read.
   */
  refreshMode(gameMode) {
    if (!this.modeEl) return;
    if (!gameMode.isCreative) {
      this.modeEl.classList.add('hidden');
      return;
    }
    this.modeEl.textContent = `CREATIVE${gameMode.flying ? ' · FLYING' : ''}`;
    this.modeEl.classList.remove('hidden');
  }

  /**
   * Experience: the green bar above the hotbar and the level number. The
   * bar is hidden at level 0 with an empty bar, like Minecraft's.
   */
  setXp(fraction, level) {
    if (!this.xpBar) return;
    this.xpLevel.textContent = String(level);
    this.xpBar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
    this.xpWrap.classList.toggle('hidden', level === 0 && fraction === 0);
  }

  /**
   * The eating meter. `fraction` is 0..1 of the mouthful already eaten, or
   * 0 to hide the bar entirely. It appears only while a meal is in progress,
   * because a bar that reads "you are eating" when you are not is furniture.
   */
  setEating(fraction) {
    if (!this.eatingEl) return;
    if (fraction > 0) {
      this.eatingEl.classList.remove('hidden');
      this.eatingBarEl.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
    } else {
      this.eatingEl.classList.add('hidden');
    }
  }

  /** In-game clock, top-right, only drawn once it has something to say. */
  setClock(timeStr) {
    if (!this.clockEl) return;
    if (!timeStr) {
      this.clockEl.classList.add('hidden');
      return;
    }
    this.clockEl.textContent = timeStr;
    this.clockEl.classList.remove('hidden');
  }

  /**
   * The pickup feed: the little stack of "+3 Cobblestone" lines that rises
   * above the hotbar as you walk over things.
   *
   * Minecraft merges repeats rather than printing a new line per item, and
   * that is not cosmetic — mining a seam of gravel produces a drop a second,
   * and thirty separate lines would scroll the screen. A repeat of something
   * already on the feed bumps its count and restarts its clock instead, so
   * digging a stack of cobblestone shows one line counting up.
   *
   * The rows are pooled and reused because this is called from the collect
   * path, which can fire several times in a frame when a pile is picked up.
   */
  showPickup(id, count) {
    if (!this.pickupEl || count <= 0) return;
    const name = blockName(id);
    const now = performance.now();

    const existing = this._pickups.find((p) => p.id === id && now - p.at < PICKUP_MERGE_MS);
    if (existing) {
      existing.count += count;
      existing.at = now;
      existing.el.textContent = `+${existing.count} ${name}`;
      // Restart the fade: re-adding the class on the same frame does nothing,
      // so it is dropped and forced to reflow first.
      existing.el.classList.remove('show');
      void existing.el.offsetWidth;
      existing.el.classList.add('show');
      return;
    }

    const el = document.createElement('div');
    el.className = 'pickup-line';
    el.textContent = `+${count} ${name}`;
    this.pickupEl.appendChild(el);
    void el.offsetWidth;
    el.classList.add('show');

    const entry = { id, count, at: now, el };
    this._pickups.push(entry);

    // Oldest first, and never more than a handful on screen at once.
    while (this._pickups.length > PICKUP_MAX) {
      const old = this._pickups.shift();
      old.el.remove();
    }
  }

  /**
   * Retire pickup lines that have had their time. Driven from the frame loop
   * rather than a timer per line, so a hundred pickups do not leave a hundred
   * pending timeouts behind.
   */
  updatePickups() {
    if (!this._pickups.length) return;
    const now = performance.now();
    for (let i = this._pickups.length - 1; i >= 0; i--) {
      const p = this._pickups[i];
      const age = now - p.at;
      if (age > PICKUP_HOLD_MS + PICKUP_FADE_MS) {
        p.el.remove();
        this._pickups.splice(i, 1);
      } else if (age > PICKUP_HOLD_MS) {
        p.el.classList.remove('show');
      }
    }
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
      ? 'browser clone · alpha 0.6 · world restored'
      : 'browser clone · alpha 0.6';
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
      ['renderDistance', 'set-distance', 'out-distance', (v) => {
        const n = Math.round(v);
        // Chunk data stays flat however far you look, but geometry does not:
        // it is roughly 0.12 MB per chunk, and the chunk count grows with the
        // square of the distance.
        const mb = Math.round(Math.PI * n * n * 0.12);
        const warn = n >= 20 ? '  ⚠ heavy' : '';
        return `${n} chunks · ${n * CHUNK_SIZE} blocks · ~${mb} MB${warn}`;
      }],
      // Each level is another render of the world, so the label says so.
      ['waterQuality', 'set-water', 'out-water', (v) => [
        'Fast — flat, one pass',
        'Fancy — depth, refraction, foam',
        'Reflections — the world in the water',
      ][Math.round(v)] ?? ''],
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
    for (const [key, id] of [['invertY', 'set-invert'], ['autoJump', 'set-autojump']]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.checked = settings[key];
      el.addEventListener('change', () => this._onSetting?.(key, el.checked));
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
      `Minecraft [browser clone] alpha 0.9`,
      ``,
      `XYZ: ${info.pos.x.toFixed(3)} / ${info.pos.y.toFixed(3)} / ${info.pos.z.toFixed(3)}`,
      `Block: ${blockName(info.blockUnder)}  ·  Biome: ${info.biome}  ·  Temp: ${info.temperature.toFixed(2)}  ·  ${info.weather}`,
      `Time: ${info.clock ?? '—'}  ·  Mode: ${info.gameMode ?? 'Survival'}`,
      `Chunk: ${info.chunk}  (${CHUNK_SIZE}x${CHUNK_SIZE})`,
      `Facing: ${CARDINALS[idx]} (${((dir + 360) % 360).toFixed(1)} / ${info.pitchDeg.toFixed(1)})`,
      `Looking at: ${target}`,
      ``,
      `Speed: ${info.speed.toFixed(2)} m/s  ${info.mode}${info.inWater ? (info.submerged ? '  · underwater' : '  · in water') : ''}`,
      `On ground: ${info.onGround}${info.flowing ? `  ·  water flowing (${info.flowing})` : ''}${info.ice ? `  ·  ice (${info.ice})` : ''}${info.mobs ? `  ·  mobs (${info.mobs})` : ''}`,
      `View: ${info.view}`,
      ``,
      `FPS: ${info.fps}  (${info.frameMs.toFixed(1)} ms)`,
      `Draw calls: ${info.calls}  ·  ${(info.tris / 1000).toFixed(1)}k tris`,
      `Water: ${info.waterQuality}  ·  ${info.waterMs.toFixed(1)} ms/frame`,
      `Pixel scale: ${info.pixelScale.toFixed(2)}x  ·  Input: ${info.inputMode}`,
      `Render distance: ${info.renderDistance} chunks (${info.renderDistance * CHUNK_SIZE} blocks)`,
      `Chunks: ${info.meshes} meshed, ${info.queued} queued, ${info.loaded} data in memory`,
      `Memory: ${info.geometryMB.toFixed(0)} MB geometry + ${info.dataMB.toFixed(0)} MB blocks`,
      `World: infinite, y ${WORLD_MIN_Y} to ${WORLD_MAX_Y}, ${info.edits} edits saved`,
    ];
    this.debugEl.textContent = lines.join('\n');
  }
}
