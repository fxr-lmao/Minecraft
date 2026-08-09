// Minecraft browser clone — entry point.
// Game loop: fixed 120 Hz physics (Minecraft-accurate movement constants),
// render at display refresh rate. Features:
//   - face-culled voxel meshes (few thousand quads instead of hundreds of thousands)
//   - adaptive frame pacing: measures the display cadence, targets 120 fps on
//     high-refresh screens, scales render resolution / shadow quality to hold it
//   - camera modes (F5): first person / third person (back) / third person (front)
//     with an animated Steve-style character in third person
//   - pointer-lock fallback: click-drag to look + arrow keys steer where
//     pointer lock is unavailable (embedded previews, sandboxed iframes)
//   - high-performance GPU preference, no MSAA

import * as THREE from '../vendor/three.module.min.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Character } from './character.js';
import { createSky, FOG_COLOR } from './sky.js';
import { PHYSICS_DT, FOV_BASE, FOV_SPRINT, FOV_SNEAK, SPEED_WALK } from './constants.js';
import {
  clamp, lerp,
  refreshBucket, initialTargetFps, tierDown, tierUp,
} from './utils.js';

const MOUSE_SENSITIVITY = 0.0024;
const TOUCH_SENSITIVITY = 0.006;

const CAMERA_MODES = ['First person', 'Third person (back)', 'Third person (front)'];
const THIRD_PERSON_DIST = 4.5;

// ---------------- error / loading overlays ----------------
const fatalEl = document.getElementById('fatal');
const fatalMsg = document.getElementById('fatal-msg');
const loadingEl = document.getElementById('loading');
let firstFrame = true;

function showFatal(message) {
  fatalMsg.textContent = message;
  fatalEl.classList.remove('hidden');
  loadingEl.classList.add('hidden');
}
window.addEventListener('error', (e) => showFatal(e.message || 'Unknown script error'));
window.addEventListener('unhandledrejection', (e) =>
  showFatal(String((e.reason && e.reason.message) || e.reason || 'Unknown error'))
);
document.getElementById('fatal-reload').addEventListener('click', () => location.reload());

// WebGL2 check (three r185 requires WebGL2)
try {
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) throw new Error('no webgl2');
} catch {
  showFatal('WebGL2 is not supported by this browser or device. Please update your browser or try another one.');
}

// ---------------- renderer / scene ----------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false, // MSAA is expensive on mobile GPUs
  powerPreference: 'high-performance',
});
const DPR_CAP = Math.min(window.devicePixelRatio || 1, 2);
const PR_MIN = 0.75; // floor for adaptive resolution
let pixelRatio = DPR_CAP;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR, 35, 95);

const camera = new THREE.PerspectiveCamera(FOV_BASE, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';

// ---------------- lights ----------------
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x7a6a52, 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d9, 1.7);
sun.position.set(60, 100, 40);
sun.castShadow = true;
let shadowMapSize = 2048;
sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
const s = 46;
sun.shadow.camera.left = -s;
sun.shadow.camera.right = s;
sun.shadow.camera.top = s;
sun.shadow.camera.bottom = -s;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.12;
scene.add(sun);
scene.add(sun.target);

// ---------------- world / player / input / hud / sky / character ----------------
const world = new World();
for (const mesh of world.buildMeshes().values()) scene.add(mesh);

const player = new Player(world);
const input = new Input(canvas);
const hud = new Hud();
const sky = createSky(scene);
const character = new Character();
scene.add(character.group);

if (input.touchMode) document.body.classList.add('touch');

// ---------------- adaptive quality ----------------
function applyResolution() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function setShadowMapSize(size) {
  if (shadowMapSize === size) return;
  shadowMapSize = size;
  sun.shadow.mapSize.set(size, size);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null; // rebuilt on next render
  }
}

// one place to apply a quality step: resolution + shadow fidelity together
function applyQuality() {
  applyResolution();
  setShadowMapSize(pixelRatio > 1.5 ? 2048 : pixelRatio > 1 ? 1536 : 1024);
}

// ---------------- adaptive frame pacing ----------------
// rAF fires at the display cadence, so the *achievable* frame rate is a
// property of the display. We measure it, snap to a standard refresh rate,
// and hold the highest image quality that sustains the targeted FPS
// (120 fps on high-refresh screens). If even minimum resolution can't hold
// the target we relax it one tier; sustained headroom restores it.
let displayHz = 60;
let fpsTarget = 60;
let hzAccum = 0;
let hzFrames = 0;
let perfCooldown = 0;
let lowTimer = 0;
let highTimer = 0;

function adaptPerformance(frameDt) {
  // rolling 2.5 s window over the observed cadence; the estimate only ever
  // moves UP (a struggling GPU measures low, but an idle one never lies high)
  hzAccum += frameDt;
  hzFrames++;
  if (hzAccum >= 2.5) {
    const win = hzFrames / hzAccum;
    hzAccum = 0;
    hzFrames = 0;
    const hz = refreshBucket(win);
    if (hz > displayHz) {
      displayHz = hz;
      const ambition = initialTargetFps(displayHz);
      if (fpsTarget < ambition) fpsTarget = ambition;
    }
  }

  perfCooldown = Math.max(0, perfCooldown - frameDt);

  const lowMark = fpsTarget * 0.85;
  const highMark = Math.min(fpsTarget * 0.99, displayHz * 0.98);

  if (fpsSmooth < lowMark) {
    highTimer = 0;
    lowTimer += frameDt;
    if (lowTimer > 1.4 && perfCooldown === 0) {
      if (pixelRatio > PR_MIN) {
        pixelRatio = Math.max(PR_MIN, Math.round((pixelRatio - 0.25) * 100) / 100);
        applyQuality();
      } else {
        const relaxed = tierDown(fpsTarget);
        if (relaxed !== fpsTarget) {
          fpsTarget = relaxed;
          hud.showStatus(`Performance: frame target ${fpsTarget} fps`);
        }
      }
      lowTimer = 0;
      perfCooldown = 1.25;
    }
  } else if (fpsSmooth > highMark) {
    lowTimer = 0;
    highTimer += frameDt;
    if (highTimer > 3 && perfCooldown === 0) {
      if (pixelRatio < DPR_CAP) {
        pixelRatio = Math.min(DPR_CAP, Math.round((pixelRatio + 0.25) * 100) / 100);
        applyQuality();
      } else {
        fpsTarget = tierUp(fpsTarget, displayHz);
      }
      highTimer = 0;
      perfCooldown = 1.25;
    }
  } else {
    lowTimer = 0;
    highTimer = 0;
  }
}

function resetPerformanceTimers() {
  hzAccum = 0;
  hzFrames = 0;
  lowTimer = 0;
  highTimer = 0;
  perfCooldown = 0;
}

// ---------------- camera modes ----------------
let cameraMode = 0; // 0 first person, 1 third (back), 2 third (front)

function cycleCamera() {
  cameraMode = (cameraMode + 1) % CAMERA_MODES.length;
  hud.showStatus(`Camera: ${CAMERA_MODES[cameraMode]}`);
}

const _lookDir = new THREE.Vector3();
const _boomDir = new THREE.Vector3();
const _sample = new THREE.Vector3();
const BOOM_PAD = 0.28;
const BOOM_STEP = 0.25;

/** Camera forward including pitch (matches rotation order YXZ). */
function lookDirection(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Is the boom about to clip a solid block around (x, y, z)? */
function boomBlocked(x, y, z) {
  for (const ox of [-BOOM_PAD, BOOM_PAD]) {
    for (const oy of [-BOOM_PAD, BOOM_PAD]) {
      for (const oz of [-BOOM_PAD, BOOM_PAD]) {
        if (world.isSolid(Math.floor(x + ox), Math.floor(y + oy), Math.floor(z + oz))) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Shorten the third-person camera boom so it never enters solid geometry. */
function thirdPersonBoom(eye, dir, want) {
  for (let t = BOOM_STEP; t <= want; t += BOOM_STEP) {
    _sample.copy(dir).multiplyScalar(t).add(eye);
    if (boomBlocked(_sample.x, _sample.y, _sample.z)) {
      return Math.max(0.6, t - BOOM_STEP);
    }
  }
  return want;
}

// ---------------- game state ----------------
let prevSprinting = false;
let prevSneaking = false;

// ---------------- fixed-timestep loop ----------------
let acc = 0;
let lastTime = performance.now();

// fps tracking
let fpsSmooth = 60;
let frameMsSmooth = 16;

function step(dt) {
  const moveInput = input.getMovementInput();
  player.update(dt, moveInput);
}

function frame(now) {
  requestAnimationFrame(frame);

  const frameDt = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;

  // fps smoothing
  const instFps = 1 / Math.max(frameDt, 1e-4);
  fpsSmooth += (instFps - fpsSmooth) * 0.06;
  frameMsSmooth += (frameDt * 1000 - frameMsSmooth) * 0.06;

  // ---- look (pointer lock, drag fallback, arrow keys, or touch) ----
  if (input.active) {
    const look = input.consumeLook(frameDt);
    const sens = input.touchMode ? TOUCH_SENSITIVITY : MOUSE_SENSITIVITY;
    player.yaw -= look.dx * sens + look.arrowDX;
    player.pitch = clamp(
      player.pitch - look.dy * sens - look.arrowDY,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01
    );
  }

  // ---- physics (paused while on the start overlay) ----
  if (input.active) {
    acc += frameDt;
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 8) {
      step(PHYSICS_DT);
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps === 8) acc = 0; // drop backlog on huge hitches
  } else {
    acc = 0;
  }

  // ---- adaptive frame pacing + resolution ----
  if (input.active) {
    adaptPerformance(frameDt);
  } else {
    resetPerformanceTimers();
  }

  // ---- status messages on mode changes ----
  if (input.active) {
    if (player.sprinting && !prevSprinting) hud.showStatus('Sprinting');
    if (!player.sprinting && prevSprinting) hud.showStatus('Sprinting stopped');
    if (player.sneaking && !prevSneaking) hud.showStatus('Sneaking');
    if (!player.sneaking && prevSneaking) hud.showStatus('Sneaking stopped');
    prevSprinting = player.sprinting;
    prevSneaking = player.sneaking;
  }

  // ---- camera ----
  const fovTarget = player.sprinting ? FOV_SPRINT : player.sneaking ? FOV_SNEAK : FOV_BASE;
  camera.fov += (fovTarget - camera.fov) * Math.min(1, frameDt * 10);
  camera.updateProjectionMatrix();

  // head bob (computed always, applied in first person)
  const speedFactor = clamp(player.horizontalSpeed / SPEED_WALK, 0, 1.35);
  player.bobPhase = (player.bobPhase || 0) + player.horizontalSpeed * frameDt * 2.1;
  const bobAmp = player.onGround ? (player.sprinting ? 0.085 : 0.055) * speedFactor : 0;
  const bobY = Math.sin(player.bobPhase) * bobAmp;
  const bobX = Math.cos(player.bobPhase * 0.5) * bobAmp * 0.6;
  player.bobY = lerp(player.bobY || 0, bobY, Math.min(1, frameDt * 12));
  player.bobX = lerp(player.bobX || 0, bobX, Math.min(1, frameDt * 12));

  const eye = player.eyePos;
  let boomDist = 0;

  if (cameraMode === 0) {
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    const right = player.rightVector();
    camera.position.set(
      eye.x + right.x * player.bobX,
      eye.y + player.bobY,
      eye.z + right.z * player.bobX
    );
  } else {
    lookDirection(player.yaw, player.pitch, _lookDir);
    _boomDir.copy(_lookDir);
    if (cameraMode === 1) _boomDir.multiplyScalar(-1); // behind the player

    boomDist = thirdPersonBoom(eye, _boomDir, THIRD_PERSON_DIST);
    let cx = eye.x + _boomDir.x * boomDist;
    let cy = eye.y + _boomDir.y * boomDist;
    let cz = eye.z + _boomDir.z * boomDist;

    // never push the camera below the terrain surface
    const gx = clamp(Math.floor(cx), 0, world.size - 1);
    const gz = clamp(Math.floor(cz), 0, world.size - 1);
    const groundTop = world.heightAt(gx, gz) + 1;
    if (cy < groundTop + 0.18) cy = groundTop + 0.18;

    camera.position.set(cx, cy, cz);
    // front view looks back at the player
    camera.rotation.y = cameraMode === 1 ? player.yaw : player.yaw + Math.PI;
    camera.rotation.x = cameraMode === 1 ? player.pitch : -player.pitch;
  }

  // ---- character (third person only; hidden if the boom collapsed) ----
  character.group.visible = cameraMode !== 0 && boomDist > 0.9;
  character.update(frameDt, player);

  // ---- sun / sky follow player ----
  sun.position.set(player.pos.x + 60, 105, player.pos.z + 40);
  sun.target.position.copy(player.pos);
  sky.update(frameDt, player.pos);

  // ---- debug overlay ----
  const px = Math.floor(player.pos.x);
  const pz = Math.floor(player.pos.z);
  const blockUnder = world.get(px, world.heightAt(px, pz), pz);
  hud.updateDebug({
    pos: player.pos,
    pitchDeg: (player.pitch * 180) / Math.PI,
    yawDeg: player.facingDegrees(),
    speed: player.horizontalSpeed,
    mode: player.sneaking ? 'Sneaking' : player.sprinting ? 'Sprinting' : 'Walking',
    onGround: player.onGround,
    blockUnder,
    fps: Math.round(fpsSmooth),
    frameMs: frameMsSmooth,
    fpsTarget,
    displayHz,
    pixelScale: pixelRatio,
    touch: input.touchMode,
    cameraName: CAMERA_MODES[cameraMode],
  });

  renderer.render(scene, camera);

  // hide the loading screen once the first frame is on screen
  if (firstFrame) {
    firstFrame = false;
    loadingEl.classList.add('hidden');
  }
}

// ---------------- overlay / pointer lock / start ----------------

let fallbackHintShown = false;

/** Engage drag + arrow-key look when pointer lock can't be acquired. */
function engageFallback() {
  if (input.touchMode || input.locked || input.fallbackEnabled) return;
  input.enableFallback();
  hud.hideOverlay();
  if (!fallbackHintShown) {
    fallbackHintShown = true;
    hud.showStatus('Mouse lock unavailable — click-drag to look, arrow keys steer');
  }
}

function beginPlay() {
  input.start();
  if (input.touchMode) {
    hud.hideOverlay();
    return;
  }
  // Pointer lock normally engages within a frame or two after the user
  // gesture; if it hasn't, the environment denies it — drop to fallback.
  setTimeout(() => {
    if (!input.locked) engageFallback();
  }, 300);
}

hud.overlayEl.addEventListener('click', beginPlay);

document.addEventListener('pointerlockchange', () => {
  if (input.locked) {
    hud.hideOverlay();
  } else if (!input.touchMode) {
    hud.showOverlay();
  }
});

// The browser told us straight away the lock request failed.
document.addEventListener('pointerlockerror', engageFallback);

// In fallback mode Esc pauses back to the overlay (there's no lock to exit).
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && input.fallbackEnabled && !input.locked) {
    input.endFallback();
    hud.showOverlay();
  }
});

// F5 cycles the camera (preventDefault keeps the browser from reloading).
window.addEventListener('keydown', (e) => {
  if (e.code === 'F5') {
    e.preventDefault();
    if (input.active) cycleCamera();
  }
});

// Start with any key too (Magic Keyboard on iPad, or just convenience):
// the overlay is visible, so a keypress is an explicit user gesture.
// Escape/F5 are excluded — Esc pauses in fallback mode (its handler runs
// first on the same event), and F5 is the camera toggle, not a start key.
window.addEventListener('keydown', (e) => {
  if (hud.overlayEl.classList.contains('hidden')) return;
  if (e.code === 'Escape' || e.code === 'F5') return;
  beginPlay();
});

// debug toggle button (touch devices have no F3 key)
document.getElementById('btn-debug').addEventListener('click', () => hud.toggleDebug());

// WebGL context lost (iOS reclaims memory in background tabs, etc.)
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showFatal('The graphics context was lost (often caused by low memory). Tap Reload to continue.');
});

// ---------------- resize ----------------
window.addEventListener('resize', applyResolution);

// ---------------- go ----------------
requestAnimationFrame(frame);

// handle for tests / debugging from the console
window.__game = {
  player, input, hud, world, camera, renderer,
  cycleCamera,
  debugState() {
    return {
      active: input.active,
      locked: input.locked,
      fallback: input.fallbackEnabled,
      cameraMode,
      characterVisible: character.group.visible,
      pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
      yaw: player.yaw,
      pitch: player.pitch,
      fps: Math.round(fpsSmooth),
      fpsTarget,
      displayHz,
      pixelRatio,
    };
  },
};
