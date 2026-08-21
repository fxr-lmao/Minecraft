// The two hostile mobs, in boxes.
//
// Everything here follows the player avatar's construction (player-model.js)
// because a Minecraft mob is the same idea with a different paint job:
// parts sized in "skin pixels" so the proportions are Minecraft's own,
// textures painted onto small canvases with a seeded per-pixel wobble so
// flat colour never reads as plastic, limbs hung from pivots so they swing
// from the right end, and a little self-illumination so a mob on the far
// side of the sun is a figure and not a hole.
//
// The proportions are the real models':
//
//   * A zombie is the player model with green skin and the arms out — legs
//     12px, body 12px, head 8px = 32px over the 1.95-block hitbox. The
//     arms pointing straight ahead is not decoration: it is how Minecraft
//     poses every zombie that has ever existed, and the silhouette of it —
//     a figure with two arms aimed at you — is the whole warning.
//   * A creeper is head 8, body 12 on its side (8 wide, 4 deep), four legs
//     6: 26px over the 1.7-block hitbox. No arms, and the head is the
//     biggest part of it, which is most of why it reads as a face on a
//     stalk.
//
// Each model exposes { group, update(state) } and nothing else, so the
// renderer (mobs-render.js) knows nothing about either of them.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, clamp } from './utils.js';
import { ZOMBIE, CREEPER } from './mobs.js';

/** Zombie: 32 skin pixels over 1.95 blocks. */
const Z_PX = 1.95 / 32;
/** Creeper: 26 over 1.7. */
const C_PX = 1.7 / 26;

// The zombie's palette, brighter than Minecraft's for the same reason the
// player's is: ACES tone mapping crushes anything darker, and a silhouette
// is not a zombie.
const Z_SKIN = 0x59a04f;
const Z_SKIN_DARK = 0x3f7a38;
const Z_SHIRT = 0x0d7c7c;
const Z_SLEEVE = 0x0a6868;
const Z_PANTS = 0x4a4a8c;
const Z_EYE = 0x0c1a0c;

// Creeper greens: a base, a light mottle, a dark mottle, and the near-black
// of the face. The mottling is what makes a creeper a creeper rather than a
// green box — the texture is famously random noise, and so is this.
const C_BASE = 0x69a83f;
const C_LIGHT = 0x8cc75c;
const C_DARK = 0x4c8030;
const C_FACE = 0x101c0c;

/** The self-illumination every part carries, as in the player model. */
const AMBIENT = 0x6e6e6e;

// ------------------------------------------------------------- the textures

/**
 * An S×S canvas of a colour with a seeded wobble, optionally with rows of
 * other colours over the top — the same painter the avatar uses.
 */
function flatTexture(color, seed, opts = {}) {
  const { rows = null, mottle = null } = opts;
  const S = 8;
  const rand = mulberry32(seed);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const paint = (c, y0, y1) => {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < S; x++) {
        const f = 0.88 + rand() * 0.22;
        const r = clamp(Math.round(((c >> 16) & 255) * f), 0, 255);
        const g = clamp(Math.round(((c >> 8) & 255) * f), 0, 255);
        const b = clamp(Math.round((c & 255) * f), 0, 255);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };
  paint(color, 0, S);
  // Optional two-tone mottling: blotches of another colour scattered over
  // the base, which is the creeper's skin exactly — random light and dark
  // patches over green, no pattern anywhere.
  if (mottle) {
    for (const { color: c, chance } of mottle) {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (rand() < chance) {
            const f = 0.9 + rand() * 0.2;
            const r = clamp(Math.round(((c >> 16) & 255) * f), 0, 255);
            const g = clamp(Math.round(((c >> 8) & 255) * f), 0, 255);
            const b = clamp(Math.round((c & 255) * f), 0, 255);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    }
  }
  for (const row of rows ?? []) paint(row.color, row.from, row.to);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The zombie's face: green skin, black brow-deep eyes, a grim mouth. */
function zombieFaceTexture() {
  const S = 8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rand = mulberry32(9902);
  const px = (x, y, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };
  const rgb = (c) => {
    const f = 0.88 + rand() * 0.22;
    const r = clamp(Math.round(((c >> 16) & 255) * f), 0, 255);
    const g = clamp(Math.round(((c >> 8) & 255) * f), 0, 255);
    const b = clamp(Math.round((c & 255) * f), 0, 255);
    return `rgb(${r},${g},${b})`;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) px(x, y, rgb(Z_SKIN));
  }
  // Deep-set black eyes, one pixel wide and two tall, Minecraft's zombie.
  const eye = `#${Z_EYE.toString(16).padStart(6, '0')}`;
  px(1, 3, eye); px(1, 4, eye);
  px(2, 3, eye); px(2, 4, eye);
  px(5, 3, eye); px(5, 4, eye);
  px(6, 3, eye); px(6, 4, eye);
  // The nose and the slack grimace of a mouth, darker green.
  const dark = `#${Z_SKIN_DARK.toString(16).padStart(6, '0')}`;
  px(3, 4, dark); px(4, 4, dark);
  px(2, 6, dark); px(3, 6, dark); px(4, 6, dark); px(5, 6, dark);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The creeper's face. Sixteen black pixels, and everybody on earth knows
 * exactly what they are: two 2×2 eyes, and the downturned mouth below —
 * two pixels wide at the top, four in the middle, and the two gaps at the
 * bottom that make it a frown instead of a hole. Nothing else. The face is
 * the mob; the rest is green.
 */
function creeperFaceTexture() {
  const S = 8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rand = mulberry32(4404);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const f = 0.88 + rand() * 0.22;
      const r = clamp(Math.round(((C_BASE >> 16) & 255) * f), 0, 255);
      const g = clamp(Math.round(((C_BASE >> 8) & 255) * f), 0, 255);
      const b = clamp(Math.round((C_BASE & 255) * f), 0, 255);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const face = `#${C_FACE.toString(16).padStart(6, '0')}`;
  const px = (x, y) => {
    ctx.fillStyle = face;
    ctx.fillRect(x, y, 1, 1);
  };
  // eyes, 2x2 each
  for (const ox of [1, 5]) {
    px(ox, 2); px(ox + 1, 2);
    px(ox, 3); px(ox + 1, 3);
  }
  // mouth: narrow at the top, wide in the middle, split at the bottom
  px(3, 4); px(4, 4);
  px(2, 5); px(3, 5); px(4, 5); px(5, 5);
  px(2, 6); px(3, 6); px(4, 6); px(5, 6);
  px(2, 7); px(5, 7);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Textures are built once per page and shared by every mob of a kind — the
// materials are cloned per mob so flashes can tint one zombie at a time,
// but the pixels behind them are one canvas each.
let Z_TEX = null;
let C_TEX = null;

function zombieTextures() {
  if (!Z_TEX) {
    Z_TEX = {
      skin: flatTexture(Z_SKIN, 101),
      skinDark: flatTexture(Z_SKIN_DARK, 102),
      shirt: flatTexture(Z_SHIRT, 103),
      sleeve: flatTexture(Z_SLEEVE, 104),
      pants: flatTexture(Z_PANTS, 105),
      face: zombieFaceTexture(),
    };
  }
  return Z_TEX;
}

function creeperTextures() {
  if (!C_TEX) {
    C_TEX = {
      hide: flatTexture(C_BASE, 201, {
        mottle: [
          { color: C_LIGHT, chance: 0.18 },
          { color: C_DARK, chance: 0.14 },
        ],
      }),
      face: creeperFaceTexture(),
    };
  }
  return C_TEX;
}

// ---------------------------------------------------------------- the parts

const geoCache = new Map();

/**
 * A box geometry, cached per (kind, part). *Every* box a mob is made of
 * comes through here — the heads and the creeper's body included. They used
 * to be built with a bare `new THREE.BoxGeometry` each, which the renderer
 * then never disposed (it disposes materials only, on the promise that
 * geometry is shared), so a night of spawning and despawning leaked one
 * geometry per zombie and two per creeper. Shared is the promise; this is
 * what keeps it.
 */
function boxGeo(key, w, h, d, pxScale) {
  let geo = geoCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(w * pxScale, h * pxScale, d * pxScale);
    geoCache.set(key, geo);
  }
  return geo;
}

/**
 * A textured box: shared geometry, and a material of its very own — the
 * hurt flash tints *this* zombie, not zombies generally.
 */
function part(kind, name, w, h, d, pxScale, tex, seed) {
  const geo = boxGeo(`${kind}:${name}`, w, h, d, pxScale);
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: AMBIENT,
  });
  mat.userData.seed = seed;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A limb: a box whose geometry hangs *down* from its group's origin, so
 * rotating the group swings the limb from the shoulder/hip like a hinge
 * rather than spinning it about its middle.
 */
function limb(kind, name, w, h, d, pxScale, tex, seed) {
  const g = new THREE.Group();
  const mesh = part(kind, name, w, h, d, pxScale, tex, seed);
  mesh.position.y = (-h / 2) * pxScale;
  g.add(mesh);
  return g;
}

// ------------------------------------------------------------------ zombie

/**
 * Build a zombie. The group's origin is its feet; `front` is -Z as with the
 * player, so the same yaw convention drives both.
 */
export function createZombieModel() {
  const T = zombieTextures();
  const PX = Z_PX;
  const group = new THREE.Group();

  // Body frame: dies (tips over) by rotating this, without disturbing the
  // group's position or the parts' walk angles inside it.
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  group.add(root);

  // head, on a neck pivot so it can look around independently of the body.
  // The box is centred one half-head above the pivot so it sits *on* the
  // shoulders rather than half-buried in them.
  const headPivot = new THREE.Group();
  headPivot.position.y = 24 * PX;
  root.add(headPivot);
  const skin = () => new THREE.MeshLambertMaterial({
    map: T.skin, emissiveMap: T.skin, emissive: AMBIENT,
  });
  // Box material order: +x, -x, +y, -y, +z, -z. The face is on -Z, the
  // direction the body calls forward, matching the player avatar.
  const faceMat = new THREE.MeshLambertMaterial({
    map: T.face, emissiveMap: T.face, emissive: AMBIENT,
  });
  const topMat = new THREE.MeshLambertMaterial({
    map: T.skinDark, emissiveMap: T.skinDark, emissive: AMBIENT,
  });
  const head = new THREE.Mesh(
    boxGeo(`${ZOMBIE}:head`, 8, 8, 8, PX),
    [skin(), skin(), topMat, skin(), skin(), faceMat]);
  head.position.y = 4 * PX;
  head.castShadow = true;
  headPivot.add(head);

  // torso: 8 wide, 12 tall, 4 deep
  const torso = part(ZOMBIE, 'torso', 8, 12, 4, PX, T.shirt, 21);
  torso.position.y = 18 * PX;
  root.add(torso);

  // arms, aimed dead ahead: the zombie's whole posture. They hang from the
  // shoulder pivot like any limb and are then rotated to horizontal, so a
  // walk cycle can still bob them a little without ever breaking the pose.
  const armL = limb(ZOMBIE, 'arm', 4, 12, 4, PX, T.sleeve, 31);
  armL.position.set(-6 * PX, 23 * PX, 0);
  root.add(armL);
  const armR = limb(ZOMBIE, 'arm', 4, 12, 4, PX, T.sleeve, 32);
  armR.position.set(6 * PX, 23 * PX, 0);
  root.add(armR);

  // legs from the hips
  const legL = limb(ZOMBIE, 'leg', 4, 12, 4, PX, T.pants, 41);
  legL.position.set(-2 * PX, 12 * PX, 0);
  root.add(legL);
  const legR = limb(ZOMBIE, 'leg', 4, 12, 4, PX, T.pants, 42);
  legR.position.set(2 * PX, 12 * PX, 0);
  root.add(legR);

  // Every part that can flash (all of them) is collected once so a hit can
  // tint the whole figure without traversing the graph per frame.
  const allMats = [];
  root.traverse((o) => {
    if (o.isMesh) {
      // The head is a multi-material mesh; collect each face's material.
      if (Array.isArray(o.material)) allMats.push(...o.material);
      else allMats.push(o.material);
    }
  });

  let phase = 0;

  /**
   * @param {object} s the sim's mob state: { dt, yaw, headYaw, headPitch,
   *   walkPhase, hurtFlash, burning, dying (-1 alive, else seconds left) }
   */
  function update(s) {
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.yaw;

    // Head follows the target within reason: the neck turns after the
    // body's own yaw, clamped like a spine would.
    let rel = s.headYaw - s.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    headPivot.rotation.y = clamp(rel, -1.1, 1.1);
    headPivot.rotation.x = clamp(s.headPitch, -0.6, 0.6);

    // The walk: legs in opposition, the shamble slowed a touch to match the
    // 2.3-blocks-a-second the sim actually moves. The arms stay aimed and
    // merely sway with the stride.
    phase = s.walkPhase;
    const swing = Math.sin(phase) * 0.55;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    const armSway = Math.sin(phase) * 0.09;
    armL.rotation.x = -Math.PI / 2 + armSway;
    armR.rotation.x = -Math.PI / 2 - armSway;
    armL.rotation.z = 0.05 + Math.abs(Math.sin(phase)) * 0.03;
    armR.rotation.z = -0.05 - Math.abs(Math.sin(phase)) * 0.03;

    applyCommon(root, allMats, s);
  }

  return { kind: ZOMBIE, group, update };
}

// ----------------------------------------------------------------- creeper

/**
 * Build a creeper: head 8, body 12 tall/8 wide/4 deep, four 6-tall legs —
 * 26 skin pixels over the 1.7-block hitbox, the real model's proportions.
 */
export function createCreeperModel() {
  const T = creeperTextures();
  const PX = C_PX;
  const group = new THREE.Group();

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  group.add(root);

  const headPivot = new THREE.Group();
  headPivot.position.y = 18 * PX; // legs 6 + body 12
  root.add(headPivot);
  const headGeo = boxGeo(`${CREEPER}:head`, 8, 8, 8, PX);
  const hide = () => new THREE.MeshLambertMaterial({
    map: T.hide, emissiveMap: T.hide, emissive: AMBIENT,
  });
  const faceMat = new THREE.MeshLambertMaterial({
    map: T.face, emissiveMap: T.face, emissive: AMBIENT,
  });
  const head = new THREE.Mesh(headGeo, [hide(), hide(), hide(), hide(), hide(), faceMat]);
  head.position.y = 4 * C_PX; // half a head above the neck
  head.castShadow = true;
  headPivot.add(head);

  // body: 8 wide (x), 12 tall (y), 4 deep (z), sitting on the legs
  const body = new THREE.Mesh(boxGeo(`${CREEPER}:body`, 8, 12, 4, PX), hide());
  body.castShadow = true;
  body.position.y = 12 * PX;
  root.add(body);

  // four legs, 4x6x4, hung from their tops at the body's base. Front pair
  // and back pair each pivot from a hip so the shuffle can alternate.
  const legFL = limb(CREEPER, 'legF', 4, 6, 4, PX, T.hide, 51);
  legFL.position.set(-2 * PX, 6 * PX, -2 * PX);
  root.add(legFL);
  const legFR = limb(CREEPER, 'legF', 4, 6, 4, PX, T.hide, 52);
  legFR.position.set(2 * PX, 6 * PX, -2 * PX);
  root.add(legFR);
  const legBL = limb(CREEPER, 'legB', 4, 6, 4, PX, T.hide, 53);
  legBL.position.set(-2 * PX, 6 * PX, 2 * PX);
  root.add(legBL);
  const legBR = limb(CREEPER, 'legB', 4, 6, 4, PX, T.hide, 54);
  legBR.position.set(2 * PX, 6 * PX, 2 * PX);
  root.add(legBR);

  const allMats = [];
  root.traverse((o) => {
    if (o.isMesh) {
      if (Array.isArray(o.material)) allMats.push(...o.material);
      else allMats.push(o.material);
    }
  });

  function update(s) {
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.yaw;

    let rel = s.headYaw - s.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    headPivot.rotation.y = clamp(rel, -1.1, 1.1);
    headPivot.rotation.x = clamp(s.headPitch, -0.5, 0.5);

    // The shuffle: diagonals together, like a lizard's gait — the four legs
    // a creeper has make it a trotter rather than a walker, and pairs
    // moving opposite reads as "scurrying" at exactly the speed it moves.
    const swing = Math.sin(s.walkPhase) * 0.6;
    legFL.rotation.x = swing;
    legBR.rotation.x = swing;
    legFR.rotation.x = -swing;
    legBL.rotation.x = -swing;

    applyCommon(root, allMats, s);
  }

  return { kind: CREEPER, group, update };
}

// ------------------------------------------------------------ shared states

/**
 * The states every mob model shares, in one place so both `update`s end the
 * same way: the hurt flash, the burn glow, the creeper's swell, and the
 * fall-over of death.
 *
 * The flash is an emissive tint — Lambert materials carry their texture as
 * an emissiveMap already, so the flash is the material's emissive colour
 * sliding toward red (a hit) or white (a swell) and back, and every part
 * slides together because allMats was collected at build time.
 */
function applyCommon(root, allMats, s) {
  // Death: tip over sideways and settle into the floor, over 0.9s. The
  // sim's `dying` counts *down* from 0.9; t runs the other way.
  if (s.dying >= 0) {
    const t = clamp(1 - s.dying / 0.9, 0, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep: slow, then over, then settled
    root.rotation.z = ease * (Math.PI / 2) * 0.98;
    root.position.y = -ease * 0.12;
  } else {
    root.rotation.z = 0;
    root.position.y = 0;
  }

  // The creeper's swell, drawn as Minecraft draws it: bigger, and flashing
  // white faster and faster. The scale rides the whole root; the flash
  // rides the emissive, so the lit and unlit sides agree.
  let flash = s.hurtFlash;
  let scale = 1;
  if (s.fuse > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(s.fuse * s.fuse * 40);
    flash = Math.max(flash, s.fuse * pulse);
    scale = 1 + s.fuse * 0.22;
  }
  // Set every time, not only when it is not 1: a creeper whose fuse was
  // unwound — you got seven blocks away, or you killed it mid-swell, which
  // zeroes the fuse — kept whatever size the last swelling frame left it,
  // and stayed that size for the rest of its life and its corpse.
  root.scale.setScalar(scale);

  // Fire: a warm flicker that sits on top of everything else the figure is
  // doing, because a burning zombie keeps walking. That is the point of it.
  let emissive = null;
  if (flash > 0) emissive = new THREE.Color(0.9 * flash, 0.12 * flash, 0.1 * flash);
  if (s.burning > 0) {
    const f = s.burning * (0.7 + 0.3 * Math.sin(s.walkPhase * 13 + 1.7));
    const fire = new THREE.Color(0.9 * f, 0.45 * f, 0.1 * f);
    emissive = emissive ? emissive.add(fire) : fire;
  }
  for (const m of allMats) {
    if (emissive) m.emissive.setRGB(emissive.r + 0.43, emissive.g + 0.43, emissive.b + 0.43);
    else m.emissive.setRGB(0.43, 0.43, 0.43); // the standing AMBIENT, as a colour
  }
}

/**
 * Which factory builds which kind. The renderer only knows this table, so
 * adding a third mob is a model file and one entry here.
 */
export function createMobModel(kind) {
  return kind === CREEPER ? createCreeperModel() : createZombieModel();
}
