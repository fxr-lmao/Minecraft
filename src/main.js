// Minecraft browser clone — entry point.
//
// Game loop: fixed 120 Hz physics (Minecraft-accurate movement constants),
// render at display refresh rate. Performance features:
//   - face-culled voxel meshing, one draw call per chunk via a shared atlas
//   - chunk streaming on a per-frame time budget, so walking never hitches
//   - adaptive render resolution that only gives up quality when the frame
//     rate is genuinely poor
//
// Everything that animates is driven by `animDt`, which is zero whenever the
// game is paused or a menu is open — a paused game is completely still.

import * as THREE from '../vendor/three.module.min.js';
import { World, AIR, BEDROCK, toChunk } from './world.js';
import { isWater, waterHeight, SEA_LEVEL } from './terrain.js';
import { WorldRenderer, buildSingleBlockGeometry } from './blocks.js';
import { Player } from './player.js';
import { Input, LOOK_FREE, LOOK_TOUCH } from './input.js';
import { WaterFlow, FLOW_INTERVAL_MS } from './water.js';
import { setCameraUnderwater, setSunDirection } from './water-shader.js';
import { WaterView, HELD_LAYER, WATER_QUALITY_NAMES } from './water-render.js';
import { installNativeBridge } from './native.js';
import { Hud } from './hud.js';
import { Inventory } from './inventory.js';
import { InventoryUI } from './inventory-ui.js';
import { ViewController } from './view.js';
import { createPlayerModel } from './player-model.js';
import { raycastVoxel, blockIntersectsPlayer } from './raycast.js';
import { createSky, FOG_COLOR } from './sky.js';
import { STARTER_BLOCKS, getAtlasTexture } from './textures.js';
import { settings, setSetting, LIMITS } from './settings.js';
import * as savegame from './savegame.js';
import {
  PHYSICS_DT, SPEED_WALK,
  PLAYER_WIDTH, PLAYER_EYE, REACH,
  CHUNK_SIZE, DATA_RADIUS,
} from './constants.js';
import { clamp, lerp } from './utils.js';

const MOUSE_SENSITIVITY = 0.0024; // multiplied by the player's setting
const TOUCH_SENSITIVITY = 0.006;
const USE_REPEAT = 0.22; // seconds between repeats while a use button is held
const SAVE_DEBOUNCE = 2000; // ms after an edit before writing to localStorage
const SAVE_INTERVAL = 20000; // ms between position-only saves
const PAUSED_FRAME_MS = 100; // redraw rate while paused (the image is frozen)

// ---------------- error / loading overlays ----------------
const fatalEl = document.getElementById('fatal');
const fatalMsg = document.getElementById('fatal-msg');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
let firstFrame = true;
let flowClock = 0; // ms of game time since the last water step

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
scene.fog = new THREE.Fog(FOG_COLOR, 40, 120);

const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 1000);
camera.rotation.order = 'YXZ';
scene.add(camera); // so the first-person held block (a camera child) renders

/**
 * Fog follows the render distance so terrain fades out instead of ending at
 * a visible edge. The far plane stays large and fixed: it has to contain the
 * sky dome, and clipping it to the render distance simply deleted the sky.
 * Nothing is drawn out there anyway — chunks beyond the render distance have
 * no mesh — so a distant far plane costs nothing.
 */
function applyRenderDistance() {
  const blocks = settings.renderDistance * CHUNK_SIZE;
  scene.fog.near = blocks * 0.55;
  scene.fog.far = blocks * 0.98;
  worldRenderer?.setRenderDistance(settings.renderDistance);
}

/** True when the camera itself is below the surface of some water. */
function cameraUnderwater() {
  const x = Math.floor(camera.position.x);
  const y = Math.floor(camera.position.y);
  const z = Math.floor(camera.position.z);
  const id = world.get(x, y, z);
  if (!isWater(id)) return false;
  return y + waterHeight(id, world.isWaterAt(x, y + 1, z)) >= camera.position.y;
}

/**
 * The height of the water surface the camera should mirror the world through.
 *
 * A planar reflection has exactly one plane, and a world can have water at
 * several heights at once — the sea, a pond up a hill, a waterfall on the way
 * between them. So it picks the surface nearest the camera by climbing or
 * falling a short way through the column it is in, and settles for sea level
 * when there is no water near enough to matter. Water at some other height
 * still reflects; it just reflects the sky, which is what it did before there
 * was a reflection pass at all.
 */
const PLANE_SEARCH = 12;
function waterPlaneNear(x, y, z) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const cy = Math.floor(y);
  for (let d = 0; d <= PLANE_SEARCH; d++) {
    for (const probe of d === 0 ? [cy] : [cy - d, cy + d]) {
      const id = world.get(cx, probe, cz);
      if (!isWater(id)) continue;
      if (world.isWaterAt(cx, probe + 1, cz)) continue; // not the free surface
      return probe + waterHeight(id, false);
    }
  }
  return SEA_LEVEL + 8 / 9;
}

/** Under water everything is blue and you cannot see far, as in Minecraft. */
const UNDERWATER_FOG = 0x1c3f8f;
let wasSubmerged = null;
function applyUnderwaterFog(submerged) {
  if (submerged === wasSubmerged) return;
  wasSubmerged = submerged;
  // With the water passes on, the composite absorbs light per channel over
  // the real distance to every pixel, which is a far better description of
  // being underwater than a fog colour is. Doing both would grade the same
  // frame twice, so the fog stands well back and only catches the far
  // distance the absorption has already taken care of.
  const graded = waterView.wantsRefraction;
  // The surface has to know which side of it you are on: from below there is
  // no sky to reflect, and the whole sky arrives through Snell's window
  // instead.
  setCameraUnderwater(submerged);
  // The held block is drawn in a pass of its own, after the water and after
  // the underwater grade, so it is the one thing in the frame the grade
  // cannot reach. Tint it by hand instead, or your arm stays in daylight
  // while the rest of the world is ten metres under.
  heldMaterial.color.setHex(submerged ? 0x6f9fc4 : 0xffffff);
  heldMaterial.emissive.setHex(submerged ? 0x25384a : 0x5a5a5a);
  if (submerged) {
    scene.fog.color.setHex(UNDERWATER_FOG);
    scene.fog.near = graded ? 30 : 0.5;
    scene.fog.far = graded ? 110 : 22;
    renderer.setClearColor(UNDERWATER_FOG);
  } else {
    scene.fog.color.setHex(FOG_COLOR);
    applyRenderDistance();
  }
  sky.setVisible(!submerged);
}

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
renderer.toneMappingExposure = 1.0;

// ---------------- lights ----------------
// A hemisphere light alone leaves vertical faces at about a third of the
// brightness of the tops, and ACES crushes that into near-black — which read
// as dark bands wherever distant hills showed you their sides. The ambient
// term puts a floor under every face; the sun is dialled back to keep the
// overall exposure where it was.
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x7a6a52, 0.75);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff2d9, 1.25);
sun.position.set(60, 100, 40);
// The water reflects the same sun the world is lit by, so it has to be told
// where it is. It never moves (no day cycle yet), hence once, here.
setSunDirection(60, 100, 40);
sun.castShadow = true;
let shadowMapSize = 2048;
sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
const s = 46; // shadows only cover the blocks near the player
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
const restored = savegame.load();

if (restored) {
  world.applyEdits(restored.edits);
  if (restored.inventory.slots.length === inventory.slots.length) {
    restored.inventory.slots.forEach((stack, i) => inventory.set(i, stack));
    inventory.select(restored.inventory.selected);
  }
  view.set(restored.view);
} else {
  inventory.fillStarterKit(STARTER_BLOCKS);
}

const worldRenderer = new WorldRenderer(world, scene);
applyRenderDistance();

// The water's own renderer: the off-screen passes that let the surface
// measure what is behind it and mirror what is above it. See water-render.js.
const waterView = new WaterView(renderer, { quality: settings.waterQuality });
waterView.useMaterials(worldRenderer.waterMaterials);

// Water settles from wherever the world was disturbed. Flowing water is never
// stored — it is a consequence of the terrain, not a decision — so anywhere
// the terrain has been changed has to be poked for the sea to find the hole
// again. That is true of the save file on load, and equally true of a chunk
// coming back into memory after being evicted, which is what the hook is for.
const waterFlow = new WaterFlow(world);
world.onEditReplayed = (x, y, z) => waterFlow.touch(x, y, z);
if (restored) for (const e of restored.edits) waterFlow.touch(e.x, e.y, e.z);

const player = new Player(world);
player.autoJump = settings.autoJump;
if (restored?.player) {
  player.pos.set(restored.player.x, restored.player.y, restored.player.z);
  player.yaw = restored.player.yaw ?? player.yaw;
  player.pitch = restored.player.pitch ?? player.pitch;
  // A v1 save came from the old flat world; the terrain under those
  // coordinates is now hilly, so drop the player onto the new surface.
  if (restored.migrated) {
    player.pos.y = world.spawnHeight(Math.floor(player.pos.x), Math.floor(player.pos.z)) + 0.01;
  }
}

const input = new Input(canvas);
// No-op in a browser; in the native iPad wrapper it hands pointer lock and
// raw trackpad deltas over to UIKit/GCMouse. See src/native.js and ipad-app/.
installNativeBridge(input);
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
// Every block shares the atlas material; only the UVs differ, so the
// geometry is what changes when you switch slots.
const heldGeometries = new Map();
const heldMaterial = new THREE.MeshLambertMaterial({
  map: getAtlasTexture(),
  emissiveMap: getAtlasTexture(),
  emissive: 0x5a5a5a, // never a black silhouette when the sun is behind you
});
const heldMesh = new THREE.Mesh(new THREE.BufferGeometry(), heldMaterial);
heldMesh.rotation.set(0.12, -0.6, 0.1);
heldMesh.visible = false;
heldMesh.frustumCulled = false;
// Off the default layer, so the mirrored camera does not find a block
// floating in the reflection where the player's hand would be.
heldMesh.layers.set(HELD_LAYER);
camera.add(heldMesh);

let heldId = -1;
let heldSwing = 0;

/**
 * Sync the block in the hand with the selected hotbar slot. Called every
 * frame: the selection can change from the number keys, the scroll wheel,
 * tapping a hotbar slot or dragging stacks in the inventory screen, and
 * missing any one of those routes leaves the wrong block in your hand.
 */
function refreshHeldItem() {
  const id = inventory.selectedId();
  if (id !== heldId) {
    heldId = id;
    if (id) {
      let geo = heldGeometries.get(id);
      if (!geo) {
        geo = buildSingleBlockGeometry(id);
        heldGeometries.set(id, geo);
      }
      heldMesh.geometry = geo;
    }
  }
  heldMesh.visible = view.isFirstPerson && heldId > 0;
  // The avatar carries the same block, so third person shows what you are
  // about to place instead of an empty fist.
  playerModel.setHeldItem(heldId > 0 ? heldMesh.geometry : null, heldMaterial);
}

/**
 * Size and pin the held block to the bottom-right corner whatever the aspect
 * ratio or FOV is — an iPad in portrait has a much narrower frustum than a
 * laptop, so fixed offsets would push the block off screen.
 */
function positionHeldItem(swingT) {
  const halfH = Math.tan((camera.fov * Math.PI) / 360) * HELD_DIST;
  const halfW = halfH * camera.aspect;
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
  waterFlow.touch(target.x, target.y, target.z);
  const left = inventory.add(id, 1);
  if (left > 0) hud.showStatus('Inventory full');
  invUI.render();
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
  // player.height, not the standing height: a swimmer is a 0.6 cube, and
  // refusing to place a block beside them because a hitbox they are not
  // currently using would have overlapped it is just baffling.
  if (blockIntersectsPlayer(bx, by, bz, player.pos, PLAYER_WIDTH, player.height)) return;
  world.setBlock(bx, by, bz, stack.id);
  waterFlow.touch(bx, by, bz);
  inventory.consumeSelected(1);
  invUI.render();
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
  saveNeeded = true;
}

input.onAction = (name, arg) => {
  if (name === 'lookmode') {
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
// The brief: aim high, but never trade real quality for a few frames. So the
// pixel scale only drops when the frame rate is genuinely bad (below 55) and
// climbs back as soon as there is headroom (above 85).
const FPS_LOW = 55;
const FPS_HIGH = 85;
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
let prevSwimming = false;
let eyeOffset = 0; // smooth sneak crouch
/**
 * The camera's height above the feet, eased. The player's own eye height
 * snaps between 1.62 standing and 0.4 swimming, and snapping the camera a
 * metre and a quarter down the moment you break into a crawl is jarring —
 * easing it reads as ducking under the surface.
 */
let eyeHeight = PLAYER_EYE;
let breakRepeat = 0;
let placeRepeat = 0;
let lastChunk = { cx: NaN, cz: NaN };

// ---------------- fixed-timestep loop ----------------
let acc = 0;
let lastTime = performance.now();
let lastDrawAt = 0;
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
  // Every animation runs off this. Paused means paused: no drifting clouds,
  // no swaying arms, no easing camera.
  const animDt = playing ? frameDt : 0;

  // A paused game renders an identical image every frame, so slow the redraw
  // right down instead of burning the GPU (and the battery) on it.
  if (!playing && !firstFrame && now - lastDrawAt < PAUSED_FRAME_MS) return;
  lastDrawAt = now;

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

  // ---- physics ----
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
    if (fpsSmooth < FPS_LOW && pixelRatio > 1 && resTimer > 2.5) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      applyResolution();
      if (pixelRatio <= 1.25) setShadowMapSize(1024);
      resTimer = 0;
    } else if (fpsSmooth > FPS_HIGH && pixelRatio < DPR_CAP && resTimer > 3) {
      pixelRatio = Math.min(DPR_CAP, pixelRatio + 0.25);
      applyResolution();
      if (pixelRatio > 1.25) setShadowMapSize(2048);
      resTimer = 0;
    }
  } else {
    resTimer = 0;
  }

  // ---- status messages on mode changes ----
  if (playing) {
    if (player.swimming && !prevSwimming) hud.showStatus('Swimming');
    else if (player.sprinting && !prevSprinting && !player.swimming) hud.showStatus('Sprinting');
    if (player.sneaking && !prevSneaking) hud.showStatus('Sneaking');
    prevSprinting = player.sprinting;
    prevSneaking = player.sneaking;
    prevSwimming = player.swimming;
  }

  // ---- chunk streaming ----
  // Nothing is interactive behind the loading screen, so fill the world as
  // fast as possible there and switch to a small per-frame slice afterwards
  // — 4 ms fits inside a 120 fps frame with room to spare.
  worldRenderer.budgetMs = firstFrame ? 30 : 4;
  const pcx = toChunk(player.pos.x);
  const pcz = toChunk(player.pos.z);
  worldRenderer.update(pcx, pcz);
  // Meshing distant chunks pulls their data (and their neighbours') into
  // memory; drop it again every frame so the resident set stays flat no
  // matter how far the render distance reaches.
  world.evictOutside(pcx, pcz, DATA_RADIUS);
  lastChunk = { cx: pcx, cz: pcz };
  world.tick();

  // ---- water ----
  // On the game clock, not the wall clock: paused means the sea stops too,
  // both the flow and the drift of the surface.
  worldRenderer.advanceWater(animDt);
  if (playing) {
    flowClock += frameDt * 1000;
    if (flowClock >= FLOW_INTERVAL_MS) {
      flowClock = 0;
      waterFlow.step(
        Math.floor(player.pos.x), Math.floor(player.pos.y), Math.floor(player.pos.z)
      );
    }
  }

  // The camera decides this, not the feet: leaning out of the water should
  // clear the blue even while you are still standing in it. It goes by the
  // water's actual surface, so a puddle you are wading through does not black
  // out the screen when you crouch.
  const submerged = cameraUnderwater();
  applyUnderwaterFog(submerged);
  waterView.underwater = submerged;
  waterView.planeY = waterPlaneNear(camera.position.x, camera.position.y, camera.position.z);

  // ---- camera ----
  const fovBase = settings.fov;
  const fovTarget = player.sprinting ? fovBase + 14 : player.sneaking ? fovBase - 10 : fovBase;
  camera.fov += (fovTarget - camera.fov) * Math.min(1, animDt * 10);
  camera.updateProjectionMatrix();

  // head bob (first person only)
  const speedFactor = clamp(player.horizontalSpeed / SPEED_WALK, 0, 1.35);
  player.bobPhase = (player.bobPhase || 0) + player.horizontalSpeed * animDt * 2.1;
  const bobTarget = view.isFirstPerson && player.onGround
    ? (player.sprinting ? 0.085 : 0.055) * speedFactor
    : 0;
  player.bobY = lerp(player.bobY || 0, Math.sin(player.bobPhase) * bobTarget, Math.min(1, animDt * 12));
  player.bobX = lerp(player.bobX || 0, Math.cos(player.bobPhase * 0.5) * bobTarget * 0.6, Math.min(1, animDt * 12));

  eyeOffset = lerp(eyeOffset, player.sneaking ? 0.16 : 0, Math.min(1, animDt * 12));
  eyeHeight = lerp(eyeHeight, player.eyeHeight, Math.min(1, animDt * 14));
  const right = player.rightVector();
  const eye = {
    x: player.pos.x + right.x * player.bobX,
    y: player.pos.y + eyeHeight - eyeOffset + player.bobY,
    z: player.pos.z + right.z * player.bobX,
  };
  view.apply(camera, world, eye, player.yaw, player.pitch, animDt);

  // ---- avatar ----
  playerModel.group.visible = !view.isFirstPerson && view.avatarOpacity > 0.02;
  if (playerModel.group.visible) {
    playerModel.setOpacity(view.avatarOpacity);
    playerModel.update({
      dt: animDt,
      pos: player.pos,
      vel: player.vel,
      yaw: player.yaw,
      pitch: player.pitch,
      speed: player.horizontalSpeed,
      onGround: player.onGround,
      sneaking: player.sneaking,
      sprinting: player.sprinting,
      swimming: player.swimming,
    });
  }

  // ---- held block: keep it in sync with the hotbar, place it, swing it ----
  refreshHeldItem();
  if (heldSwing > 0) heldSwing = Math.max(0, heldSwing - animDt * 4.5);
  positionHeldItem(heldSwing > 0 ? Math.sin((1 - heldSwing) * Math.PI) : 0);

  // ---- block targeting ----
  if (playing) {
    const dir = player.lookDirection();
    target = raycastVoxel(world, eye, dir, REACH);
    highlight.visible = Boolean(target);
    if (target) highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  } else if (!target) {
    highlight.visible = false;
  }

  // ---- autosave ----
  if (saveNeeded && now - lastSaveAt > SAVE_DEBOUNCE) doSave();
  else if (playing && now - lastSaveAt > SAVE_INTERVAL) doSave();

  // ---- sun / sky follow player ----
  sun.position.set(player.pos.x + 60, player.pos.y + 100, player.pos.z + 40);
  sun.target.position.copy(player.pos);
  sky.update(animDt, player.pos);

  // ---- input mode: touch UI and cursor visibility ----
  document.body.classList.toggle('touch', input.usingTouch);
  document.body.classList.toggle('nocursor', playing && input.lookMode === LOOK_FREE);

  // ---- debug overlay ----
  // Frozen along with everything else while paused: a ticking FPS counter on
  // a still image is exactly the "sort of paused" feeling we are removing.
  const px = Math.floor(player.pos.x);
  const pz = Math.floor(player.pos.z);
  if (playing) hud.updateDebug({
    pos: player.pos,
    pitchDeg: (player.pitch * 180) / Math.PI,
    yawDeg: player.facingDegrees(),
    speed: player.horizontalSpeed,
    mode: player.swimming ? 'Swimming'
      : player.sneaking ? 'Sneaking'
        : player.sprinting ? 'Sprinting' : 'Walking',
    onGround: player.onGround,
    blockUnder: world.get(px, Math.max(0, world.heightAt(px, pz)), pz),
    target,
    targetId: target ? world.get(target.x, target.y, target.z) : 0,
    view: view.name,
    fps: Math.round(fpsSmooth),
    frameMs: frameMsSmooth,
    pixelScale: pixelRatio,
    inputMode: input.lookModeLabel,
    edits: world.edits.size,
    biome: world.biomeAt(px, pz),
    inWater: player.inWater,
    submerged: player.submerged,
    flowing: waterFlow.pending.size,
    chunk: `${pcx} ${pcz}`,
    renderDistance: settings.renderDistance,
    meshes: worldRenderer.stats.meshes,
    queued: worldRenderer.stats.queued,
    loaded: world.chunks.size,
    geometryMB: worldRenderer.geometryMB,
    dataMB: (world.chunks.size * 65) / 1024,
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    waterQuality: WATER_QUALITY_NAMES[settings.waterQuality] ?? '?',
    waterMs: waterView.frameMs,
  });

  waterView.render(scene, camera, worldRenderer.hasWater);

  // The loading screen stays up until the chunks around spawn are meshed,
  // so the world never appears in front of you a piece at a time.
  if (firstFrame) {
    if (worldRenderer.ready) {
      firstFrame = false;
      loadingEl.classList.add('hidden');
      hud.showTitle(input, Boolean(restored));
      invUI.flashName();
    } else if (loadingText) {
      const total = worldRenderer.stats.meshes + worldRenderer.stats.queued;
      loadingText.textContent = `Generating world… ${worldRenderer.stats.meshes}/${total} chunks`;
    }
  }
}

// ---------------- overlay / menu wiring ----------------
hud.overlayEl.addEventListener('pointerdown', (e) => {
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
    if (key === 'renderDistance') applyRenderDistance();
    if (key === 'autoJump') player.autoJump = settings.autoJump;
    if (key === 'waterQuality') {
      waterView.setQuality(settings.waterQuality);
      wasSubmerged = null; // the fog depends on which passes are running
    }
  },
});

document.addEventListener('pointerlockchange', () => {
  if (input.locked) {
    hud.hideOverlay();
    hud.refreshLookMode(input);
  } else if (!invUI.isOpen && input.sessionActive && input.lookMode !== LOOK_FREE && input.lookMode !== LOOK_TOUCH) {
    pause();
  }
});

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

