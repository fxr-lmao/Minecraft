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
import { World, AIR, BEDROCK, ICE, CRAFTING_TABLE, FURNACE, TNT, toChunk } from './world.js';
import { isWater, waterHeight, SEA_LEVEL } from './terrain.js';
import { WorldRenderer, buildSingleBlockGeometry } from './blocks.js';
import { FirstPersonHand, warmItemModels } from './held-item.js';
import { Drops, throwAlong } from './drops.js';
import { DropsRenderer } from './drops-render.js';
import { Player } from './player.js';
import { Input, LOOK_FREE, LOOK_TOUCH, playSource } from './input.js';
import { WaterFlow, Freeze, FLOW_INTERVAL_MS, FREEZE_INTERVAL_MS } from './water.js';
import { setCameraUnderwater, setSunDirection, setWaterOvercast } from './water-shader.js';
import { WaterView, HELD_LAYER, WATER_QUALITY_NAMES } from './water-render.js';
import { Particles } from './particles.js';
import { Weather, SNOWING } from './weather.js';
import { isItem, useBucket, fluidAim } from './items.js';
import { breakTime, dropsFrom, wrongTool, toolNeeded } from './mining.js';
import { installNativeBridge } from './native.js';
import { Hud } from './hud.js';
import { Inventory } from './inventory.js';
import { InventoryUI } from './inventory-ui.js';
import { ViewController } from './view.js';
import { createPlayerModel } from './player-model.js';
import { raycastVoxel, blockIntersectsPlayer } from './raycast.js';
import { createSky, FOG_COLOR } from './sky.js';
import { STARTER_BLOCKS, getAtlasTexture, getCrackStages, crackStage, blockTint } from './textures.js';
import { GameMode } from './gamemode.js';
import { XpBar, xpForBlock } from './xp.js';
import { FurnaceStore } from './furnace.js';
import { FurnaceUI } from './furnace-ui.js';
import { FuseTracker, blastBlocks } from './tnt.js';
import { spendDurability, isTool } from './durability.js';
import * as sound from './sound.js';
import { settings, setSetting, LIMITS } from './settings.js';
import * as savegame from './savegame.js';
import {
  PHYSICS_DT, SPEED_WALK,
  PLAYER_WIDTH, PLAYER_EYE, REACH,
  CHUNK_SIZE, DATA_RADIUS,
  MAX_HEALTH, MAX_AIR,
} from './constants.js';
import { clamp, lerp, smoothstep } from './utils.js';

const MOUSE_SENSITIVITY = 0.0024; // multiplied by the player's setting
const TOUCH_SENSITIVITY = 0.006;
const USE_REPEAT = 0.22; // seconds between repeats while the place button is held
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
let freezeClock = 0; // and since the last freeze step, which is slower

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
/**
 * What rain does to the light.
 *
 * Everything here is a multiplier on the clear-sky value rather than a
 * second set of numbers, so there is exactly one place that decides how
 * bright a clear day is. The sun loses more than half of itself, the sky
 * loses a little, and the fog closes in and goes grey — which is the part
 * that sells it, because the far chunks fading into an overcast horizon is
 * what makes the weather look like it is happening to the whole world rather
 * than to the twenty blocks with droplets in them.
 */
const RAIN_FOG = new THREE.Color(0x8e9aa6);
const CLEAR_FOG = new THREE.Color(FOG_COLOR);
const DAY_FOG = new THREE.Color(FOG_COLOR);
const NIGHT_FOG = new THREE.Color(0x0b0f22);

/**
 * What time of day does to the light.
 *
 * The sky has a clock now, and a dome that goes dark at midnight over a
 * world lit like noon is worse than no cycle at all. So the *clear-sky*
 * values are no longer constants — they are whatever the clock says — and
 * `applyWeather` still multiplies rain on top of them, which keeps one place
 * deciding how bright a clear day is.
 */
let clearSun = 1.25;
let clearHemi = 0.75;
let clearAmbient = 0.45;

function applyDaylight() {
  // Daylight comes off the sun's elevation alone, not off `lightLevel`.
  // That sum includes the moon, and the moon rises faster than the sun sets
  // — so mixing on it made midnight *brighter* than dusk, which is the one
  // thing a day/night cycle must never do. The moon is the floor under this
  // curve instead, which is what moonlight actually is.
  const day = clamp(smoothstep(-0.12, 0.45, sky.sunDir.y), 0, 1);
  clearSun = lerp(0.03, 1.25, day);
  clearHemi = lerp(0.08, 0.75, day);
  clearAmbient = lerp(0.07, 0.45, day);
  CLEAR_FOG.lerpColors(NIGHT_FOG, DAY_FOG, day);
  // The key light follows whichever body is up, so the world still has a
  // direction to be lit from after dark — a dim one, from the moon. Letting
  // the sun sink below the floor instead would light everything from beneath.
  const dir = sky.sunDir;
  const up = dir.y > -0.05;
  const key = up ? dir : { x: -dir.x, y: -dir.y, z: -dir.z };
  sun.position.set(
    player.pos.x + key.x * 120,
    player.pos.y + key.y * 120,
    player.pos.z + key.z * 120
  );
  sun.target.position.copy(player.pos);
  // The water reflects the same sun the world is lit by, so it moves too.
  setSunDirection(key.x, key.y, key.z);
}

function applyWeather(level, submerged) {
  sky.setOvercast(level);
  setWaterOvercast(level);
  sun.intensity = clearSun * (1 - 0.58 * level);
  hemi.intensity = clearHemi * (1 - 0.22 * level);
  ambient.intensity = clearAmbient * (1 - 0.12 * level);
  if (submerged) return; // down there the water grade owns the fog
  scene.fog.color.lerpColors(CLEAR_FOG, RAIN_FOG, level);
  const blocks = settings.renderDistance * CHUNK_SIZE;
  scene.fog.near = blocks * (0.55 - 0.18 * level);
  scene.fog.far = blocks * (0.98 - 0.26 * level);
}

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
  hand.setUnderwater(submerged);
  if (submerged) {
    scene.fog.color.setHex(UNDERWATER_FOG);
    scene.fog.near = graded ? 30 : 0.5;
    scene.fog.far = graded ? 110 : 22;
    renderer.setClearColor(UNDERWATER_FOG);
  } else {
    scene.fog.color.copy(CLEAR_FOG);
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
// A starting position only. There is a day cycle now, so `applyDaylight`
// moves this light — and tells the water where it went — every frame.
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

/** Survival or creative. Everything that changes with it reads these flags. */
const gameMode = new GameMode();
/** Points and levels, earned by mining ore. */
const xp = new XpBar();
/** What every furnace in the world is doing; saved with it. */
const furnaces = new FurnaceStore();
/** Which TNT blocks are burning. Transient — a lit fuse dies with the page. */
const fuses = new FuseTracker();

const restored = savegame.load();

if (restored) {
  world.applyEdits(restored.edits);
  if (restored.inventory.slots.length === inventory.slots.length) {
    restored.inventory.slots.forEach((stack, i) => inventory.set(i, stack));
    inventory.select(restored.inventory.selected);
  }
  if (restored.inventory.craft) {
    restored.inventory.craft.forEach((cell, i) => {
      if (i < inventory.craftGrid.cells.length) inventory.craftGrid.cells[i] = cell;
    });
  }
  furnaces.fromJSON(restored.furnaces);
  xp.fromJSON(restored.xp);
  gameMode.setCreative(restored.mode === 1);
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
// Attaches itself to the flow, which forwards every cell it touches: water
// that has just arrived somewhere cold is the case the freeze waits for.
const iceSheet = new Freeze(world, waterFlow);
// The other half of the water: the part that arrives from above. One clock
// for the whole world, and the climate decides per column whether what falls
// out of it is rain or snow.
const weather = new Weather();
world.onEditReplayed = (x, y, z) => waterFlow.touch(x, y, z);
if (restored) for (const e of restored.edits) waterFlow.touch(e.x, e.y, e.z);

// Splashes, spray, bubbles and wake. On the default layer, so the refraction
// pass picks them up and the water composites correctly around them.
const particles = new Particles(scene);

/**
 * The things lying on the floor.
 *
 * Two objects, deliberately: `drops` is the simulation and knows nothing
 * about THREE, `dropsRenderer` is one InstancedMesh per distinct id and knows
 * nothing about the rules. The one thing they share is a list of positions.
 */
const drops = new Drops();

const player = new Player(world);
player.autoJump = settings.autoJump;
if (restored?.player) {
  player.pos.set(restored.player.x, restored.player.y, restored.player.z);
  player.yaw = restored.player.yaw ?? player.yaw;
  player.pitch = restored.player.pitch ?? player.pitch;
  // Saves from before there was anything to survive have neither, and a
  // player restored from one starts whole rather than at zero hit points.
  if (Number.isFinite(restored.player.health) && restored.player.health > 0) {
    player.health = Math.min(MAX_HEALTH, restored.player.health);
  }
  if (Number.isFinite(restored.player.air)) {
    player.air = Math.min(MAX_AIR, restored.player.air);
  }
  // A v1 save came from the old flat world; the terrain under those
  // coordinates is now hilly, so drop the player onto the new surface.
  if (restored.migrated) {
    player.pos.y = world.spawnHeight(Math.floor(player.pos.x), Math.floor(player.pos.z)) + 0.01;
  }
}
// A world saved in creative comes back in creative, so the flags the player
// reads have to agree with the mode before the first frame runs.
player.invulnerable = gameMode.invulnerable();
player.flying = gameMode.flying;

const input = new Input(canvas);
// No-op in a browser; in the native iPad wrapper it hands pointer lock and
// raw trackpad deltas over to UIKit/GCMouse. See src/native.js and ipad-app/.
installNativeBridge(input);
const hud = new Hud();
const sky = createSky(scene);
const invUI = new InventoryUI(inventory, (open) => onInventoryToggle(open));
const furnaceUI = new FurnaceUI(furnaces, inventory, (open) => onInventoryToggle(open));

/** Either panel being up means the world is not taking input. */
const screenOpen = () => invUI.isOpen || furnaceUI.isOpen;

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

/**
 * The crack laid over the block being dug.
 *
 * A cube a whisker larger than the block, with the crack stages as its map
 * and nothing else: it is drawn after the world, writes no depth, and is
 * pushed a hair towards the camera so it cannot z-fight the face it is
 * describing. One mesh, moved to wherever the digging is.
 */
const crackTextures = getCrackStages().map((url) => {
  const tex = new THREE.TextureLoader().load(url);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
});
const crackMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1.004, 1.004, 1.004),
  new THREE.MeshBasicMaterial({
    map: crackTextures[0],
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
);
crackMesh.visible = false;
scene.add(crackMesh);

let target = null; // { x, y, z, nx, ny, nz } from the last frame
/** Where the camera was looking from last frame — items aim from here too. */
let lastEye = { x: 0, y: 0, z: 0 };

// ---------------- first-person held item ----------------
//
// This used to be one mesh, one material and a lot of trigonometry: an item
// was a flat sprite pinned to the corner of the screen and rotated by the
// swing, with the pinning and the animation sharing the same three numbers.
// It worked for blocks, which are cubes and look like cubes from anywhere,
// and it fell apart for everything else — a sprite has no thickness, so
// turning it edge-on made the tool vanish, and the avatar holding the same
// sprite side-on held a line.
//
// Now the models are solid (held-geometry.js), the poses are data
// (item-models.js), and the rig that holds them is a two-level group so the
// swing is a rotation about a wrist rather than an offset bolted onto the
// pinning maths. What is left here is the wiring.
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

/**
 * The hand. Off the default layer, so the mirrored camera does not find a
 * pickaxe floating in the reflection where the player's arm would be.
 */
const hand = new FirstPersonHand(camera, { layer: HELD_LAYER });

let heldId = -1;

/** The unit cube for a block id, built once and kept. */
function blockGeometryFor(id) {
  let geo = heldGeometries.get(id);
  if (!geo) {
    geo = buildSingleBlockGeometry(id);
    heldGeometries.set(id, geo);
  }
  return geo;
}

/**
 * Sync what is in the hand with the selected hotbar slot. Called every
 * frame: the selection can change from the number keys, the scroll wheel,
 * tapping a hotbar slot or dragging stacks in the inventory screen, and
 * missing any one of those routes leaves the wrong thing in your hand.
 */
function refreshHeldItem() {
  const id = inventory.selectedId();
  if (id !== heldId) {
    heldId = id;
    const geo = id && !isItem(id) ? blockGeometryFor(id) : null;
    hand.setItem(id, geo, heldMaterial);
    // The avatar carries the same thing, so third person shows what you are
    // about to use instead of an empty fist.
    playerModel.setHeldItem(id, geo, heldMaterial);
  }
  hand.setVisible(view.isFirstPerson && heldId > 0);
}

function swingHand() {
  hand.strike();
  playerModel.swingArm();
  sound.playSwing();
}

/**
 * The renderer for the drops, which needs the block-cube builder and the
 * atlas material — so it is made here, after both exist, rather than up with
 * the simulation.
 */
const dropsRenderer = new DropsRenderer(scene, blockGeometryFor, heldMaterial);

/**
 * Pick a drop up. Returns how many items actually went in, which is what
 * lets a full inventory leave the rest of the stack on the floor rather than
 * swallowing it.
 */
function collectDrop(drop) {
  const stack = drop.toStack();
  // A tool carries its durability, so it goes into a slot of its own rather
  // than through `add`, which merges by id and would repair it to full.
  if (stack.durability !== undefined) {
    const free = inventory.slots.findIndex((sl) => !sl);
    if (free < 0) return 0;
    inventory.set(free, stack);
    onPickedUp(stack.id, 1);
    return 1;
  }
  const left = inventory.add(stack.id, stack.count);
  const took = stack.count - left;
  if (took > 0) onPickedUp(stack.id, took);
  return took;
}

/** Common bookkeeping for anything that lands in the inventory. */
function onPickedUp(id, count) {
  invUI.render();
  sound.playPickup();
  hud.showPickup(id, count);
  saveNeeded = true;
}

/**
 * Throw the selected stack on the floor.
 *
 * Minecraft's Q drops one and Ctrl+Q drops the lot, and both are worth
 * having: one is how you get rid of the cobblestone you did not want, and the
 * lot is how you clear a slot. It goes where you are looking, hard enough to
 * clear your own pickup radius, or it would come straight back.
 */
function dropSelected(whole = false) {
  const stack = inventory.selectedStack();
  if (!stack) {
    hud.showStatus('Nothing in hand');
    return;
  }
  const count = whole ? stack.count : 1;
  const dir = player.lookDirection();
  const eye = { x: lastEye.x, y: lastEye.y - 0.2, z: lastEye.z };
  const d = drops.add(
    eye.x + dir.x * 0.4, eye.y + dir.y * 0.4, eye.z + dir.z * 0.4,
    stack.id, count, stack.durability
  );
  if (!d) {
    hud.showStatus('Too much on the floor already');
    return;
  }
  throwAlong(d, dir);
  if (whole || stack.count <= 1) inventory.set(inventory.selected, null);
  else inventory.consumeSelected(1);
  invUI.render();
  swingHand();
  saveNeeded = true;
}

// ---------------- saving ----------------
let saveNeeded = false;
let lastSaveAt = performance.now();
/** Set while resetting: reloading fires pagehide, which would re-save the
 *  world we just deleted and make "Reset world" do nothing. */
let savingDisabled = false;

function doSave() {
  if (savingDisabled) return;
  savegame.save({
    world, inventory, player, viewMode: view.mode,
    furnaces: furnaces.toJSON(), xp: xp.toJSON(),
    mode: gameMode.isCreative ? 1 : 0,
  });
  saveNeeded = false;
  lastSaveAt = performance.now();
}

// Backgrounding a tab on iPadOS can discard it outright, so flush on the way out.
window.addEventListener('pagehide', () => doSave());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') doSave();
});

// ---------------- interaction ----------------
/**
 * What is being dug, and how far in.
 *
 * Breaking used to be instant, which made a mountain something you deleted
 * rather than something you mined. Now it is a stopwatch against
 * `breakTime`, and the only state it needs is *which* block — point somewhere
 * else and the progress is gone, because you have stopped digging that one.
 */
let mining = null; // { x, y, z, id, fraction, told }
let swingClock = 0;

/** Stop digging, and take the crack off whatever was being dug. */
function stopMining() {
  mining = null;
  crackMesh.visible = false;
}

/**
 * Hold the button down and this runs every frame. It is the whole of digging:
 * the same block for long enough and it comes out.
 *
 * What is kept is the *fraction*, not the seconds, because how long the block
 * takes is not a constant for as long as you are digging it. Minecraft asks
 * again every tick, and docks you four fifths of your speed for having your
 * feet off the ground and four fifths again for having your head under water
 * — so jumping in the middle of a dig has to slow the dig down while you are
 * in the air, and adding up seconds against a number fixed when you started
 * could not do that.
 */
function mine(dt) {
  if (!target) return stopMining();
  const id = world.get(target.x, target.y, target.z);
  if (id === AIR || isWater(id)) return stopMining();

  if (!mining || mining.x !== target.x || mining.y !== target.y || mining.z !== target.z
      || mining.id !== id) {
    mining = { x: target.x, y: target.y, z: target.z, id, fraction: 0, told: false };
    swingClock = 0;
  }

  const held = inventory.selectedStack()?.id ?? 0;
  // Creative does not dig, it deletes: one frame, whatever the block.
  if (gameMode.instantBreak()) {
    breakBlock();
    stopMining();
    return;
  }
  const need = breakTime(id, held, {
    onGround: player.onGround,
    underwater: player.submerged,
  });

  if (!Number.isFinite(need)) {
    // Bedrock. Say so once rather than every frame the button is held.
    if (!mining.told) hud.showStatus('Bedrock cannot be broken');
    mining.told = true;
    return;
  }

  mining.fraction += need > 0 ? dt / need : 1;
  // The arm keeps swinging while you dig, at Minecraft's rate.
  swingClock -= dt;
  if (swingClock <= 0) {
    swingClock = 0.32;
    swingHand();
  }

  if (mining.fraction >= 1) {
    breakBlock();
    stopMining();
    return;
  }
  crackMesh.visible = true;
  crackMesh.position.set(mining.x + 0.5, mining.y + 0.5, mining.z + 0.5);
  crackMesh.material.map = crackTextures[crackStage(mining.fraction)];
}

function breakBlock() {
  if (!target) return;
  const id = world.get(target.x, target.y, target.z);
  if (id === AIR) return;
  if (id === BEDROCK) {
    hud.showStatus('Bedrock cannot be broken');
    swingHand();
    return;
  }
  // Ice is not a block you can carry — that needs Silk Touch, and there is
  // none here — and it was never a block anyone *placed* either: it is
  // written transiently, like flowing water, so breaking it puts the water
  // back rather than recording a hole in the sea.
  if (id === ICE) {
    iceSheet.chip(target.x, target.y, target.z);
    hud.showStatus('Ice melts in your hand');
    swingHand();
    return;
  }
  const held = inventory.selectedStack()?.id ?? 0;
  world.setBlock(target.x, target.y, target.z, AIR);
  waterFlow.touch(target.x, target.y, target.z);

  // The block comes apart: a burst of chips in its own colours, and the
  // sound of whatever it was made of.
  particles.blockBreak(target.x + 0.5, target.y + 0.5, target.z + 0.5, blockTint(id), 14);
  sound.playBlockBreak(id);

  // A furnace is a container: breaking it has to give back what was inside,
  // or the sand you left smelting is gone with the block.
  if (id === FURNACE && furnaces.has(target.x, target.y, target.z)) {
    const f = furnaces.get(target.x, target.y, target.z);
    for (const stack of [f.input, f.fuel, f.output]) {
      if (stack && stack.count > 0) {
        // Out onto the floor with everything else, rather than into your
        // pocket: a furnace full of iron broken by someone with no room used
        // to swallow the lot.
        drops.spawnFromBlock(target.x, target.y, target.z, stack.id, stack.count, stack.durability);
      }
    }
    furnaces.delete(target.x, target.y, target.z);
    if (furnaceUI.isOpen && furnaceUI.current
      && furnaceUI.current.x === target.x && furnaceUI.current.y === target.y
      && furnaceUI.current.z === target.z) {
      furnaceUI.close();
    }
  }
  // Digging out a lit charge puts it out, which is the only defusing there is.
  if (id === TNT) fuses.map.delete(fuses.key(target.x, target.y, target.z));

  // Creative takes nothing and costs nothing: no drops, no wear, no XP. It is
  // the same split Minecraft draws, and the reason blocks are infinite there.
  if (gameMode.isCreative) {
    invUI.render();
    swingHand();
    saveNeeded = true;
    return;
  }

  // What it leaves behind is the mining rules' business, not this function's:
  // ore broken without a pickaxe is gone rather than collected, which is the
  // one thing that makes carrying the pickaxe matter.
  //
  // And it leaves it *on the floor* now rather than in your pocket. That is
  // one line here and a real change everywhere else: a full inventory used to
  // destroy the block (dig a diamond seam with no room and the diamonds were
  // simply gone), and now it does not — the drop lies there until you make
  // space. See drops.js.
  const drop = dropsFrom(id, held);
  if (!drop) {
    if (wrongTool(id, held)) hud.showStatus(`You need a ${toolNeeded(id)} for that`);
  } else {
    drops.spawnFromBlock(target.x, target.y, target.z, drop, 1);
  }

  // Ore pays experience, and the deepslate twin pays the same as its stone
  // original — it is the same ore, just further down.
  const gained = xpForBlock(id);
  if (gained > 0 && xp.add(gained) > 0) hud.showStatus(`Level ${xp.level}`);

  // The tool spends a use on the block, and the last use breaks it.
  spendTool();

  invUI.render();
  swingHand();
  saveNeeded = true;
}

/**
 * Wear the held tool by one use. A tool that runs out disappears out of your
 * hand mid-dig, which is Minecraft's rule and the reason a spare matters.
 */
function spendTool() {
  const stack = inventory.selectedStack();
  if (!stack || !isTool(stack.id)) return;
  const { stack: next, broke } = spendDurability(stack);
  inventory.set(inventory.selected, next);
  if (broke) hud.showStatus('Your tool broke');
}

/**
 * Right-clicking a block that does something, rather than placing against it.
 * Returns true when the block handled the click and nothing should be placed.
 */
function useBlock(id, x, y, z) {
  if (id === CRAFTING_TABLE) {
    invUI.setCraftingSize(3, 3);
    invUI.open();
    return true;
  }
  if (id === FURNACE) {
    furnaceUI.open(x, y, z);
    return true;
  }
  if (id === TNT) {
    if (!fuses.isLit(x, y, z)) {
      fuses.light(x, y, z);
      hud.showStatus('Fuse lit');
      sound.playBlockPlace(TNT);
    }
    return true;
  }
  return false;
}

function placeBlock() {
  // A block that does something answers the click itself. This comes before
  // the empty-hand check on purpose: opening a crafting table with nothing
  // in your hands is the normal way to open one.
  if (target) {
    const hit = world.get(target.x, target.y, target.z);
    if (useBlock(hit, target.x, target.y, target.z)) return;
  }
  const stack = inventory.selectedStack();
  if (!stack) {
    hud.showStatus('Nothing in hand');
    return;
  }
  // An item is used, not placed. It never reaches world.setBlock, which is
  // the whole reason items have their own range of ids.
  if (isItem(stack.id)) {
    useHeldItem(stack);
    return;
  }
  if (!target) return;
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
  sound.playBlockPlace(stack.id);
  // Blocks never run out in creative — that is most of what creative is.
  if (!gameMode.infiniteBlocks()) inventory.consumeSelected(1);
  invUI.render();
  swingHand();
  saveNeeded = true;
}

/**
 * Use whatever is in hand on whatever the crosshair found.
 *
 * Buckets aim with their own raycast, because the one that drives block
 * targeting goes straight through water on purpose — you build *in* the
 * shallows — and a bucket that could not see the sea would be useless.
 */
function useHeldItem(stack) {
  const dir = player.lookDirection();
  const aim = fluidAim(stack.id);
  const hit = aim
    ? raycastVoxel(world, lastEye, dir, REACH, { fluids: aim })
    : target;
  const result = useBucket(world, hit, stack.id);
  if (!result) return;
  swingHand();
  if (result.item === undefined) {
    if (result.message) hud.showStatus(result.message);
    return;
  }
  // Pouring water where the player is standing would drown them in their own
  // bucket; Minecraft allows it, but Minecraft also lets you swim out.
  if (result.block !== AIR
    && blockIntersectsPlayer(result.x, result.y, result.z, player.pos, PLAYER_WIDTH, player.height)) {
    hud.showStatus('Not on top of yourself');
    return;
  }
  world.setBlock(result.x, result.y, result.z, result.block);
  waterFlow.touch(result.x, result.y, result.z);
  inventory.set(inventory.selected, { id: result.item, count: stack.count });
  invUI.render();
  if (result.message) hud.showStatus(result.message);
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

/**
 * A charge goes off: the block itself is spent, everything inside the blast
 * that can be moved is gone, and any other charge caught in it lights rather
 * than vanishing — which is what makes a stack of them a chain.
 *
 * Nothing drops. A three-block sphere is a hundred-odd blocks, and posting
 * all of it into a 36-slot inventory is not a reward, it is a mess.
 */
function explode(x, y, z) {
  world.setBlock(x, y, z, AIR);
  waterFlow.touch(x, y, z);
  const hit = blastBlocks(world, x, y, z);
  for (const b of hit) {
    if (b.id === TNT) {
      fuses.light(b.x, b.y, b.z);
      continue;
    }
    if (b.id === FURNACE) furnaces.delete(b.x, b.y, b.z);
    world.setBlock(b.x, b.y, b.z, AIR);
    waterFlow.touch(b.x, b.y, b.z);
    if (Math.random() < 0.25) {
      particles.blockBreak(b.x + 0.5, b.y + 0.5, b.z + 0.5, blockTint(b.id), 3);
    }
    // A blast used to leave nothing at all, and the reason given was that a
    // hundred blocks will not fit in a 36-slot inventory. True — but on the
    // floor they fit fine, and a crater with its rubble in it is a great deal
    // more satisfying than a crater with nothing in it. Minecraft's own drop
    // chance for an explosion is 1/radius, which at radius 3 is a third.
    const dropped = gameMode.isCreative ? 0 : dropsFrom(b.id, PICKAXE);
    if (dropped && Math.random() < 0.34) {
      drops.spawnFromBlock(b.x, b.y, b.z, dropped, 1);
    }
  }
  particles.blockBreak(x + 0.5, y + 0.5, z + 0.5, [0.95, 0.75, 0.35], 20);
  particles.dustPuff(x + 0.5, y + 0.5, z + 0.5, 10);
  sound.playThunder();
  // Standing next to your own charge is a mistake with a cost.
  const dx = player.pos.x - (x + 0.5);
  const dy = player.pos.y - (y + 0.5);
  const dz = player.pos.z - (z + 0.5);
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 5) player.hurt(Math.round((1 - dist / 5) * 14), 'blown up');
  saveNeeded = true;
}

// ---------------- menus / pausing ----------------
/**
 * Survival <-> creative. Everything downstream reads the flags rather than
 * being told, so this only has to flip them and say so.
 */
function toggleGameMode() {
  gameMode.toggle();
  player.flying = gameMode.flying;
  player.invulnerable = gameMode.invulnerable();
  hud.refreshMode(gameMode);
  hud.showStatus(gameMode.name);
  saveNeeded = true;
}

function onInventoryToggle(open) {
  input.setEnabled(!open);
  hud.setCrosshairVisible(!open);
  if (open) {
    input.releasePointerOnly();
  } else {
    // The 3x3 belongs to the crafting table you were standing at; walking
    // away puts the grid back to the 2x2 you carry, and anything in the
    // cells that no longer exist comes back to the inventory.
    invUI.setCraftingSize(2, 2);
    if (!hud.overlayVisible) {
      input.resumePointer();
      saveNeeded = true;
    }
  }
}

function pause() {
  input.release();
  doSave();
  hud.showPause(input);
}

let hasPlayed = false;

function startPlaying(source) {
  // The death screen's button is the same button, and it has one more job:
  // there is no game to go back to until the player is alive again.
  if (player.dead) {
    player.respawn();
    particles.clear();
    saveNeeded = true;
  }
  input.start(source);
  if (input.active) {
    hasPlayed = true;
    hud.hideOverlay();
  }
}

/**
 * Died. The overlay says what it was and offers the way back; everything else
 * follows from `playing` going false, which is the same thing the pause menu
 * does — the world keeps its state, the clock stops, and nothing moves.
 */
function die() {
  input.release();
  doSave();
  hud.showDeath(player.death);
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
      if (furnaceUI.isOpen) furnaceUI.close();
      else if (invUI.isOpen) invUI.close();
      else pause();
      break;
    case 'view':
      cycleView();
      break;
    case 'debug':
      hud.toggleDebug();
      break;
    case 'gamemode':
      toggleGameMode();
      break;
    case 'fly':
      if (gameMode.toggleFlying()) hud.showStatus('Flying');
      else if (gameMode.isCreative) hud.showStatus('Falling');
      player.flying = gameMode.flying;
      sound.setFlightWind(gameMode.flying);
      hud.refreshMode(gameMode);
      break;
    case 'slot':
      if (!screenOpen()) invUI.selectSlot(arg);
      break;
    case 'scroll':
      if (!screenOpen()) invUI.scrollSelection(arg);
      break;
    case 'zoom':
      if (!view.isFirstPerson) hud.showStatus(`Camera distance ${view.zoom(arg).toFixed(1)}`);
      break;
    case 'break':
      // A tap starts digging; the frame loop finishes it. Nothing comes out
      // of the world in one frame any more except what takes no time at all.
      if (!screenOpen()) mine(0);
      break;
    case 'place':
      if (!screenOpen()) placeBlock();
      break;
    case 'pick':
      if (!screenOpen()) pickBlock();
      break;
    case 'drop':
      // Q throws one, Ctrl+Q (or Shift+Q) throws the stack.
      if (!screenOpen()) dropSelected(Boolean(arg));
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
let placeRepeat = 0;
let lastClock = null;
/**
 * Seconds of *unpaused* game time since the page loaded.
 *
 * Everything that animates on its own clock reads this rather than
 * performance.now(), which is the rule the whole game is built on: paused
 * means paused, down to the drifting clouds and the spin of an item lying on
 * the floor. It is advanced by animDt, which is zero while a menu is up.
 */
let worldClock = 0;
let stepClock = 0;      // distance walked since the last footstep
let lastHealth = MAX_HEALTH;
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
  worldClock += animDt;

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
  // How fast we were falling *before* the step that puts us in the water:
  // the moment the water has hold of you it has already taken most of it
  // away, and the splash is a picture of the impact, not of the aftermath.
  const fallSpeed = Math.max(0, -player.vel.y);
  const wasInWater = player.inWater;
  if (playing) {
    acc += frameDt;
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 8) {
      step(PHYSICS_DT);
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps === 8) acc = 0; // drop backlog on huge hitches
    // Drowning and falling are the only two things that can do this, and both
    // of them happen inside the physics steps above.
    if (player.dead && !hud.overlayVisible) die();
  } else {
    acc = 0;
  }

  // Hearts and bubbles. Drawn whenever there is a world to be hurt in, which
  // is any time the title screen is not up.
  hud.setVitals(player.health, player.air, hasPlayed);
  hud.setXp(xp.fraction, xp.level);
  hud.refreshMode(gameMode);
  // The clock changes once a minute of game time; no reason to write the DOM
  // sixty times a second for it.
  const clockNow = hasPlayed ? sky.clock : '';
  if (clockNow !== lastClock) {
    lastClock = clockNow;
    hud.setClock(clockNow);
  }

  // ---- water in the air ----
  if (playing && !wasInWater && player.inWater && fallSpeed > 1.5) {
    const top = player.waterTop === -Infinity ? player.pos.y : player.waterTop;
    particles.splash(player.pos.x, top, player.pos.z, fallSpeed);
    sound.playSplash(fallSpeed);
  }

  // Anything that took health off you makes a noise about it. Drowning has
  // its own, because it is the one that starts while you cannot see why.
  if (playing && player.health < lastHealth) {
    if (player.submerged && player.air <= 0) sound.playDrown();
    else sound.playHurt();
  }
  lastHealth = player.health;

  // Footsteps are spaced by distance, not by time, so they slow down when you
  // do instead of turning into a drum roll when you sprint.
  if (playing && player.onGround && !player.flying) {
    stepClock += player.horizontalSpeed * frameDt;
    if (stepClock >= 2.2) {
      stepClock = 0;
      const gy = Math.floor(player.pos.y) - 1;
      sound.playStep(world.get(Math.floor(player.pos.x), gy, Math.floor(player.pos.z)));
    }
  } else {
    stepClock = 0;
  }
  particles.followPlayer(animDt, player);
  particles.scanFalls(animDt, world, player.pos.x, player.pos.y, player.pos.z);
  // Weather is spawned around the *camera*, not the player: in third person
  // the rain you can see is the rain where the lens is.
  weather.update(animDt);
  if (!cameraUnderwater()) {
    particles.precipitation(
      animDt, world, weather, camera.position.x, camera.position.y, camera.position.z
    );
  }
  particles.update(animDt, world);

  // ---- things on the floor ----
  // On the game clock, so a paused world's rubble hangs exactly where it was.
  drops.update(animDt, world, player, collectDrop);
  dropsRenderer.update(drops, worldClock);
  // One thud per frame at the volume of the biggest impact, scaled against
  // the speed something reaches after falling about four blocks.
  const impact = drops.loudestLanding();
  if (impact) sound.playDropLand(Math.min(1, impact / 16));
  // Wall-clock, not game time: the feed is a UI element, and a line that was
  // half-faded when you opened the inventory should not still be there when
  // you close it a minute later.
  hud.updatePickups();

  // ---- digging, and the place button's auto-repeat ----
  // Breaking is no longer an event that repeats; it is a stopwatch that runs
  // while the button is down and resets the moment you look somewhere else.
  if (playing && input.pressed.break && !screenOpen()) mine(frameDt);
  else if (mining) stopMining();
  if (playing) {
    placeRepeat = input.pressed.place && !screenOpen() ? placeRepeat + frameDt : 0;
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
  // Drops live in loaded chunks only, like Minecraft's entities: an item
  // forty chunks back is falling through a world that no longer has any
  // blocks in it to land on.
  drops.evictOutside(player.pos.x, player.pos.z, DATA_RADIUS * CHUNK_SIZE);
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
    // Freezing is the slow half — Minecraft does it on random ticks — and it
    // is meant to be: a pond you pour out up in the snow should ice over
    // while you stand there, not the instant it stops moving.
    freezeClock += frameDt * 1000;
    if (freezeClock >= FREEZE_INTERVAL_MS) {
      freezeClock = 0;
      iceSheet.step(
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
  applyWeather(weather.level, submerged);
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
  lastEye = eye;
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

  // ---- held item: keep it in sync with the hotbar, place it, swing it ----
  refreshHeldItem();
  hand.place(HELD_DIST, HELD_SIZE);
  hand.update(animDt);

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

  // ---- furnaces and fuses ----
  // Both run on game time, so a paused game smelts nothing and no fuse
  // burns down behind the menu.
  if (playing) {
    furnaces.tickAll(animDt);
    if (furnaceUI.isOpen) furnaceUI.render();
    for (const t of fuses.tick(animDt)) explode(t.x, t.y, t.z);
  }

  // ---- sun / sky follow player ----
  // The clock advances first, then the light is read off it.
  sky.update(animDt, player.pos);
  applyDaylight();

  // ---- input mode: touch UI and cursor visibility ----
  document.body.classList.toggle('touch', input.wantsTouchUi);
  document.body.classList.toggle('has-touch', input.hasTouch);
  // A locked pointer has no cursor, so the on-screen buttons cannot be
  // clicked; they hide rather than sit there pretending.
  document.body.classList.toggle('pointer-locked', Boolean(document.pointerLockElement));
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
    // Minecraft's scale, and the reason the mountain tops are white: below
    // 0.15 and the water up there turns to ice.
    temperature: world.temperatureAt(px, Math.floor(player.pos.y), pz),
    inWater: player.inWater,
    submerged: player.submerged,
    clock: sky.clock,
    gameMode: gameMode.name,
    flowing: waterFlow.pending.size,
    ice: iceSheet.frozen.size,
    weather: weather.level > 0
      ? `${weather.fallAt(world, px, world.heightAt(px, pz) + 1, pz) === SNOWING ? 'snow' : 'rain'} ${(weather.level * 100).toFixed(0)}%`
      : 'clear',
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
  startPlaying(playSource(e.pointerType, input.recentFinger));
});

hud.bindMenu({
  onResume: (pointerType) => startPlaying(playSource(pointerType, input.recentFinger)),
  onFullscreen: () => input.toggleFullscreen(),
  onRetryLock: () => {
    input.retryLock();
    startPlaying('mouse');
  },
  onReset: () => {
    savingDisabled = true;
    particles.clear();
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
// Build every item model now rather than the first time one is scrolled onto.
// Twenty-six of them at a few hundred triangles each is about a millisecond,
// spent behind the loading screen where nobody is looking, instead of
// twenty-six one-frame hitches spread over the first minute of play.
warmItemModels();
refreshHeldItem();
playerModel.group.visible = !view.isFirstPerson;
requestAnimationFrame(frame);




