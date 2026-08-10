// Procedural 16x16 Minecraft-style block textures, generated on canvas.
// Each block gets a 48x16 atlas: [side | top | bottom] columns.
// Textures are generated with a seeded RNG so they look identical every load.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, clamp } from './utils.js';

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
];

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
  const iconUrl = buildIcon(side, top).toDataURL();
  const assets = { texture, iconUrl };
  cache.set(block.id, assets);
  return assets;
}

/** Look up a block definition by id (null for air / unknown ids). */
export function getBlockDefById(id) {
  return BLOCK_DEFS.find((b) => b.id === id) ?? null;
}

/** Display name for a block id. */
export function blockName(id) {
  return getBlockDefById(id)?.name ?? 'Air';
}
