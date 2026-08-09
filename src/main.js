// Minecraft browser clone — entry point.
// Game loop: fixed 120 Hz physics (Minecraft-accurate movement constants),
// render at display refresh rate.

import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { createSky, FOG_COLOR } from './sky.js';
import { PHYSICS_DT, FOV_BASE, FOV_SPRINT, FOV_SNEAK, SPEED_WALK } from './constants.js';
import { clamp, lerp } from './utils.js';

const MOUSE_SENSITIVITY = 0.0024;

// ---------------- renderer / scene ----------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
sun.shadow.mapSize.set(2048, 2048);
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

// ---------------- game state ----------------
let paused = true; // waiting for pointer lock
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

  // ---- mouse look ----
  if (input.locked) {
    const { dx, dy } = input.consumeMouse();
    player.yaw -= dx * MOUSE_SENSITIVITY;
    player.pitch = clamp(player.pitch - dy * MOUSE_SENSITIVITY, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  // ---- physics (paused while the mouse is released) ----
  if (input.locked) {
    paused = false;
    acc += frameDt;
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 8) {
      step(PHYSICS_DT);
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps === 8) acc = 0; // drop backlog on huge hitches
  } else {
    paused = true;
    acc = 0;
  }

  // ---- status messages on mode changes ----
  if (!paused) {
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
  });

  renderer.render(scene, camera);
}

// ---------------- overlay / pointer lock ----------------
hud.overlayEl.addEventListener('click', () => {
  try {
    input.requestLock();
  } catch (e) {
    /* pointer lock unavailable */
  }
});
document.addEventListener('pointerlockchange', () => {
  if (input.locked) {
    hud.hideOverlay();
  } else {
    hud.showOverlay();
  }
});

// ---------------- resize ----------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- go ----------------
requestAnimationFrame(frame);
