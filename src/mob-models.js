// The mobs, rebuilt.
//
// The previous version had two visible defects and they were the two most
// looked-at things about a mob:
//
//   * Feet in the ground. The collision code parks a mob at y = floor + a
//     hair, which is where its *feet* belong — but the models drew their
//     legs as boxes hanging down from a hip placed at the body's underside,
//     which put the bottoms of the legs half a leg below the body and (for
//     the cow) nearly half a block into the dirt. Every model here is built
//     so that standing still, the bottom of every leg is exactly at the
//     group's origin: the origin is the ground, and the mob stands on it.
//
//   * No necks. Heads sat directly on torsos — Minecraft's zombie does that
//     too, but at this scale a head welded to a chest reads as a bobble, so
//     the humanoids get a real neck (a small skin-toned box the head pivots
//     on) and the animals get one connecting the body to the head out in
//     front of it. A neck is what turns a stack of boxes into a figure.
//
// Beyond those two, everything got redrawn: the faces are hand-drawn 8×8
// pixel maps instead of noise (a creeper's face is sixteen black pixels,
// and it matters exactly where), the bodies are painted maps with shading
// and mottle instead of flat wobble, and the whole file is now
// data-driven: each mob is a spec — a list of boxes in skin pixels with
// their textures — and one builder turns a spec into a THREE group. The
// spec is also what the art preview tool renders, so the drawn mob and the
// played mob can never drift apart.
//
// Proportions stay Minecraft's own: a zombie is 32 skin pixels over its
// 1.95-block hitbox (legs 12, torso 11, neck 2, head 7), a creeper is 26
// over 1.7. Each model exposes { kind, group, update(state) } and nothing
// else, so the renderer (mobs-render.js) knows nothing about any of them.

import * as THREE from '../vendor/three.module.min.js';
import { clamp } from './utils.js';
import { ZOMBIE, CREEPER, SKELETON, SPIDER, PIG, COW, CHICKEN, SHEEP } from './mobs.js';
import { paintedCanvas } from './pixelart.js';

// ------------------------------------------------------------ pixel constants

/** Zombie: 32 skin pixels over 1.95 blocks. */
const Z_PX = 1.95 / 32;
/** Creeper: 26 over 1.7. */
const C_PX = 1.7 / 26;
/** Skeleton: 32 over 1.99. */
const S_PX = 1.99 / 32;
/** Spider: 16 over 0.9. */
const SP_PX = 0.9 / 16;

/** The self-illumination every part carries, as in the player model: ACES
 *  tone mapping crushes an unlit face to black, and a mob on the far side
 *  of the sun must still be a figure and not a hole. */
const AMBIENT = 0x6e6e6e;

// --------------------------------------------------------------- palettes
//
// Hand-picked per mob, slightly brighter than Minecraft's own because ACES
// tone mapping crushes anything darker.

const Z_SKIN = '#5ea552';
const Z_SKIN_DARK = '#427c38';
const Z_SHIRT = '#0d8c8c';
const Z_SHIRT_DARK = '#096a6a';
const Z_PANTS = '#4a4a9c';
const Z_PANTS_DARK = '#3a3a80';
const Z_EYE = '#0c140c';

const C_BASE = '#69a83f';
const C_LIGHT = '#8cc75c';
const C_DARK = '#4c8030';
const C_FACE = '#101c0c';

const S_BONE = '#c9c9bd';
const S_BONE_DARK = '#8a8a80';
const S_SOCKET = '#101010';

const SP_DARK = '#2a2320';
const SP_MID = '#3a312c';
const SP_LIGHT = '#4a4038';
const SP_EYE = '#d01818';

const Q_PIG = '#e8a0a0';
const Q_PIG_DARK = '#c88080';
const Q_PIG_SNOUT = '#d87878';
const Q_COW = '#6b4a2a';
const Q_COW_DARK = '#573a20';
const Q_COW_SNOUT = '#d8c8b8';
const Q_SHEEP = '#e6e6e0';
const Q_SHEEP_DARK = '#4a463e';
const Q_CHICK = '#f0f0e8';
const Q_CHICK_DARK = '#d8d8d0';
const Q_BEAK = '#d8a038';

// ------------------------------------------------------- the face map format
//
// A face (or body) is a small pixel map: N strings of N letters, a palette,
// painted with a seeded per-pixel wobble by pixelart.js. The letters mean
// whatever the palette says; the *placement* is the drawing.

/** A canvas texture from a pixel map, nearest-neighbour, sRGB. */
function mapTexture(rows, palette, seed, wobble = 0.06) {
  const size = rows.length;
  const cv = paintedCanvas(size, rows, palette, { seed, wobble });
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A flat colour with a seeded wobble, for the parts without a drawing. */
function flatTexture(color, seed) {
  const size = 8;
  const rows = Array.from({ length: size }, () => 'm'.repeat(size));
  return mapTexture(rows, { m: color }, seed, 0.09);
}

// ------------------------------------------------------------- zombie art

/**
 * The zombie's face, hand-drawn: green skin with a lit brow, deep black
 * eyes two texels wide and two tall (Minecraft's zombie eyes), a shaded
 * nose, and the slack grimace of a mouth across the bottom.
 */
const ZOMBIE_FACE_PX = [
  'hhgggggh',
  'hggggggh',
  'gggggggg',
  'gEEggEEg',
  'gEEggEEg',
  'ggNNgggg',
  'ggNNMMMM',
  'ddgMMMMd',
];
const ZOMBIE_FACE_PALETTE = {
  g: Z_SKIN, h: '#7ac46c', d: Z_SKIN_DARK, N: Z_SKIN_DARK, E: Z_EYE, M: '#2a4a22',
};

/** The zombie's shirt: teal with a darker hem and shoulder shading. */
const ZOMBIE_SHIRT_PX = [
  'mmhmmmmm',
  'mhmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmddddmm',
  'dddddddd',
];
const ZOMBIE_SHIRT_PALETTE = {
  m: Z_SHIRT, h: '#1a9c9c', d: Z_SHIRT_DARK,
};

/** The zombie's pants: blue-violet, darker toward the cuffs. */
const ZOMBIE_PANTS_PX = [
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmddddmm',
  'dddddddd',
];
const ZOMBIE_PANTS_PALETTE = {
  m: Z_PANTS, d: Z_PANTS_DARK,
};

// ------------------------------------------------------------ creeper art
//
// The creeper's face: sixteen black pixels, and everybody on earth knows
// exactly what they are — two 2×2 eyes and the downturned mouth below.
// The rest of the head is the mottled hide.

const CREEPER_FACE_PX = [
  'cccccccc',
  'cEEccEEc',
  'cEEccEEc',
  'cccccccc',
  'cccMMccc',
  'ccMMMMcc',
  'ccMMMMcc',
  'ccMMcMMc',
];
const CREEPER_FACE_PALETTE = {
  c: C_BASE, E: C_FACE, M: C_FACE,
};

/** The creeper's hide: mottle placed by hand, denser toward the bottom. */
const CREEPER_HIDE_PX = [
  'cmclcmcm',
  'mcmcmcmc',
  'cmcmcmcl',
  'mcmcmcmc',
  'cmclmcmc',
  'lcmcmcml',
  'mcmclmcm',
  'cmlmcmcl',
];
const CREEPER_HIDE_PALETTE = {
  c: C_BASE, m: C_BASE, l: C_LIGHT,
};

// ------------------------------------------------------------ skeleton art

const SKELETON_FACE_PX = [
  'bbbbbbbb',
  'bbbbbbbb',
  'bbbbbbbb',
  'bSSbbSSb',
  'bSSbbSSb',
  'bbbbbbbb',
  'bbbSSbbb',
  'bbbbbbbb',
];
const SKELETON_FACE_PALETTE = {
  b: S_BONE, S: S_SOCKET,
};

/** Ribcage: bone with darker gaps between the ribs. */
const SKELETON_RIBS_PX = [
  'bbbbbbbb',
  'bdbbbbdb',
  'bdbdbdbd',
  'bbbbbbbb',
  'bdbbbbdb',
  'bdbdbdbd',
  'bbbbbbbb',
  'bbbbbbbb',
];
const SKELETON_RIBS_PALETTE = {
  b: S_BONE, d: S_BONE_DARK,
};

// -------------------------------------------------------------- spider art

const SPIDER_HIDE_PX = [
  'mldmmmmm',
  'mmmmldmm',
  'dmmmmmmm',
  'mmmmmmdl',
  'mmldmmmm',
  'mmmmmmmm',
  'dmmmmmmm',
  'mmmmdmmm',
];
const SPIDER_HIDE_PALETTE = {
  m: SP_MID, d: SP_DARK, l: SP_LIGHT,
};

/** The spider's eye plate: four red eyes in two rows, like the real one. */
const SPIDER_FACE_PX = [
  'mmmmmmmm',
  'mmmmmmmm',
  'mRRmmRRm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmRRRRmm',
  'mmmmmmmm',
  'mmmmmmmm',
];
const SPIDER_FACE_PALETTE = {
  m: SP_MID, R: SP_EYE,
};

// ------------------------------------------------------------ animal art

/** Pig: pink hide with a darker belly band. */
const PIG_HIDE_PX = [
  'mhmmmmmm',
  'hmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmddddmm',
  'dddddddd',
  'dddddddd',
];
const PIG_HIDE_PALETTE = { m: Q_PIG, h: '#f4b8b8', d: Q_PIG_DARK };

/** Pig face: the flat snout with the two nostrils and small dark eyes. */
const PIG_FACE_PX = [
  'hhhhhhhh',
  'hhEhhEhh',
  'hhhhhhhh',
  'hhsssshh',
  'hssssssh',
  'hhsssshh',
  'hssnnssh',
  'hhsssssh',
];
const PIG_FACE_PALETTE = {
  h: Q_PIG, E: '#3a2424', s: Q_PIG_SNOUT, n: '#5c3838',
};

/** Cow: brown hide with white patches (the classic dairy cow). */
const COW_HIDE_PX = [
  'mwwmmmmm',
  'mwwmmmmm',
  'mmmmwwmm',
  'mmmmwwmm',
  'mmwwmmmm',
  'mmwwmmmm',
  'mmmmmmww',
  'mmmmmmww',
];
const COW_HIDE_PALETTE = { m: Q_COW, w: '#c8b098' };

/** Cow face: brown with a white blaze and a pale muzzle. */
const COW_FACE_PX = [
  'bwwbbbwb',
  'bEwwbbEb',
  'bwwbbbwb',
  'bbbbbbbb',
  'bbssssbb',
  'bssssssb',
  'bssnnssb',
  'bbssssbb',
];
const COW_FACE_PALETTE = {
  b: Q_COW, w: '#c8b098', E: '#241410', s: Q_COW_SNOUT, n: '#8a7a6a',
};

/** Sheep wool: curls drawn as light rings on a slightly darker fleece. */
const SHEEP_WOOL_PX = [
  'mlmlmmml',
  'lmmmmlmm',
  'mmmlmmml',
  'mlmmlmmm',
  'lmmmmlmm',
  'mmmlmmml',
  'mlmlmmml',
  'lmmmmlmm',
];
const SHEEP_WOOL_PALETTE = { m: Q_SHEEP, l: '#f8f8f4' };

/** Sheep face: the dark grey face of the classic white sheep. */
const SHEEP_FACE_PX = [
  'dddddddd',
  'dEddddEd',
  'dddddddd',
  'ddmmmmdd',
  'ddmmmmdd',
  'ddmmmmdd',
  'dddddddd',
  'dddddddd',
];
const SHEEP_FACE_PALETTE = {
  d: Q_SHEEP_DARK, m: '#6a6458', E: '#141210',
};

/** Chicken feathers: pale with a darker wing stripe. */
const CHICK_HIDE_PX = [
  'mmmmmmmm',
  'mmmmmmmm',
  'mmddddmm',
  'mddddddm',
  'mmddddmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
];
const CHICK_HIDE_PALETTE = { m: Q_CHICK, d: Q_CHICK_DARK };

/** Chicken head: eyes at the sides, no mouth to speak of. */
const CHICK_FACE_PX = [
  'mmmmmmmm',
  'mEmmmmEm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
  'mmmmmmmm',
];
const CHICK_FACE_PALETTE = { m: Q_CHICK, E: '#241410' };

// ----------------------------------------------------------------- textures
//
// Built once per kind and shared by every mob of that kind — the materials
// are cloned per mob so a flash can tint one zombie at a time, but the
// pixels behind them are one canvas each.

let Z_TEX = null;
let C_TEX = null;
let S_TEX = null;
let SP_TEX = null;
let Q_TEX = null;

function zombieTextures() {
  if (!Z_TEX) {
    Z_TEX = {
      skin: flatTexture(Z_SKIN, 101),
      skinDark: flatTexture(Z_SKIN_DARK, 102),
      shirt: mapTexture(ZOMBIE_SHIRT_PX, ZOMBIE_SHIRT_PALETTE, 103),
      sleeve: flatTexture(Z_SHIRT_DARK, 104),
      pants: mapTexture(ZOMBIE_PANTS_PX, ZOMBIE_PANTS_PALETTE, 105),
      face: mapTexture(ZOMBIE_FACE_PX, ZOMBIE_FACE_PALETTE, 106),
    };
  }
  return Z_TEX;
}

function creeperTextures() {
  if (!C_TEX) {
    C_TEX = {
      hide: mapTexture(CREEPER_HIDE_PX, CREEPER_HIDE_PALETTE, 201),
      hideDark: flatTexture(C_DARK, 202),
      face: mapTexture(CREEPER_FACE_PX, CREEPER_FACE_PALETTE, 203),
    };
  }
  return C_TEX;
}

function skeletonTextures() {
  if (!S_TEX) {
    S_TEX = {
      bone: flatTexture(S_BONE, 301),
      dark: flatTexture(S_BONE_DARK, 302),
      ribs: mapTexture(SKELETON_RIBS_PX, SKELETON_RIBS_PALETTE, 303),
      face: mapTexture(SKELETON_FACE_PX, SKELETON_FACE_PALETTE, 304),
    };
  }
  return S_TEX;
}

function spiderTextures() {
  if (!SP_TEX) {
    SP_TEX = {
      hide: mapTexture(SPIDER_HIDE_PX, SPIDER_HIDE_PALETTE, 401),
      dark: flatTexture(SP_DARK, 402),
      face: mapTexture(SPIDER_FACE_PX, SPIDER_FACE_PALETTE, 403),
    };
  }
  return SP_TEX;
}

function quadrupedTextures() {
  if (!Q_TEX) {
    Q_TEX = {
      pig: mapTexture(PIG_HIDE_PX, PIG_HIDE_PALETTE, 501),
      pigFace: mapTexture(PIG_FACE_PX, PIG_FACE_PALETTE, 502),
      pigSnout: flatTexture(Q_PIG_SNOUT, 503),
      cow: mapTexture(COW_HIDE_PX, COW_HIDE_PALETTE, 504),
      cowFace: mapTexture(COW_FACE_PX, COW_FACE_PALETTE, 505),
      cowSnout: flatTexture(Q_COW_SNOUT, 506),
      sheep: mapTexture(SHEEP_WOOL_PX, SHEEP_WOOL_PALETTE, 507),
      sheepFace: mapTexture(SHEEP_FACE_PX, SHEEP_FACE_PALETTE, 508),
      sheepDark: flatTexture(Q_SHEEP_DARK, 509),
      chicken: mapTexture(CHICK_HIDE_PX, CHICK_HIDE_PALETTE, 510),
      chickenDark: flatTexture(Q_CHICK_DARK, 511),
      chickenFace: mapTexture(CHICK_FACE_PX, CHICK_FACE_PALETTE, 512),
      beak: flatTexture(Q_BEAK, 513),
    };
  }
  return Q_TEX;
}

// ------------------------------------------------------------------- parts
//
// One builder turns a spec into a group. A spec is a list of parts; each
// part is:
//
//   { name, at:[x,y,z], size:[w,h,d], tex:'skin', faces?: {front:'face'} }
//     a box centred at `at` (skin pixels, +y up, -z = the mob's front).
//   { name, at:[x,y,z], size:[w,h,d], tex, limb:true }
//     a box hanging *down* from a pivot at `at`, so rotating the pivot
//     swings the limb from the shoulder/hip like a hinge.
//   { name, at:[x,y,z], pivot:true, children:[...] }
//     a group (the head pivot) holding its children.
//   { name, at:[x,y,z], size:[w,h,d], tex, faces:[...only these sides...] }
//     a box whose material array is named by side: 'front','back','left',
//     'right','top','bottom'.
//
// Positions are in skin pixels, scaled by the mob's px constant, measured
// from the group's origin — which is the mob's *feet*. Standing still, the
// bottom of every leg is at y = 0: the origin is the ground.

const geoCache = new Map();

/** A box geometry, cached per (kind, name) — every box a mob is made of
 *  comes through here, which is what makes a night of spawns leak-free. */
function boxGeo(kind, name, w, h, d, px) {
  let geo = geoCache.get(`${kind}:${name}`);
  if (!geo) {
    geo = new THREE.BoxGeometry(w * px, h * px, d * px);
    geoCache.set(`${kind}:${name}`, geo);
  }
  return geo;
}

/**
 * A textured box: shared geometry, and a material of its very own — the
 * hurt flash tints *this* mob, not mobs generally.
 */
function part(kind, p, px, T) {
  const geo = boxGeo(kind, p.name, p.size[0], p.size[1], p.size[2], px);
  const mat = new THREE.MeshLambertMaterial({
    map: T[p.tex],
    emissiveMap: T[p.tex],
    emissive: AMBIENT,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(p.at[0] * px, p.at[1] * px, p.at[2] * px);
  return mesh;
}

/**
 * A multi-face box — the head, whose front face carries the drawn face.
 * `faces` names which texture goes on which side, in box material order
 * (+x, -x, +y, -y, +z, -z); the front (-z) is the direction the body calls
 * forward, matching the player avatar.
 */
function facedPart(kind, p, px, T) {
  const geo = boxGeo(kind, p.name, p.size[0], p.size[1], p.size[2], px);
  const make = (key) => new THREE.MeshLambertMaterial({
    map: T[key], emissiveMap: T[key], emissive: AMBIENT,
  });
  const f = p.faces;
  const mesh = new THREE.Mesh(geo, [
    make(f.left ?? p.tex),
    make(f.right ?? p.tex),
    make(f.top ?? p.tex),
    make(f.bottom ?? p.tex),
    make(f.back ?? p.tex),
    make(f.front ?? p.tex),
  ]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(p.at[0] * px, p.at[1] * px, p.at[2] * px);
  return mesh;
}

/**
 * Build a group from a spec, handing back { group, handles } where handles
 * maps part names to their objects (groups for limbs and pivots, meshes for
 * plain parts) so the per-kind update can animate them by name.
 */
function buildFromSpec(kind, spec, px, T) {
  const group = new THREE.Group();
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  group.add(root);
  const handles = { root };
  const allMats = [];

  const collect = (mesh) => {
    if (Array.isArray(mesh.material)) allMats.push(...mesh.material);
    else allMats.push(mesh.material);
  };

  const buildInto = (parent, parts) => {
    for (const p of parts) {
      if (p.pivot) {
        const g = new THREE.Group();
        g.position.set(p.at[0] * px, p.at[1] * px, p.at[2] * px);
        parent.add(g);
        handles[p.name] = g;
        buildInto(g, p.children ?? []);
      } else if (p.limb) {
        // A limb: the group is the pivot at `at`, and the box hangs *down*
        // from it — so the box's own position is just the hang offset, not
        // `at` again (applying both doubles the reach of every arm).
        const g = new THREE.Group();
        g.position.set(p.at[0] * px, p.at[1] * px, p.at[2] * px);
        parent.add(g);
        const mesh = part(kind, p, px, T);
        mesh.position.set(0, (-p.size[1] / 2) * px, 0);
        g.add(mesh);
        collect(mesh);
        handles[p.name] = g;
      } else {
        const mesh = p.faces ? facedPart(kind, p, px, T) : part(kind, p, px, T);
        parent.add(mesh);
        collect(mesh);
        handles[p.name] = mesh;
      }
    }
  };

  buildInto(root, spec);
  return { group, handles, allMats };
}

// ------------------------------------------------------------------ zombie
//
// 32 skin pixels over the 1.95-block hitbox, Minecraft's own proportions
// with one adjustment: a 2-pixel neck between the shoulders and the head,
// because a head welded to a chest reads as a bobble at this scale. The
// head pivots on top of the neck so it looks around from the *top* of the
// figure instead of from inside the chest.

export function createZombieModel() {
  const T = zombieTextures();
  const PX = Z_PX;
  const spec = [
    // legs from the hips — 12px, feet at 0
    { name: 'legL', at: [-2, 12, 0], size: [4, 12, 4], tex: 'pants', limb: true },
    { name: 'legR', at: [2, 12, 0], size: [4, 12, 4], tex: 'pants', limb: true },
    // torso 11px (12..23): one pixel shorter than the classic to make room
    // for the neck without making the figure taller than its hitbox.
    { name: 'torso', at: [0, 17.5, 0], size: [8, 11, 4], tex: 'shirt' },
    // the neck and head live on the head pivot at y=25
    {
      name: 'headPivot', at: [0, 25, 0], pivot: true, children: [
        { name: 'neck', at: [0, -1, 0], size: [4, 2, 4], tex: 'skin' },
        { name: 'head', at: [0, 3.5, 0], size: [8, 7, 8], tex: 'skin', faces: { front: 'face' } },
      ],
    },
    // arms, aimed dead ahead: the zombie's whole posture. They hang from
    // the shoulder pivot and are rotated to horizontal in update().
    { name: 'armL', at: [-6, 22.5, 0], size: [4, 12, 4], tex: 'sleeve', limb: true },
    { name: 'armR', at: [6, 22.5, 0], size: [4, 12, 4], tex: 'sleeve', limb: true },
  ];

  const { group, handles: h, allMats } = buildFromSpec(ZOMBIE, spec, PX, T);
  let phase = 0;

  /**
   * @param {object} s the sim's mob state: { dt, yaw, headYaw, headPitch,
   *   walkPhase, hurtFlash, burning, dying (-1 alive, else seconds left) }
   */
  function update(s) {
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.yaw;

    // The neck turns after the body's own yaw, clamped like a spine would.
    let rel = s.headYaw - s.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    h.headPivot.rotation.y = clamp(rel, -1.1, 1.1);
    h.headPivot.rotation.x = clamp(s.headPitch, -0.6, 0.6);

    // The walk: legs in opposition, the shamble slowed a touch to match the
    // 2.3-blocks-a-second the sim actually moves. The arms stay aimed and
    // merely sway with the stride.
    phase = s.walkPhase;
    const swing = Math.sin(phase) * 0.55;
    h.legL.rotation.x = swing;
    h.legR.rotation.x = -swing;
    const armSway = Math.sin(phase) * 0.09;
    h.armL.rotation.x = -Math.PI / 2 + armSway;
    h.armR.rotation.x = -Math.PI / 2 - armSway;
    h.armL.rotation.z = 0.05 + Math.abs(Math.sin(phase)) * 0.03;
    h.armR.rotation.z = -0.05 - Math.abs(Math.sin(phase)) * 0.03;

    applyCommon(h.root, allMats, s);
  }

  return { kind: ZOMBIE, group, update };
}

// ----------------------------------------------------------------- creeper
//
// Head 8, body 12 on its side (8 wide, 4 deep), four legs 6: 26 skin
// pixels over the 1.7-block hitbox, the real model's proportions. The
// creeper's anatomy is head-on-body — that is what a creeper is — but the
// head now sits on a slightly raised collar so the face is not buried in
// the shoulders.

export function createCreeperModel() {
  const T = creeperTextures();
  const PX = C_PX;
  const spec = [
    { name: 'legFL', at: [-2, 6, -2], size: [4, 6, 4], tex: 'hideDark', limb: true },
    { name: 'legFR', at: [2, 6, -2], size: [4, 6, 4], tex: 'hideDark', limb: true },
    { name: 'legBL', at: [-2, 6, 2], size: [4, 6, 4], tex: 'hideDark', limb: true },
    { name: 'legBR', at: [2, 6, 2], size: [4, 6, 4], tex: 'hideDark', limb: true },
    // body 6..18, on the legs
    { name: 'body', at: [0, 12, 0], size: [8, 12, 4], tex: 'hide' },
    {
      name: 'headPivot', at: [0, 18, 0], pivot: true, children: [
        // a collar of darker hide the head stands on, so the head reads as
        // a head and not as the body simply stopping
        { name: 'collar', at: [0, 0.5, 0], size: [8, 2, 4], tex: 'hideDark' },
        { name: 'head', at: [0, 4, 0], size: [8, 8, 8], tex: 'hide', faces: { front: 'face' } },
      ],
    },
  ];

  const { group, handles: h, allMats } = buildFromSpec(CREEPER, spec, PX, T);

  function update(s) {
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.yaw;

    let rel = s.headYaw - s.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    h.headPivot.rotation.y = clamp(rel, -1.1, 1.1);
    h.headPivot.rotation.x = clamp(s.headPitch, -0.5, 0.5);

    // The shuffle: diagonals together, like a lizard's gait.
    const swing = Math.sin(s.walkPhase) * 0.6;
    h.legFL.rotation.x = swing;
    h.legBR.rotation.x = swing;
    h.legFR.rotation.x = -swing;
    h.legBL.rotation.x = -swing;

    applyCommon(h.root, allMats, s);
  }

  return { kind: CREEPER, group, update };
}

// ------------------------------------------------------------- shared states
//
// The states every mob shares, in one place so every `update` ends the same
// way: the hurt flash, the burn glow, the creeper's swell, and the
// fall-over of death.

function applyCommon(root, allMats, s) {
  // Death: tip over sideways and settle into the floor, over 0.9s.
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
  // white faster and faster.
  let flash = s.hurtFlash;
  let scale = 1;
  if (s.fuse > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(s.fuse * s.fuse * 40);
    flash = Math.max(flash, s.fuse * pulse);
    scale = 1 + s.fuse * 0.22;
  }
  // Set every time: a creeper whose fuse was unwound kept the size the
  // last swelling frame left it — for the rest of its life and its corpse.
  root.scale.setScalar(scale);

  // Fire: a warm flicker on top of everything else the figure is doing.
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

// ----------------------------------------------------------------- skeleton
//
// The zombie's body with the flesh off: bone-white boxes in the same
// 32-pixel humanoid proportions — legs 12, torso 11, a 2-pixel neck of
// vertebrae, head 7 — with black sockets where the eyes used to be, and a
// bow held out in front of it: the tell, from across the field, that this
// one does not have to reach you.

export function createSkeletonModel() {
  const T = skeletonTextures();
  const PX = S_PX;
  const spec = [
    { name: 'legL', at: [-1.5, 12, 0], size: [3, 12, 3], tex: 'bone', limb: true },
    { name: 'legR', at: [1.5, 12, 0], size: [3, 12, 3], tex: 'bone', limb: true },
    { name: 'torso', at: [0, 17.5, 0], size: [6, 11, 3], tex: 'ribs' },
    {
      name: 'headPivot', at: [0, 25, 0], pivot: true, children: [
        { name: 'neck', at: [0, -1, 0], size: [3, 2, 3], tex: 'bone' },
        { name: 'head', at: [0, 3.5, 0], size: [8, 7, 8], tex: 'bone', faces: { front: 'face' } },
      ],
    },
    { name: 'armL', at: [-4.5, 22.5, 0], size: [3, 12, 3], tex: 'bone', limb: true },
    { name: 'armR', at: [4.5, 22.5, 0], size: [3, 12, 3], tex: 'bone', limb: true },
    // The bow: a stave and a string, held out in front of the right arm so
    // the silhouette says "archer" at range.
    { name: 'bow', at: [6.5, 20, -7], size: [1, 10, 1], tex: 'dark' },
    { name: 'string', at: [6.5, 20, -7], size: [1, 10, 0.5], tex: 'bone' },
  ];

  const { group, handles: h, allMats } = buildFromSpec(SKELETON, spec, PX, T);

  function update(s) {
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.yaw;
    let rel = s.headYaw - s.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    h.headPivot.rotation.y = clamp(rel, -1.1, 1.1);
    h.headPivot.rotation.x = clamp(s.headPitch, -0.6, 0.6);
    const swing = Math.sin(s.walkPhase) * 0.6;
    h.legL.rotation.x = swing;
    h.legR.rotation.x = -swing;
    // The bow arm stays out; the other swings a little with the stride.
    h.armR.rotation.x = -Math.PI / 2 + Math.sin(s.walkPhase) * 0.06;
    h.armL.rotation.x = -Math.PI / 2 - Math.sin(s.walkPhase) * 0.08;
    applyCommon(h.root, allMats, s);
  }
  return { kind: SKELETON, group, update };
}

// ------------------------------------------------------------------- spider
//
// A low, wide body and eight legs, because the one thing a spider must
// never look like is the two-legged mobs it hunts beside. Each leg has two
// segments — a thigh from the body and a shin down to the ground — and the
// feet land exactly at the origin, which is the whole of the grounding fix:
// the previous spider stood with its eight feet two pixels under the
// floorboards.

export function createSpiderModel() {
  const T = spiderTextures();
  const PX = SP_PX;
  const spec = [
    // The eye head: a small box out front, its -Z face carrying four red
    // eyes.
    { name: 'head', at: [0, 10, -11], size: [8, 6, 6], tex: 'hide', faces: { front: 'face' } },
    // The abdomen: the big box behind the head.
    { name: 'abdomen', at: [0, 11, 5], size: [14, 10, 16], tex: 'hide' },
  ];

  const { group, handles: h, allMats } = buildFromSpec(SPIDER, spec, PX, T);

  // Eight legs, four a side. Each is a group at the body's side with two
  // segments: a thigh canted out and down, and a shin from the knee to the
  // floor. The rest pose puts every foot at y = 0.
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const zOff = (i >> 1) - 1.5; // -1.5..2
    const g = new THREE.Group();
    g.position.set(side * 5 * PX, 11 * PX, zOff * 5 * PX);
    g.rotation.z = -side * 0.55;

    const thigh = part(SPIDER, { name: 'legThigh', size: [1.5, 6, 1.5], at: [0, -1, 0], tex: 'dark' }, PX, T);
    allMats.push(thigh.material);
    g.add(thigh);

    const shin = new THREE.Group();
    shin.position.set(side * 2 * PX, -6.2 * PX, 0);
    shin.rotation.z = side * 0.5;
    const shinMesh = part(SPIDER, { name: 'legShin', size: [1.2, 5, 1.2], at: [0, -2.1, 0], tex: 'dark' }, PX, T);
    shin.add(shinMesh);
    allMats.push(shinMesh.material);
    g.add(shin);

    h.root.add(g);
    legs.push({ g, shin, baseRot: g.rotation.z, side });
  }

  function update(s) {
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.yaw;
    const swing = Math.sin(s.walkPhase) * 0.5;
    legs.forEach((leg, i) => {
      const phase = i % 2 === 0 ? swing : -swing;
      leg.g.rotation.z = leg.baseRot + phase * 0.3;
      leg.shin.rotation.z = leg.side * 0.5 - phase * 0.25;
    });
    applyCommon(h.root, allMats, s);
  }
  return { kind: SPIDER, group, update };
}

// --------------------------------------------------------------- quadrupeds
//
// Pig, cow and sheep are one idea with three paint jobs: a body, a head out
// in front of it, a neck joining the two, and four legs that trot in
// diagonal pairs. A chicken is the same idea on a smaller, two-legged
// scale. The builder below is shared so the three of them cannot drift
// apart in the way their legs swing or their heads sit — which is exactly
// the drift a player notices first.

/**
 * Build a four-legged animal. `opts`:
 *   px      — blocks per skin pixel
 *   body    — [w, h, d]
 *   head    — [w, h, d]
 *   leg     — [w, h, d]  (feet land exactly at y = 0)
 *   headAt  — [x, y, z]  the head pivot, in skin pixels
 *   bodyTex, headTex, legTex, faceTex, neckTex — texture keys
 *   extras  — [{ name, at, size, tex }]  (wool, horns, ears...)
 */
function buildQuadruped(kind, opts) {
  const T = quadrupedTextures();
  const px = opts.px;
  const spec = [];

  // Four legs hung from their tops at the body's underside — the hip is at
  // y = legH, so the foot is at exactly 0.
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  corners.forEach(([sx, sz], i) => {
    spec.push({
      name: `leg${i}`,
      at: [sx * (opts.body[0] / 2 - opts.leg[0] / 2), opts.leg[1], sz * (opts.body[2] / 2 - opts.leg[2] / 2)],
      size: opts.leg, tex: opts.legTex, limb: true,
    });
  });

  // The body, sitting on the legs.
  spec.push({
    name: 'body',
    at: [0, opts.leg[1] + opts.body[1] / 2, 0],
    size: opts.body, tex: opts.bodyTex,
  });

  // The neck: a box running from the body's front shoulder to the head
  // pivot, so the head is visibly *attached* rather than floating.
  const ny = opts.leg[1] + opts.body[1] - 2;
  spec.push({
    name: 'neck',
    at: [opts.headAt[0] * 0.55, ny, opts.headAt[2] * 0.55],
    size: [Math.max(3, opts.head[0] - 2), 4, Math.max(3, opts.head[2] - 2)],
    tex: opts.neckTex ?? opts.bodyTex,
  });

  // The head on its pivot.
  spec.push({
    name: 'headPivot', at: opts.headAt, pivot: true, children: [
      {
        name: 'head',
        at: [0, opts.head[1] / 2, 0],
        size: opts.head,
        tex: opts.headTex,
        faces: opts.faceTex ? { front: opts.faceTex } : undefined,
      },
    ],
  });

  for (const extra of opts.extras ?? []) spec.push(extra);

  const { group, handles: h, allMats } = buildFromSpec(kind, spec, px, T);

  function update(s) {
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.yaw;
    let rel = s.headYaw - s.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    h.headPivot.rotation.y = clamp(rel, -0.9, 0.9);
    h.headPivot.rotation.x = clamp(s.headPitch, -0.4, 0.4);
    // Diagonal pairs together — a four-legged trot.
    const swing = Math.sin(s.walkPhase) * 0.55;
    h.leg0.rotation.x = swing;
    h.leg3.rotation.x = swing;
    h.leg1.rotation.x = -swing;
    h.leg2.rotation.x = -swing;
    applyCommon(h.root, allMats, s);
  }
  return { kind, group, update };
}

export function createPigModel() {
  return buildQuadruped(PIG, {
    px: 0.9 / 32,
    body: [14, 11, 20],
    head: [8, 7, 8],
    leg: [4, 5, 4],
    headAt: [0, 13, -14],
    bodyTex: 'pig',
    headTex: 'pig',
    legTex: 'pigSnout',
    faceTex: 'pigFace',
    neckTex: 'pigSnout',
    extras: [
      // ears: two small boxes on top of the head
      { name: 'earL', at: [-2.5, 19.5, -14.5], size: [2, 1.5, 3], tex: 'pig' },
      { name: 'earR', at: [2.5, 19.5, -14.5], size: [2, 1.5, 3], tex: 'pig' },
    ],
  });
}

export function createCowModel() {
  return buildQuadruped(COW, {
    px: 1.4 / 32,
    body: [14, 12, 22],
    head: [8, 9, 10],
    leg: [4, 8, 4],
    headAt: [0, 17, -15],
    bodyTex: 'cow',
    headTex: 'cow',
    legTex: 'cow',
    faceTex: 'cowFace',
    neckTex: 'cow',
    extras: [
      // horns: two short boxes at the back of the head
      { name: 'hornL', at: [-2.5, 25.5, -15], size: [1.5, 2, 1.5], tex: 'cowSnout' },
      { name: 'hornR', at: [2.5, 25.5, -15], size: [1.5, 2, 1.5], tex: 'cowSnout' },
      // udder
      { name: 'udder', at: [0, 9, 6], size: [4, 3, 4], tex: 'cowSnout' },
    ],
  });
}

export function createSheepModel() {
  return buildQuadruped(SHEEP, {
    px: 1.3 / 32,
    body: [14, 9, 20],
    head: [7, 7, 7],
    leg: [4, 6, 4],
    headAt: [0, 13, -13],
    bodyTex: 'sheep',
    headTex: 'sheepDark',
    legTex: 'sheepDark',
    faceTex: 'sheepFace',
    neckTex: 'sheep',
    extras: [
      // the fleece: a second, larger body box, so the whole silhouette is
      // the white wool and only the face and legs are dark
      { name: 'wool', at: [0, 12, 0], size: [16, 12, 22], tex: 'sheep' },
    ],
  });
}

/** The chicken: the one two-legged animal. A round body, a tiny head with
 *  a beak and a comb, a neck, and two twig legs — feet exactly at 0. */
export function createChickenModel() {
  const T = quadrupedTextures();
  const PX = 0.85 / 24;
  const spec = [
    { name: 'legL', at: [-1.5, 4, 0], size: [1, 4, 1], tex: 'chickenDark', limb: true },
    { name: 'legR', at: [1.5, 4, 0], size: [1, 4, 1], tex: 'chickenDark', limb: true },
    { name: 'body', at: [0, 8, 0], size: [8, 8, 10], tex: 'chicken' },
    // a feathered neck rising from the breast to the head
    { name: 'neck', at: [0, 12.5, -4], size: [3, 3, 3], tex: 'chicken' },
    {
      name: 'headPivot', at: [0, 14, -7], pivot: true, children: [
        { name: 'head', at: [0, 2, 0], size: [5, 5, 5], tex: 'chicken', faces: { front: 'chickenFace' } },
        { name: 'beak', at: [0, 2, -3.5], size: [2, 1.5, 2], tex: 'beak' },
        { name: 'comb', at: [0, 5, 0], size: [2, 1.5, 2], tex: 'beak' },
      ],
    },
    { name: 'tail', at: [0, 11, 4.5], size: [2, 3, 2], tex: 'chickenDark' },
  ];

  const { group, handles: h, allMats } = buildFromSpec(CHICKEN, spec, PX, T);

  function update(s) {
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.yaw;
    let rel = s.headYaw - s.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    h.headPivot.rotation.y = clamp(rel, -1, 1);
    const swing = Math.sin(s.walkPhase) * 0.5;
    h.legL.rotation.x = swing;
    h.legR.rotation.x = -swing;
    applyCommon(h.root, allMats, s);
  }
  return { kind: CHICKEN, group, update };
}

/** Which factory builds which kind. The renderer only knows this table. */
export function createMobModel(kind) {
  switch (kind) {
    case CREEPER: return createCreeperModel();
    case SKELETON: return createSkeletonModel();
    case SPIDER: return createSpiderModel();
    case PIG: return createPigModel();
    case COW: return createCowModel();
    case CHICKEN: return createChickenModel();
    case SHEEP: return createSheepModel();
    default: return createZombieModel();
  }
}
