// Minecraft browser clone — entry point.
// Game loop: fixed 120 Hz physics (Minecraft-accurate movement constants),
// render at display refresh rate. Performance features:
//   - face-culled voxel meshes, chunked so edits re-mesh 1/16th of the world
//   - adaptive render resolution: drops pixel scale when FPS is low, raises it again when headroom returns
//   - high-performance GPU preference, no MSAA

import * as THREE from '../vendor/three.module.min.js';
import { World, AIR, BEDROCK } from './world.js';
import { WorldRenderer, buildSingleBlockGeometry } from './blocks.js';
import { Player } from './player.js';
import { Input, LOOK_FREE, LOOK_TOUCH } from './input.js';
import { Hud } from './hud.js';
import { Inventory } from './inventory.js';
import { InventoryUI } from './inventory-ui.js';
import { ViewController } from './view.js';
import { createPlayerModel } from './player-model.js';
import { raycastVoxel, blockIntersectsPlayer } from './raycast.js';
import { createSky, FOG_COLOR } from './sky.js';
import { BLOCK_DEFS } from './textures.js';
import { settings, setSetting, LIMITS } from './settings.js';
import * as savegame from './savegame.js';
import {
  PHYSICS_DT, SPEED_WALK,
  PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_EYE, REACH,
} from './constants.js';
import { clamp, lerp } from './utils.js';

const MOUSE_SENSITIVITY = 0.0024; // multiplied by the player's setting
const TOUCH_SENSITIVITY = 0.006;
const USE_REPEAT = 0.22; // seconds between repeats while a use button is held
const SAVE_DEBOUNCE = 2000; // ms after an edit before writing to localStorage
const SAVE_INTERVAL = 20000; // ms between position-only saves

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

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR, 35, 95);

const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 1000);
camera.rotation.order = 'YXZ';
scene.add(camera); // so the first-person held block (a camera child) renders

/** iPad Safari changes innerHeight as browser chrome slides away — re-measure. */
function viewportSize() {
  const vv = window.visualViewport;
  return {
    w: Math.max(1, Math.round(vv?.width ?? window.innerWidth)),
    h: Math.max(1, Math.round(vv?.height ?? window.innerHeight)),
  };
}

function applyResolution() {
  const { w, h } = viewportSize();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
applyResolution();
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is deprecated in r185
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

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

// ---------------- world / saved game ----------------
const world = new World();
const inventory = new Inventory();
const view = new ViewController();
const restored = savegame.load(world);

if (restored) {
  world.applyEdits(restored.edits);
  if (restored.inventory.slots.length === inventory.slots.length) {
    restored.inventory.slots.forEach((stack, i) => inventory.set(i, stack));
    inventory.select(restored.inventory.selected);
  }
  view.set(restored.view);
} else {
  inventory.fillStarterKit(BLOCK_DEFS.map((b) => b.id));
}

// Meshes are built after the saved edits are applied, so a restored world
// comes up already built instead of re-meshing every chunk on the first frame.
const worldRenderer = new WorldRenderer(world, scene);

const player = new Player(world);
if (restored?.player) {
  player.pos.set(restored.player.x, restored.player.y, restored.player.z);
  player.yaw = restored.player.yaw ?? player.yaw;
  player.pitch = restored.player.pitch ?? player.pitch;
}

const input = new Input(canvas);
const hud = new Hud();
const sky = createSky(scene);
const invUI = new InventoryUI(inventory, (open) => onInventoryToggle(open));

const playerModel = createPlayerModel();
scene.add(playerModel.group);
playerModel.group.visible = false;

// ---------------- block targeting ----------------
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })
);
highlight.visible = false;
scene.add(highlight);

let target = null; // { x, y, z, nx, ny, nz } from the last frame

// ---------------- first-person held block ----------------
const HELD_DIST = 0.62; // metres in front of the camera
const HELD_SIZE = 0.26; // fraction of the screen height the block takes up
const heldGeometry = buildSingleBlockGeometry();
const heldMesh = new THREE.Mesh(heldGeometry, new THREE.MeshLambertMaterial());
heldMesh.rotation.set(0.12, -0.6, 0.1);
heldMesh.visible = false;
heldMesh.frustumCulled = false;
camera.add(heldMesh);

// Held blocks get the same emissive trick as the avatar so the face pointing
// at the player is never pitch black when the sun is behind them.
const heldMaterials = new Map();
function heldMaterialFor(id) {
  let mat = heldMaterials.get(id);
  if (!mat) {
    const { map } = worldRenderer.materialFor(id);
    mat = new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: 0x5a5a5a });
    heldMaterials.set(id, mat);
  }
  return mat;
}

let heldId = -1;
let heldSwing = 0;

function refreshHeldItem() {
  const id = inventory.selectedId();
  if (id !== heldId) {
    heldId = id;
    if (id) heldMesh.material = heldMaterialFor(id);
  }
  heldMesh.visible = view.isFirstPerson && heldId > 0;
}

/**
 * Size and pin the held block to the bottom-right corner whatever the aspect
 * ratio or FOV is — an iPad in portrait has a much narrower frustum than a
 * laptop, so fixed offsets would push the block off screen.
 */
function positionHeldItem(swingT) {
  const halfH = Math.tan((camera.fov * Math.PI) / 360) * HELD_DIST;
  const halfW = halfH * camera.aspect;
  // Size against the shorter axis so a portrait tablet doesn't get a block
  // that swallows the bottom of the screen.
  const r = HELD_SIZE * Math.min(halfH, halfW * 0.95);
  heldMesh.scale.setScalar(r / 0.85);
  heldMesh.position.set(
    halfW - r * 1.2 - swingT * r * 0.5,
    -halfH + r * 0.7 - swingT * r * 1.1,
    -HELD_DIST + swingT * 0.08
  );
  heldMesh.rotation.x = 0.12 + swingT * 0.8;
}

function swingHand() {
  heldSwing = 1;
  playerModel.swingArm();
}

// ---------------- saving ----------------
let saveNeeded = false;
let lastSaveAt = performance.now();
/** Set while resetting: reloading fires pagehide, which would re-save the
 *  world we just deleted and make "Reset world" do nothing. */
let savingDisabled = false;

function doSave() {
  if (savingDisabled) return;
  savegame.save({ world, inventory, player, viewMode: view.mode });
  saveNeeded = false;
  lastSaveAt = performance.now();
}

// Backgrounding a tab on iPadOS can discard it outright, so flush on the way out.
window.addEventListener('pagehide', () => doSave());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') doSave();
});

// ---------------- interaction ----------------
function breakBlock() {
  if (!target) return;
  const id = world.get(target.x, target.y, target.z);
  if (id === AIR) return;
  if (id === BEDROCK) {
    hud.showStatus('Bedrock cannot be broken');
    swingHand();
    return;
  }
  world.setBlock(target.x, target.y, target.z, AIR);
  const left = inventory.add(id, 1);
  if (left > 0) hud.showStatus('Inventory full');
  invUI.render();
  refreshHeldItem();
  swingHand();
  saveNeeded = true;
}

function placeBlock() {
  if (!target) return;
  const stack = inventory.selectedStack();
  if (!stack) {
    hud.showStatus('Nothing in hand');
    return;
  }
  const bx = target.x + target.nx;
  const by = target.y + target.ny;
  const bz = target.z + target.nz;
  if (!world.inBounds(bx, by, bz) || world.isSolid(bx, by, bz)) return;
  if (blockIntersectsPlayer(bx, by, bz, player.pos, PLAYER_WIDTH, PLAYER_HEIGHT)) return;
  world.setBlock(bx, by, bz, stack.id);
  inventory.consumeSelected(1);
  invUI.render();
  refreshHeldItem();
  swingHand();
  saveNeeded = true;
}

/** Middle click / pick block: select the targeted block in the hotbar. */
function pickBlock() {
  if (!target) return;
  const id = world.get(target.x, target.y, target.z);
  if (!id) return;
  for (let i = 0; i < 9; i++) {
    if (inventory.get(i)?.id === id) {
      invUI.selectSlot(i);
      return;
    }
  }
  inventory.set(inventory.selected, { id, count: 1 });
  invUI.render();
  invUI.flashName();
  saveNeeded = true;
}

// ---------------- menus / pausing ----------------
function onInventoryToggle(open) {
  input.setEnabled(!open);
  hud.setCrosshairVisible(!open);
  if (open) {
    input.releasePointerOnly();
  } else if (!hud.overlayVisible) {
    input.resumePointer();
    saveNeeded = true;
  }
  refreshHeldItem();
}

function pause() {
  input.release();
  doSave();
  hud.showPause(input);
}

let hasPlayed = false;

function startPlaying(source) {
  input.start(source);
  if (input.active) {
    hasPlayed = true;
    hud.hideOverlay();
  }
}

function cycleView() {
  view.cycle();
  hud.showStatus(view.name);
  playerModel.group.visible = !view.isFirstPerson;
  refreshHeldItem();
  saveNeeded = true;
}

input.onAction = (name, arg) => {
  if (name === 'lookmode') {
    // The pointer lock never engaged (iPadOS Safari does this silently).
    // Tell the player which mode they got instead of leaving them guessing.
    if (arg === LOOK_FREE) {
      hud.showStatus('Mouse look on — move the cursor, edges keep turning');
    }
    hud.refreshLookMode(input);
    return;
  }
  if (name === 'fullscreen') {
    input.toggleFullscreen();
    return;
  }
  if (hud.overlayVisible) return; // paused: the menu owns the input
  switch (name) {
    case 'inventory':
      invUI.toggle();
      break;
    case 'escape':
      if (invUI.isOpen) invUI.close();
      else pause();
      break;
    case 'view':
      cycleView();
      break;
    case 'debug':
      hud.toggleDebug();
      break;
    case 'slot':
      if (!invUI.isOpen) invUI.selectSlot(arg);
      break;
    case 'scroll':
      if (!invUI.isOpen) invUI.scrollSelection(arg);
      break;
    case 'zoom':
      if (!view.isFirstPerson) hud.showStatus(`Camera distance ${view.zoom(arg).toFixed(1)}`);
      break;
    case 'break':
      if (!invUI.isOpen) breakBlock();
      break;
    case 'place':
      if (!invUI.isOpen) placeBlock();
      break;
    case 'pick':
      if (!invUI.isOpen) pickBlock();
      break;
  }
};

// ---------------- adaptive resolution ----------------
let resTimer = 0;

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
let eyeOffset = 0; // smooth sneak crouch
let breakRepeat = 0;
let placeRepeat = 0;

// ---------------- fixed-timestep loop ----------------
let acc = 0;
let lastTime = performance.now();
let fpsSmooth = 60;
let frameMsSmooth = 16;

function step(dt) {
  player.update(dt, input.getMovementInput());
}

function frame(now) {
  requestAnimationFrame(frame);

  const frameDt = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;

  const instFps = 1 / Math.max(frameDt, 1e-4);
  fpsSmooth += (instFps - fpsSmooth) * 0.06;
  frameMsSmooth += (frameDt * 1000 - frameMsSmooth) * 0.06;

  const playing = input.active && input.enabled;

  // ---- look (mouse, free-look cursor, or touch drag) ----
  if (playing) {
    const { dx, dy, touch } = input.consumeLook();
    const edge = input.edgeLook(frameDt);
    const sens = (touch ? TOUCH_SENSITIVITY * settings.touchSensitivity
      : MOUSE_SENSITIVITY * settings.sensitivity);
    const invert = settings.invertY ? -1 : 1;
    player.yaw -= (dx + (edge?.dx ?? 0)) * sens;
    player.pitch = clamp(
      player.pitch - (dy + (edge?.dy ?? 0)) * sens * invert,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01
    );
  }

  // ---- physics (paused while the mouse is released / a menu is open) ----
  if (playing) {
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

  // ---- held use button auto-repeat ----
  if (playing) {
    breakRepeat = input.pressed.break ? breakRepeat + frameDt : 0;
    if (breakRepeat >= USE_REPEAT) {
      breakRepeat = 0;
      breakBlock();
    }
    placeRepeat = input.pressed.place ? placeRepeat + frameDt : 0;
    if (placeRepeat >= USE_REPEAT) {
      placeRepeat = 0;
      placeBlock();
    }
  }

  // ---- adaptive resolution ----
  if (playing) {
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
  if (playing) {
    if (player.sprinting && !prevSprinting) hud.showStatus('Sprinting');
    if (player.sneaking && !prevSneaking) hud.showStatus('Sneaking');
    prevSprinting = player.sprinting;
    prevSneaking = player.sneaking;
  }

  // ---- camera ----
  const fovBase = settings.fov;
  const fovTarget = player.sprinting ? fovBase + 14 : player.sneaking ? fovBase - 10 : fovBase;
  camera.fov += (fovTarget - camera.fov) * Math.min(1, frameDt * 10);
  camera.updateProjectionMatrix();

  // head bob (first person only)
  const speedFactor = clamp(player.horizontalSpeed / SPEED_WALK, 0, 1.35);
  player.bobPhase = (player.bobPhase || 0) + player.horizontalSpeed * frameDt * 2.1;
  const bobTarget = view.isFirstPerson && player.onGround
    ? (player.sprinting ? 0.085 : 0.055) * speedFactor
    : 0;
  player.bobY = lerp(player.bobY || 0, Math.sin(player.bobPhase) * bobTarget, Math.min(1, frameDt * 12));
  player.bobX = lerp(player.bobX || 0, Math.cos(player.bobPhase * 0.5) * bobTarget * 0.6, Math.min(1, frameDt * 12));

  eyeOffset = lerp(eyeOffset, player.sneaking ? 0.16 : 0, Math.min(1, frameDt * 12));
  const right = player.rightVector();
  const eye = {
    x: player.pos.x + right.x * player.bobX,
    y: player.pos.y + PLAYER_EYE - eyeOffset + player.bobY,
    z: player.pos.z + right.z * player.bobX,
  };
  view.apply(camera, world, eye, player.yaw, player.pitch, frameDt);

  // ---- avatar ----
  playerModel.group.visible = !view.isFirstPerson && view.avatarOpacity > 0.02;
  if (playerModel.group.visible) {
    playerModel.setOpacity(view.avatarOpacity);
    playerModel.update({
      dt: frameDt,
      pos: player.pos,
      vel: player.vel,
      yaw: player.yaw,
      pitch: player.pitch,
      speed: player.horizontalSpeed,
      onGround: player.onGround,
      sneaking: player.sneaking,
      sprinting: player.sprinting,
    });
  }

  // ---- held block: corner placement + use swing ----
  if (heldSwing > 0) heldSwing = Math.max(0, heldSwing - frameDt * 4.5);
  positionHeldItem(heldSwing > 0 ? Math.sin((1 - heldSwing) * Math.PI) : 0);

  // ---- block targeting ----
  if (playing) {
    const dir = player.lookDirection();
    target = raycastVoxel(world, eye, dir, REACH);
    highlight.visible = Boolean(target);
    if (target) highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  } else {
    target = null;
    highlight.visible = false;
  }

  // ---- world edits ----
  worldRenderer.flushDirty();

  // ---- autosave ----
  if (saveNeeded && now - lastSaveAt > SAVE_DEBOUNCE) doSave();
  else if (playing && now - lastSaveAt > SAVE_INTERVAL) doSave();

  // ---- sun / sky follow player ----
  sun.position.set(player.pos.x + 60, 105, player.pos.z + 40);
  sun.target.position.copy(player.pos);
  sky.update(frameDt, player.pos);

  // ---- input mode: touch UI and cursor visibility ----
  document.body.classList.toggle('touch', input.usingTouch);
  document.body.classList.toggle('nocursor', playing && input.lookMode === LOOK_FREE);

  // ---- debug overlay ----
  const px = Math.floor(player.pos.x);
  const pz = Math.floor(player.pos.z);
  hud.updateDebug({
    pos: player.pos,
    pitchDeg: (player.pitch * 180) / Math.PI,
    yawDeg: player.facingDegrees(),
    speed: player.horizontalSpeed,
    mode: player.sneaking ? 'Sneaking' : player.sprinting ? 'Sprinting' : 'Walking',
    onGround: player.onGround,
    blockUnder: world.get(px, world.heightAt(px, pz), pz),
    target,
    targetId: target ? world.get(target.x, target.y, target.z) : 0,
    view: view.name,
    fps: Math.round(fpsSmooth),
    frameMs: frameMsSmooth,
    pixelScale: pixelRatio,
    inputMode: input.lookModeLabel,
    edits: world.edits.size,
  });

  renderer.render(scene, camera);

  // hide the loading screen once the first frame is on screen
  if (firstFrame) {
    firstFrame = false;
    loadingEl.classList.add('hidden');
    hud.showTitle(input, Boolean(restored));
    invUI.flashName();
  }
}

// ---------------- overlay / menu wiring ----------------
hud.overlayEl.addEventListener('pointerdown', (e) => {
  // Clicks on the menu itself operate the menu; the backdrop starts the game.
  if (e.target.closest('.panel')) return;
  e.preventDefault();
  startPlaying(e.pointerType === 'touch' ? 'touch' : 'mouse');
});

hud.bindMenu({
  onResume: (pointerType) => startPlaying(pointerType === 'touch' ? 'touch' : 'mouse'),
  onFullscreen: () => input.toggleFullscreen(),
  onRetryLock: () => {
    input.retryLock();
    startPlaying('mouse');
  },
  onReset: () => {
    savingDisabled = true;
    savegame.clear();
    location.reload();
  },
  onSetting: (key, value) => {
    setSetting(key, value);
    if (key === 'fov') camera.fov = settings.fov;
  },
});

document.addEventListener('pointerlockchange', () => {
  if (input.locked) {
    hud.hideOverlay();
    hud.refreshLookMode(input);
  } else if (!invUI.isOpen && input.sessionActive && input.lookMode !== LOOK_FREE && input.lookMode !== LOOK_TOUCH) {
    // Esc (or the browser) dropped the lock while playing with a locked mouse.
    pause();
  }
});

// Start with a key too (Magic Keyboard on iPad, or just convenience). Escape
// is excluded — it is the key that just paused the game — and so are keys
// aimed at the menu's own controls.
window.addEventListener('keydown', (e) => {
  if (!hud.overlayVisible || e.code === 'Escape' || e.metaKey || e.altKey || e.ctrlKey) return;
  if (e.target instanceof HTMLElement && e.target.closest('input, button, select, summary')) return;
  startPlaying('key');
});

// WebGL context lost (iOS reclaims memory in background tabs, etc.)
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  doSave();
  showFatal('The graphics context was lost (often caused by low memory). Tap Reload to continue.');
});

// ---------------- resize ----------------
window.addEventListener('resize', applyResolution);
window.addEventListener('orientationchange', () => setTimeout(applyResolution, 250));
window.visualViewport?.addEventListener('resize', applyResolution);
document.addEventListener('fullscreenchange', () => {
  hud.refreshLookMode(input);
  setTimeout(applyResolution, 60);
});

// ---------------- go ----------------
hud.initSettings(settings, LIMITS);
refreshHeldItem();
playerModel.group.visible = !view.isFirstPerson;
requestAnimationFrame(frame);
