// Procedural 16x16 Minecraft-style block textures, generated on canvas.
// Each block gets a 48x16 atlas: [side | top | bottom] columns.
// Textures are generated with a seeded RNG so they look identical every load.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, clamp } from './utils.js';
import { WATER, isWater } from './terrain.js';
import { BUCKET, WATER_BUCKET, isItem } from './items.js';

export const TEX_SIZE = 16;

// ---------- value noise helper ----------
function makeNoise(rand, base) {
  // 2-octave value noise on a 16x16 grid
  const grid = [];
  for (let i = 0; i < 18 * 18; i++) grid.push(rand());
  const sample = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const a = grid[yi * 18 + xi];
    const b = grid[yi * 18 + xi + 1];
    const c = grid[(yi + 1) * 18 + xi];
    const d = grid[(yi + 1) * 18 + xi + 1];
    return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf);
  };
  const range = (x, y) => {
    const n = sample(x / 4, y / 4) * 0.6 + sample(x / 2, y / 2) * 0.4;
    return base + (n - 0.5) * 0.28;
  };
  return range;
}

function shadeHex(hex, f) {
  const r = clamp(Math.round(((hex >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((hex >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((hex & 255) * f), 0, 255);
  return (r << 16) | (g << 8) | b;
}

function noiseCanvas(rand, base, opts = {}) {
  const { speckles = 0, blotches = 0, blotchColor = 0x000000 } = opts;
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const range = makeNoise(rand, 1);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      let c = shadeHex(base, range(x, y));
      img.data[(y * TEX_SIZE + x) * 4] = (c >> 16) & 255;
      img.data[(y * TEX_SIZE + x) * 4 + 1] = (c >> 8) & 255;
      img.data[(y * TEX_SIZE + x) * 4 + 2] = c & 255;
      img.data[(y * TEX_SIZE + x) * 4 + 3] = 255;
    }
  }
  // darker/lighter speckles
  for (let i = 0; i < speckles; i++) {
    const x = Math.floor(rand() * TEX_SIZE);
    const y = Math.floor(rand() * TEX_SIZE);
    const f = 0.72 + rand() * 0.5;
    const c = shadeHex(base, f);
    const o = (y * TEX_SIZE + x) * 4;
    img.data[o] = (c >> 16) & 255;
    img.data[o + 1] = (c >> 8) & 255;
    img.data[o + 2] = c & 255;
  }
  // random darker blotches (cobblestone etc.)
  for (let i = 0; i < blotches; i++) {
    const cx = rand() * TEX_SIZE;
    const cy = rand() * TEX_SIZE;
    const r = 1.5 + rand() * 2.5;
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy < r * r * (0.6 + rand() * 0.4)) {
          const o = (y * TEX_SIZE + x) * 4;
          const f = 0.55 + rand() * 0.35;
          img.data[o] = clamp(Math.round(img.data[o] * f), 0, 255);
          img.data[o + 1] = clamp(Math.round(img.data[o + 1] * f), 0, 255);
          img.data[o + 2] = clamp(Math.round(img.data[o + 2] * f), 0, 255);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ---------- face recipes ----------

function dirtFace(rand) {
  return noiseCanvas(rand, 0x79553a, { speckles: 26, blotches: 2 });
}

function grassTopFace(rand) {
  return noiseCanvas(rand, 0x7cbd4b, { speckles: 30, blotches: 1 });
}

function grassSideFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.drawImage(dirtFace(rand), 0, 0);
  // green cap with ragged edge, 3-4 px deep
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  for (let x = 0; x < TEX_SIZE; x++) {
    const depth = 2 + Math.floor(rand() * 3); // 2..4
    const grass = shadeHex(0x7cbd4b, 0.82 + rand() * 0.3);
    const gr = (grass >> 16) & 255;
    const gg = (grass >> 8) & 255;
    const gb = grass & 255;
    for (let y = 0; y < depth; y++) {
      const o = (y * TEX_SIZE + x) * 4;
      const t = y / 4;
      img.data[o] = clamp(Math.round(gr + (img.data[o] - gr) * t), 0, 255);
      img.data[o + 1] = clamp(Math.round(gg + (img.data[o + 1] - gg) * t), 0, 255);
      img.data[o + 2] = clamp(Math.round(gb + (img.data[o + 2] - gb) * t), 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function stoneFace(rand) {
  return noiseCanvas(rand, 0x7f7f7f, { speckles: 40, blotches: 3 });
}

// Deepslate: darker and cooler than stone, with fine vertical banding so the
// switch is obvious the moment you dig past it.
function deepslateFace(rand) {
  const cv = noiseCanvas(rand, 0x3c3f44, { speckles: 55, blotches: 5, blotchColor: 0x2a2c30 });
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(28,30,34,0.5)';
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(rand() * TEX_SIZE);
    ctx.fillRect(x, Math.floor(rand() * TEX_SIZE), 1, 3 + Math.floor(rand() * 6));
  }
  return cv;
}

// Water. Drawn opaque here and made translucent by the material — the atlas
// is a single texture shared with every solid block, so the alpha has to
// come from somewhere else.
//
// This one is only the inventory icon and the block held in the hand. The
// water you see in the world is drawn from its own pair of textures below,
// because it has to scroll and the atlas cannot.
function waterFace(rand) {
  return noiseCanvas(rand, 0x3552d4, { speckles: 18, blotches: 4, blotchColor: 0x2c46bd });
}

function cobbleFace(rand) {
  return noiseCanvas(rand, 0x8a8a8a, { speckles: 60, blotches: 10, blotchColor: 0x5a5a5a });
}

function bedrockFace(rand) {
  const cv = noiseCanvas(rand, 0x4a4a4a, { speckles: 80, blotches: 14 });
  const ctx = cv.getContext('2d');
  // some near-black patches
  ctx.fillStyle = 'rgba(20,20,20,0.75)';
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(rand() * TEX_SIZE);
    const y = Math.floor(rand() * TEX_SIZE);
    ctx.fillRect(x, y, 1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 3));
  }
  // a few light flecks
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(rand() * TEX_SIZE);
    const y = Math.floor(rand() * TEX_SIZE);
    const o = (y * TEX_SIZE + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 130 + Math.floor(rand() * 90);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function planksFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const range = makeNoise(rand, 1);
  const seam = 0x5e431f;
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      let c = shadeHex(0xb8945f, range(x, y));
      // horizontal plank seams every 4 rows
      if (y % 4 === 0) c = shadeHex(seam, 0.9 + range(x, y) * 0.2);
      // vertical seam: staggered per plank row
      const row = Math.floor(y / 4);
      const seamX = row % 2 === 0 ? 3 : 11;
      if (x === seamX) c = shadeHex(seam, 0.9 + range(x, y) * 0.2);
      // subtle grain streaks
      if (range(x * 2, y * 2) > 0.72) c = shadeHex(c, 0.94);
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = (c >> 16) & 255;
      img.data[o + 1] = (c >> 8) & 255;
      img.data[o + 2] = c & 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function sandFace(rand) {
  return noiseCanvas(rand, 0xdbd3a0, { speckles: 50 });
}

function bricksFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const mortar = 0xd8d8d8;
  for (let y = 0; y < TEX_SIZE; y++) {
    const row = Math.floor(y / 4);
    for (let x = 0; x < TEX_SIZE; x++) {
      let c;
      const isMortarY = y % 4 === 3;
      const seamX = row % 2 === 0 ? 7 : 3;
      const isMortarX = x === seamX || x === seamX + 8;
      if (isMortarY || isMortarX) {
        c = shadeHex(mortar, 0.85 + rand() * 0.3);
      } else {
        // per-brick shade
        const brickShade = 0.82 + rand() * 0.36;
        c = shadeHex(0x9b4f2f, brickShade * (0.9 + rand() * 0.2));
      }
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = (c >> 16) & 255;
      img.data[o + 1] = (c >> 8) & 255;
      img.data[o + 2] = c & 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function snowFace(rand) {
  return noiseCanvas(rand, 0xf4f4f4, { speckles: 20 });
}

/**
 * Ice: pale blue, and cracked. The cracks are the whole tile, really — a flat
 * blue square reads as painted glass, and three or four pale fractures
 * running across it read as something frozen. They are drawn light rather
 * than dark because a crack in ice scatters the light back at you instead of
 * swallowing it, which is also why they show up from above on a dull day.
 */
function iceFace(rand) {
  const cv = noiseCanvas(rand, 0x76a6d8, { speckles: 8 });
  const ctx = cv.getContext('2d');
  const half = TEX_SIZE / 2;
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    // Each crack starts somewhere on an edge, sets off roughly across the
    // tile rather than straight back out of it, and wanders in short
    // segments — so it breaks rather than curves.
    let x = rand() * TEX_SIZE;
    let y = rand() < 0.5 ? 0 : TEX_SIZE;
    if (rand() < 0.5) { const t = x; x = y; y = t; }
    let angle = Math.atan2(half - y, half - x) + (rand() - 0.5) * 1.2;
    ctx.strokeStyle = `rgba(232,246,255,${0.5 + rand() * 0.4})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let seg = 0; seg < 3; seg++) {
      angle += (rand() - 0.5) * 1.3;
      x += Math.cos(angle) * (2 + rand() * 4);
      y += Math.sin(angle) * (2 + rand() * 4);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return cv;
}

/** Oak log: vertical bark grooves. */
function logSideFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const range = makeNoise(rand, 1);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      // vertical grain: darker in irregular columns
      const groove = Math.sin(x * 1.7 + range(x, y) * 2) > 0.55 ? 0.78 : 1;
      const c = shadeHex(0x6b4f2a, range(x, y * 0.4) * groove);
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = (c >> 16) & 255;
      img.data[o + 1] = (c >> 8) & 255;
      img.data[o + 2] = c & 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Cut end of a log: rings around a centre. */
function logTopFace(rand) {
  const cv = noiseCanvas(rand, 0xb4915c, { speckles: 18 });
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = 'rgba(90,64,32,0.55)';
  ctx.lineWidth = 1;
  for (const r of [2.5, 4.5, 6.5]) {
    ctx.beginPath();
    ctx.arc(8, 8, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return cv;
}

/** Leaves: dense mottled green. Opaque, like Minecraft's "fast" graphics. */
function leavesFace(rand) {
  const cv = noiseCanvas(rand, 0x3f7f2a, { speckles: 90, blotches: 6 });
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  // scatter a few bright and dark leaves so it reads as foliage, not noise
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rand() * TEX_SIZE);
    const y = Math.floor(rand() * TEX_SIZE);
    const c = shadeHex(0x4f9c34, 0.7 + rand() * 0.7);
    const o = (y * TEX_SIZE + x) * 4;
    img.data[o] = (c >> 16) & 255;
    img.data[o + 1] = (c >> 8) & 255;
    img.data[o + 2] = c & 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ---------- items ----------
// Items are drawn flat rather than as cubes, but their textures still live in
// the world atlas: the block in your hand is a mesh with atlas UVs and one
// shared material, and giving items a texture of their own would mean a
// second material and a second draw call for the sake of two sprites. Three
// identical tiles each is a rounding error against thirty-nine.

/** An empty pail: a galvanised body, a rim, and a handle over the top. */
function bucketFace(rand) {
  return bucketCanvas(rand, null);
}

/** The same pail with water in it, which is what a full one looks like. */
function waterBucketFace(rand) {
  return bucketCanvas(rand, 0x3a63d2);
}

function bucketCanvas(rand, fill) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  const px = (x, y, hex) => {
    ctx.fillStyle = `#${(hex >>> 0).toString(16).padStart(6, '0')}`;
    ctx.fillRect(x, y, 1, 1);
  };
  const IRON = 0x9ea4ad;
  const DARK = 0x6b7079;
  const LIGHT = 0xc6ccd4;

  // The handle: an arc of single pixels over the mouth.
  for (const [x, y] of [[4, 3], [5, 2], [6, 2], [9, 2], [10, 2], [11, 3]]) px(x, y, DARK);

  // The body tapers in toward the base, the way a pail does.
  for (let y = 4; y <= 13; y++) {
    const inset = y >= 11 ? 1 : 0;
    for (let x = 3 + inset; x <= 12 - inset; x++) {
      const edge = x === 3 + inset || x === 12 - inset;
      const shade = 0.86 + rand() * 0.2;
      px(x, y, shadeHex(edge ? DARK : IRON, shade));
    }
  }
  // A rim, and a highlight down the left so it does not read as a flat slab.
  for (let x = 3; x <= 12; x++) px(x, 4, shadeHex(LIGHT, 0.9 + rand() * 0.2));
  for (let y = 5; y <= 12; y++) px(4, y, shadeHex(LIGHT, 0.9));

  if (fill !== null) {
    for (let y = 5; y <= 12; y++) {
      const inset = y >= 11 ? 1 : 0;
      for (let x = 5 + inset; x <= 11 - inset; x++) {
        px(x, y, shadeHex(fill, 0.82 + rand() * 0.3));
      }
    }
  }
  return cv;
}

// ---------- block registry ----------

// Each entry: { id, name, side, top, bottom } where side/top/bottom are
// face-recipe functions returning a 16x16 canvas.
export const BLOCK_DEFS = [
  { id: 1, name: 'Grass Block', side: grassSideFace, top: grassTopFace, bottom: dirtFace },
  { id: 2, name: 'Dirt', side: dirtFace, top: dirtFace, bottom: dirtFace },
  { id: 3, name: 'Stone', side: stoneFace, top: stoneFace, bottom: stoneFace },
  { id: 4, name: 'Cobblestone', side: cobbleFace, top: cobbleFace, bottom: cobbleFace },
  { id: 5, name: 'Oak Planks', side: planksFace, top: planksFace, bottom: planksFace },
  { id: 6, name: 'Sand', side: sandFace, top: sandFace, bottom: sandFace },
  { id: 7, name: 'Bricks', side: bricksFace, top: bricksFace, bottom: bricksFace },
  { id: 8, name: 'Bedrock', side: bedrockFace, top: bedrockFace, bottom: bedrockFace },
  { id: 9, name: 'Snow Block', side: snowFace, top: snowFace, bottom: snowFace },
  { id: 10, name: 'Oak Log', side: logSideFace, top: logTopFace, bottom: logTopFace },
  { id: 11, name: 'Leaves', side: leavesFace, top: leavesFace, bottom: leavesFace },
  { id: 12, name: 'Deepslate', side: deepslateFace, top: deepslateFace, bottom: deepslateFace },
  { id: 13, name: 'Water', side: waterFace, top: waterFace, bottom: waterFace },
  // 14..21 are the flowing water levels, which share the source's tile.
  { id: 22, name: 'Ice', side: iceFace, top: iceFace, bottom: iceFace },
];

/**
 * Items. Same shape as a block def so one registry, one icon path and one
 * name lookup serve both; the three faces are simply the same sprite, because
 * a flat thing has no sides.
 */
export const ITEM_DEFS = [
  { id: BUCKET, name: 'Bucket', item: true, side: bucketFace, top: bucketFace, bottom: bucketFace },
  { id: WATER_BUCKET, name: 'Water Bucket', item: true, side: waterBucketFace, top: waterBucketFace, bottom: waterBucketFace },
];

/** Everything with a texture in the atlas: blocks first, then items. */
export const ATLAS_DEFS = [...BLOCK_DEFS, ...ITEM_DEFS];

/**
 * What you start with. Nine slots and ten things worth having, so the oak log
 * loses its place — it is the one you can get back by walking up to a tree,
 * and the bucket is the one that turns every pond in the world into somewhere
 * you can build.
 */
export const STARTER_BLOCKS = [1, 2, 3, 4, 5, 6, 7, 9, BUCKET];

/**
 * Build a 48x16 atlas canvas for a block: [side | top | bottom].
 * Also returns the individual faces (for inventory icons).
 */
function buildAtlas(block) {
  const rand = mulberry32(block.id * 7919 + 13);
  const side = block.side(rand);
  const top = block.top(rand);
  const bottom = block.bottom(rand);
  const cv = document.createElement('canvas');
  cv.width = TEX_SIZE * 3;
  cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.drawImage(side, 0, 0);
  ctx.drawImage(top, TEX_SIZE, 0);
  ctx.drawImage(bottom, TEX_SIZE * 2, 0);
  return { atlas: cv, side, top };
}

// ---------- inventory icons ----------
// Minecraft draws item icons as an isometric cube: the top face as a rhombus
// with the two lit/shaded side faces below it. Each face is a 2x3 affine
// transform mapping the 16x16 texture onto its parallelogram.

const ICON_SCALE = 3; // canvas pixels per texel -> 96x96 icon

function drawIconFace(ctx, img, m, shade) {
  const S = TEX_SIZE;
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.imageSmoothingEnabled = false;
  // Slight overdraw hides the hairline seams between the three faces.
  ctx.drawImage(img, 0, 0, S, S, -0.03, -0.03, S + 0.06, S + 0.06);
  ctx.restore();
  if (!shade) return;
  const pt = (u, v) => [m.a * u + m.c * v + m.e, m.b * u + m.d * v + m.f];
  const corners = [pt(0, 0), pt(S, 0), pt(S, S), pt(0, S)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${shade})`;
  ctx.fill();
  ctx.restore();
}

/**
 * An item icon is the sprite itself, scaled up. No cube: a bucket drawn as a
 * cube would be a box with a picture of a bucket on three of its faces.
 */
function buildFlatIcon(face) {
  const q = TEX_SIZE * ICON_SCALE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = q * 2;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Inset a little so the sprite has the same visual weight as the cubes it
  // sits beside in the hotbar, which fill their tile corner to corner.
  const pad = q * 0.18;
  ctx.drawImage(face, pad, pad, q * 2 - pad * 2, q * 2 - pad * 2);
  return cv;
}

function buildIcon(side, top) {
  const q = TEX_SIZE * ICON_SCALE; // half-width of the cube (48)
  const cv = document.createElement('canvas');
  cv.width = q * 2;
  cv.height = q * 2;
  const ctx = cv.getContext('2d');
  const h = q / 2; // vertical drop of the isometric edges
  const k = ICON_SCALE; // texel -> canvas px along a face edge
  // top rhombus: (0,h) (q,0) (2q,h) (q,2h)
  drawIconFace(ctx, top, { a: k, b: -k / 2, c: k, d: k / 2, e: 0, f: h }, 0);
  // left face
  drawIconFace(ctx, side, { a: k, b: k / 2, c: 0, d: k, e: 0, f: h }, 0.28);
  // right face
  drawIconFace(ctx, side, { a: k, b: -k / 2, c: 0, d: k, e: q, f: 2 * h }, 0.12);
  return cv;
}

// ---------- world atlas ----------
// Every block face lives in one texture so a whole chunk draws in a single
// call. Tile order is [side, top, bottom] per block, in BLOCK_DEFS order.
//
// Mipmaps are built by hand rather than by the GPU: an automatically
// generated mip level averages across tile boundaries, so at distance a
// stone block bleeds into its neighbour in the atlas. Downsampling each tile
// on its own and packing the results keeps every level clean.

export const ATLAS_TILES = ATLAS_DEFS.length * 3;

/** Tile index for a block id and face column (0 side, 1 top, 2 bottom). */
export function atlasTile(blockId, column) {
  // Every water level shares the source's tiles: eight ids, one appearance,
  // and no reason to widen the atlas by 21 tiles that are all the same.
  const id = isWater(blockId) ? WATER : blockId;
  const i = ATLAS_DEFS.findIndex((b) => b.id === id);
  return (i < 0 ? 0 : i) * 3 + column;
}

function tileCanvases() {
  const tiles = [];
  for (const block of ATLAS_DEFS) {
    const rand = mulberry32(block.id * 7919 + 13);
    tiles.push(block.side(rand), block.top(rand), block.bottom(rand));
  }
  return tiles;
}

/**
 * Draw every tile side by side at `tileSize` pixels each.
 * The strip is written upside down because the texture is uploaded with
 * flipY off (DataTexture), and the face UVs put v = 1 at the top of a block.
 */
function packLevel(tiles, tileSize) {
  const cv = document.createElement('canvas');
  cv.width = tileSize * tiles.length;
  cv.height = tileSize;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = tileSize < TEX_SIZE; // box-filter when shrinking
  ctx.translate(0, tileSize);
  ctx.scale(1, -1);
  tiles.forEach((tile, i) => {
    ctx.drawImage(tile, 0, 0, TEX_SIZE, TEX_SIZE, i * tileSize, 0, tileSize, tileSize);
  });
  return ctx.getImageData(0, 0, cv.width, cv.height);
}

let atlasTexture = null;

/** The shared world texture: one tile strip with hand-built mipmaps. */
export function getAtlasTexture() {
  if (atlasTexture) return atlasTexture;
  const tiles = tileCanvases();

  const levels = [];
  for (let size = TEX_SIZE; size >= 1; size = size >> 1) {
    levels.push(packLevel(tiles, size));
  }

  const tex = new THREE.DataTexture(
    levels[0].data, levels[0].width, levels[0].height, THREE.RGBAFormat
  );
  tex.mipmaps = levels.map((img) => ({ data: img.data, width: img.width, height: img.height }));
  tex.generateMipmaps = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  atlasTexture = tex;
  return tex;
}

// ---------- water ----------
// Water gets its own two textures rather than a slot in the world atlas, for
// one reason: it moves. An atlas cannot scroll — shifting it would drag every
// other block's texture along with the water — but a texture of its own can
// be offset a little further every frame, and since water is already drawn in
// its own translucent pass, that costs nothing extra.
//
// They hold no colour, only light and shade around a mid grey. The colour of
// water is not a property of a 16x16 tile — it depends on how deep it is, how
// you are looking at it and what is above it to reflect — so the shader works
// it out and these supply the hand-drawn pattern moving across the top of it.
// Keeping the pixel tile is what stops all this from reading as a lake in
// some other engine: it is still Minecraft's water, moving over Minecraft's
// blocks.
//
// Both tiles are built from a handful of sine harmonics with whole-number
// periods across the tile, which makes them seamless in both directions by
// construction. Seamless matters more than it sounds: the sea maps one copy
// of the still tile to every block, and any join at all would show up as the
// grid of squares this is here to avoid.

/** Sum of sine harmonics, evaluated on a tile that wraps in both axes. */
function harmonics(x, y, terms) {
  let v = 0;
  for (const [kx, ky, phase, amp] of terms) {
    v += Math.sin(((kx * x + ky * y) / TEX_SIZE) * Math.PI * 2 + phase) * amp;
  }
  return v;
}

/** A grey tile: 128 is "no change", and the harmonics swing either side of it. */
function waterCanvas(terms) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const v = clamp(Math.round(128 + harmonics(x, y, terms) * 127), 0, 255);
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Calm water: broad, slow swells crossing each other. */
function stillWaterCanvas() {
  return waterCanvas([
    [1, 1, 0.0, 0.50],
    [2, -1, 1.7, 0.30],
    [1, -3, 4.1, 0.20],
    [3, 2, 2.4, 0.15],
  ]);
}

/**
 * Moving water: streaks that run down the tile. The v axis is the direction of
 * travel — the mesher rotates the tile so that v points downhill — so the
 * pattern is mostly a function of u, with just enough variation along v to
 * keep it from looking like a barcode.
 */
function flowingWaterCanvas() {
  return waterCanvas([
    [4, 0, 0.0, 0.55],
    [7, 0, 2.2, 0.25],
    [2, 0, 4.4, 0.30],
    [3, 1, 1.1, 0.18],
    [5, 2, 3.3, 0.12],
  ]);
}

let waterTextures = null;

/**
 * The two world-water patterns, { still, flowing }. Both repeat in both
 * directions so the surface tiles across blocks and the scroll wraps cleanly.
 *
 * No colour space conversion: these are not pictures of anything, they are
 * numbers the shader multiplies by, and running them through an sRGB decode
 * would bend the scale so that "no change" was no longer in the middle.
 */
export function getWaterTextures() {
  if (waterTextures) return waterTextures;
  const make = (canvas) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  waterTextures = {
    still: make(stillWaterCanvas()),
    flowing: make(flowingWaterCanvas()),
  };
  return waterTextures;
}

const cache = new Map();

/**
 * Returns { texture: THREE.CanvasTexture (48x16 atlas), iconUrl } for a block
 * def. `iconUrl` is the isometric cube used by the hotbar and inventory.
 */
export function getBlockAssets(block) {
  if (cache.has(block.id)) return cache.get(block.id);
  const { atlas, side, top } = buildAtlas(block);
  const texture = new THREE.CanvasTexture(atlas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const iconUrl = (isItem(block.id) ? buildFlatIcon(side) : buildIcon(side, top)).toDataURL();
  const assets = { texture, iconUrl };
  cache.set(block.id, assets);
  return assets;
}

/** Look up a block definition by id (null for air / unknown ids). */
export function getBlockDefById(id) {
  return ATLAS_DEFS.find((b) => b.id === id) ?? null;
}

/** Display name for a block or item id. */
export function blockName(id) {
  return getBlockDefById(id)?.name ?? 'Air';
}
