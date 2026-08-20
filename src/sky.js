// Sky with a full day/night cycle: gradient dome that tints through the
// day, a sun that rises in the east and sets in the west, a moon that
// follows it, stars at night, and drifting Minecraft-style slab clouds.
//
// The whole cycle is one number: `timeOfDay`, 0..1, where 0 is sunrise,
// 0.25 is noon, 0.5 is sunset and 0.75 is midnight — the same shape as
// Minecraft's 24000-tick clock, just scaled to a day of DAY_LENGTH_SECONDS.
// Everything else (sun position, sky colour, light level, star visibility)
// is a pure function of that number, so sleeping simply sets it forward.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, clamp, smoothstep } from './utils.js';

/** Length of a full day in real seconds (Minecraft: 20 minutes). */
export const DAY_LENGTH_SECONDS = 1200;
/** Minecraft's tick count per day, for the clock display. */
export const TICKS_PER_DAY = 24000;

export const SKY_TOP = 0x6eb5ff;
export const SKY_HORIZON = 0xe0f0ff;
export const FOG_COLOR = 0xe0f0ff;

// Palette stops for the sky tint. Each is [top, horizon, mixBias] where
// mixBias lifts the horizon toward the top colour during the transition.
const DAY_PALETTE = { top: 0x5d9cec, horizon: 0xe0f0ff };
const SUNSET_PALETTE = { top: 0x4a5a8a, horizon: 0xf0a060 };
const NIGHT_PALETTE = { top: 0x070b24, horizon: 0x141a38 };

function hexToRgb(c) {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
function mixRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
function rgbToHex(rgb) {
  const r = Math.round(clamp(rgb[0], 0, 255));
  const g = Math.round(clamp(rgb[1], 0, 255));
  const b = Math.round(clamp(rgb[2], 0, 255));
  return (r << 16) | (g << 8) | b;
}

function makeSkyDomeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  // Base daytime gradient; the dome material's colour tints it through the
  // cycle (see `updateSkyTint`).
  g.addColorStop(0.0, '#5d9cec');
  g.addColorStop(0.35, '#7fb4f2');
  g.addColorStop(0.62, '#b0d5fa');
  g.addColorStop(0.82, '#d3e9ff');
  g.addColorStop(1.0, '#e0f0ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSunTexture() {
  // Minecraft's sun: a bright square disc with the corners eased off, not
  // a glowing circle. It reads as the sun the same way a square block
  // reads as a tree trunk — it belongs to the same world as the blocks.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 12, 64, 64, 66);
  g.addColorStop(0.0, 'rgba(255,255,235,1)');
  g.addColorStop(0.28, 'rgba(255,250,205,1)');
  g.addColorStop(0.6, 'rgba(255,244,170,0.55)');
  g.addColorStop(1.0, 'rgba(255,244,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMoonTexture() {
  // A pale disc, smaller and cooler than the sun.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(48, 48, 8, 48, 48, 50);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(235,240,255,0.95)');
  g.addColorStop(0.7, 'rgba(220,230,255,0.35)');
  g.addColorStop(1.0, 'rgba(220,230,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 96, 96);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCloudTexture() {
  const rand = mulberry32(2024);
  const cv = document.createElement('canvas');
  const S = 256;
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  // Minecraft's clouds are flat white slabs with soft edges, so build the
  // deck from rectangles with rounded ends rather than radial blobs.
  for (let i = 0; i < 22; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const w = 18 + rand() * 52;
    const h = 8 + rand() * 16;
    const a = 0.10 + rand() * 0.16;
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, `rgba(255,255,255,${a * 1.6})`);
    g.addColorStop(0.5, `rgba(255,255,255,${a})`);
    g.addColorStop(1, `rgba(255,255,255,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    } else {
      // fallback for browsers without roundRect: a plain rectangle
      ctx.rect(x - w / 2, y - h / 2, w, h);
    }
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeStarField() {
  // A fixed set of points on the inside of a big sphere, bright enough to
  // read as stars and small enough to be one draw call.
  const rand = mulberry32(777);
  const N = 900;
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // Rejection-sample onto the sphere shell (upper hemisphere mostly).
    let x = 0, y = 0, z = 0, len = 0;
    do {
      x = rand() * 2 - 1;
      y = rand() * 2 - 1;
      z = rand() * 2 - 1;
      len = Math.hypot(x, y, z);
    } while (len < 0.2 || len > 1);
    pos[i * 3] = (x / len) * 590;
    pos[i * 3 + 1] = Math.abs(y / len) * 590;
    pos[i * 3 + 2] = (z / len) * 590;
    size[i] = 1.2 + rand() * 2.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.6,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -9;
  return points;
}

/**
 * The sun's direction vector for a time of day (0..1). The sun swings
 * through the X–Y plane: east (+X) at sunrise, overhead at noon, west (−X)
 * at sunset, under the world at midnight.
 */
export function sunDirection(timeOfDay) {
  const ang = timeOfDay * Math.PI * 2;
  const e = Math.sin(ang);            // vertical component -1..1
  const horiz = Math.sqrt(Math.max(0, 1 - e * e));
  return { x: Math.cos(ang) * horiz, y: e, z: 0 };
}

/** Brightness of sunlight, 0..1, from the sun's elevation. */
export function sunLight(timeOfDay) {
  const e = sunDirection(timeOfDay).y;
  return clamp(smoothstep(-0.12, 0.45, e) * 1.15, 0, 1);
}

/** Brightness of moonlight, 0..1 (much dimmer, opposite the sun). */
export function moonLight(timeOfDay) {
  const e = sunDirection((timeOfDay + 0.5) % 1).y;
  return clamp(smoothstep(0, 0.5, e) * 0.18, 0, 0.18);
}

/** A friendly clock string for the debug screen / HUD. */
export function clockString(timeOfDay) {
  const ticks = timeOfDay * TICKS_PER_DAY;
  const hours = 6 + (ticks / TICKS_PER_DAY) * 24;
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function createSky(scene, { dayLength = DAY_LENGTH_SECONDS } = {}) {
  // gradient dome
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(600, 24, 12),
    new THREE.MeshBasicMaterial({
      map: makeSkyDomeTexture(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
  );
  dome.renderOrder = -10;
  scene.add(dome);

  // sun
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSunTexture(),
      fog: false,
      depthWrite: false,
      transparent: true,
    })
  );
  sun.scale.setScalar(90);
  sun.position.set(0, 0, 0);
  scene.add(sun);

  // moon
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeMoonTexture(),
      fog: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    })
  );
  moon.scale.setScalar(58);
  moon.position.set(0, 0, 0);
  scene.add(moon);

  // stars
  const stars = makeStarField();
  scene.add(stars);

  // clouds
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: 0.85,
    })
  );
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 210;
  scene.add(clouds);

  const domeTint = new THREE.Color(0xffffff);
  const cloudTint = new THREE.Color(0xffffff);
  const dayTop = hexToRgb(DAY_PALETTE.top);
  const dayHorizon = hexToRgb(DAY_PALETTE.horizon);
  const sunsetTop = hexToRgb(SUNSET_PALETTE.top);
  const sunsetHorizon = hexToRgb(SUNSET_PALETTE.horizon);
  const nightTop = hexToRgb(NIGHT_PALETTE.top);
  const nightHorizon = hexToRgb(NIGHT_PALETTE.horizon);

  /** How overcast it is, kept because the cloud drift wants it too. */
  let overcast = 0;
  /** 0..1 — the time of day. 0 = sunrise, 0.25 = noon, 0.5 = sunset. */
  let timeOfDay = 0.32; // start mid-morning
  /**
   * Whether the sky is shown at all. `updateSkyTint` decides sun and moon
   * visibility from the clock every frame, so it has to defer to this —
   * otherwise diving under hides the dome and the sun comes straight back on
   * the next frame, hanging in the water.
   */
  let shown = true;

  /** Paint the dome/sun/moon/stars for the current time of day. */
  function updateSkyTint() {
    const e = sunDirection(timeOfDay).y; // -1..1
    const dark = clamp(1 - e * 1.4, 0, 1); // 0 at noon, 1 at night
    // Smooth blend: day ↔ sunset around the horizon, sunset ↔ night below.
    const sunsetAmount = smoothstep(0.35, 0.05, Math.abs(e)) * (1 - smoothstep(-0.1, 0.25, e));
    const nightAmount = smoothstep(-0.05, -0.45, -e);
    let top = mixRgb(dayTop, sunsetTop, sunsetAmount);
    top = mixRgb(top, nightTop, nightAmount);
    let horizon = mixRgb(dayHorizon, sunsetHorizon, sunsetAmount);
    horizon = mixRgb(horizon, nightHorizon, nightAmount);

    // Overcast grey washes the whole sky toward flat.
    const grey = 0.62 + 0.35 * nightAmount;
    const r = (rgb, g) => [
      rgb[0] * (1 - g) + 150 * g,
      rgb[1] * (1 - g) + 150 * g,
      rgb[2] * (1 - g) + 155 * g,
    ];
    top = r(top, overcast * 0.55);
    horizon = r(horizon, overcast * 0.6);

    const topHex = rgbToHex(top);
    const horHex = rgbToHex(horizon);
    dome.material.color.setHex(topHex);
    // Pull the dome tint part-way toward the horizon colour so the gradient
    // baked into the texture still reads at both ends.
    dome.material.color.lerp(new THREE.Color(horHex), 0.25);

    // Sun/moon/star visibility
    const sunVisible = shown && e > -0.18;
    sun.visible = sunVisible;
    sun.material.opacity = sunVisible
      ? Math.max(0, 1 - overcast * 1.6) * clamp(e * 3 + 0.4, 0, 1)
      : 0;
    const me = -e; // moon is opposite the sun
    const moonVisible = shown && me > -0.1;
    moon.visible = moonVisible;
    moon.material.opacity = moonVisible
      ? clamp(me * 3 + 0.3, 0, 1) * (1 - overcast * 0.5)
      : 0;
    stars.material.opacity = dark * (1 - overcast * 0.4);

    // Cloud tint follows the light.
    const cloudL = 0.55 + 0.45 * (1 - dark);
    cloudTint.setRGB(cloudL, cloudL, cloudL);
    clouds.material.color.copy(cloudTint);
  }

  /** Place sun/moon/clouds around the player for the current time. */
  function placeBodies(playerPos) {
    const dir = sunDirection(timeOfDay);
    const SUN_DIST = 480;
    sun.position.set(
      playerPos.x + dir.x * SUN_DIST,
      playerPos.y + dir.y * SUN_DIST,
      playerPos.z + dir.z * SUN_DIST
    );
    const mdir = sunDirection((timeOfDay + 0.5) % 1);
    moon.position.set(
      playerPos.x + mdir.x * SUN_DIST,
      playerPos.y + mdir.y * SUN_DIST,
      playerPos.z + mdir.z * SUN_DIST
    );
    clouds.position.x = playerPos.x;
    clouds.position.z = playerPos.z;
  }

  return {
    /** Hidden while the camera is under water — down there you see fog. */
    setVisible(on) {
      shown = on;
      dome.visible = on;
      sun.visible = on;
      moon.visible = on;
      clouds.visible = on;
      stars.visible = on;
    },

    setOvercast(level) {
      overcast = Math.max(0, Math.min(1, level));
    },

    /** Advance the clock. `dt` is real seconds of game time. */
    advance(dt) {
      if (dt <= 0) return;
      timeOfDay = (timeOfDay + dt / dayLength) % 1;
    },

    /** Jump straight to a time of day (0..1) — sleeping, or a test. */
    setTimeOfDay(t) {
      timeOfDay = ((t % 1) + 1) % 1;
    },

    get timeOfDay() { return timeOfDay; },
    get clock() { return clockString(timeOfDay); },
    /** 0..1 light level, sun + moon combined. */
    get lightLevel() { return sunLight(timeOfDay) + moonLight(timeOfDay); },
    /** The direction the sun is in right now (for the light and water). */
    get sunDir() { return sunDirection(timeOfDay); },

    update(dt, playerPos) {
      this.advance(dt);
      updateSkyTint();
      placeBodies(playerPos);
      // Weather moves, so the cloud deck moves with it.
      const wind = 1 + overcast * 2.2;
      cloudTex.offset.x += dt * 0.0022 * wind;
      cloudTex.offset.y += dt * 0.0008 * wind;
    },
  };
}
