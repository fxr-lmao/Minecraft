// Minecraft browser clone — entry point.
// Game loop: fixed 120 Hz physics (Minecraft-accurate movement constants),
// render at display refresh rate. Performance features:
//   - face-culled voxel meshes (few thousand quads instead of hundreds of thousands)
//   - adaptive render resolution: drops pixel scale when FPS is low, raises it again when headroom returns
//   - high-performance GPU preference, no MSAA

import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { createSky, FOG_COLOR } from './sky.js';
import { PHYSICS_DT, FOV_BASE, FOV_SPRINT, FOV_SNEAK, SPEED_WALK } from './constants.js';
import { clamp, lerp } from './utils.js';

const MOUSE_SENSITIVITY = 0.0024;
const TOUCH_SENSITIVITY = 0.006;

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

// ---------------- world / player / input / hud / sky ----------------
const world = new World();
for (const mesh of world.buildMeshes().values()) scene.add(mesh);

const player = new Player(world);
const input = new Input(canvas);
const hud = new Hud();
const sky = createSky(scene);

if (input.touchMode) document.body.classList.add('touch');

// ---------------- adaptive resolution ----------------
let resTimer = 0;

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

  // ---- look (mouse or touch drag) ----
  if (input.active) {
    const { dx, dy } = input.consumeLook();
    const sens = input.touchMode ? TOUCH_SENSITIVITY : MOUSE_SENSITIVITY;
    player.yaw -= dx * sens;
    player.pitch = clamp(player.pitch - dy * sens, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  // ---- physics (paused while the mouse is released / before start) ----
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

  // ---- adaptive resolution ----
  if (input.active) {
    resTimer += frameDt;
    if (fpsSmooth < 48 && pixelRatio > 1 && resTimer > 2.5) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      applyResolution();
      if (pixelRatio <= 1.5) setShadowMapSize(1024);
      resTimer = 0;
    } else if (fpsSmooth > 100 && pixelRatio < DPR_CAP && resTimer > 3) {
      pixelRatio = Math.min(DPR_CAP, pixelRatio + 0.25);
      applyResolution();
      if (pixelRatio > 1.5) setShadowMapSize(2048);
      resTimer = 0;
    }
  } else {
    resTimer = 0;
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
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  const eye = player.eyePos;
  const fovTarget = player.sprinting ? FOV_SPRINT : player.sneaking ? FOV_SNEAK : FOV_BASE;
  camera.fov += (fovTarget - camera.fov) * Math.min(1, frameDt * 10);
  camera.updateProjectionMatrix();

  // head bob
  const speedFactor = clamp(player.horizontalSpeed / SPEED_WALK, 0, 1.35);
  player.bobPhase = (player.bobPhase || 0) + player.horizontalSpeed * frameDt * 2.1;
  const bobAmp = player.onGround ? (player.sprinting ? 0.085 : 0.055) * speedFactor : 0;
  const bobY = Math.sin(player.bobPhase) * bobAmp;
  const bobX = Math.cos(player.bobPhase * 0.5) * bobAmp * 0.6;
  player.bobY = lerp(player.bobY || 0, bobY, Math.min(1, frameDt * 12));
  player.bobX = lerp(player.bobX || 0, bobX, Math.min(1, frameDt * 12));

  const right = player.rightVector();
  camera.position.set(
    eye.x + right.x * player.bobX,
    eye.y + player.bobY,
    eye.z + right.z * player.bobX
  );

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
    pixelScale: pixelRatio,
    touch: input.touchMode,
  });

  renderer.render(scene, camera);

  // hide the loading screen once the first frame is on screen
  if (firstFrame) {
    firstFrame = false;
    loadingEl.classList.add('hidden');
  }
}

// ---------------- overlay / pointer lock / start ----------------
hud.overlayEl.addEventListener('click', () => {
  input.start();
  if (input.touchMode) hud.hideOverlay();
});
document.addEventListener('pointerlockchange', () => {
  if (input.locked) {
    hud.hideOverlay();
  } else if (!input.touchMode) {
    hud.showOverlay();
  }
});

// Start with any key too (Magic Keyboard on iPad, or just convenience):
// the overlay is visible, so a keypress is an explicit user gesture.
window.addEventListener('keydown', () => {
  if (hud.overlayEl.classList.contains('hidden')) return;
  input.start();
  hud.hideOverlay();
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
