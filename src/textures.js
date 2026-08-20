// Procedural 16x16 Minecraft-style block textures, generated on canvas.
// Each block gets a 48x16 atlas: [side | top | bottom] columns.
// Textures are generated with a seeded RNG so they look identical every load.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, clamp } from './utils.js';
import { WATER, isWater, CRAFTING_TABLE, FURNACE, GLASS, TNT } from './terrain.js';
import {
  BUCKET, WATER_BUCKET, PICKAXE, SHOVEL,
  STICKS, WOOD_PICKAXE, WOOD_SHOVEL, STONE_PICKAXE, STONE_SHOVEL, isItem,
} from './items.js';

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

/** A colour number as the CSS the 2D context wants. */
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

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
  return noiseCanvas(rand, 0x866043, { speckles: 30, blotches: 3 });
}

function grassTopFace(rand) {
  const cv = noiseCanvas(rand, 0x6aac3c, { speckles: 36, blotches: 2 });
  // A scatter of individual blade-green pixels so the top reads as turf
  // rather than as a flat green plane.
  const img = cv.getContext('2d').getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(rand() * TEX_SIZE);
    const y = Math.floor(rand() * TEX_SIZE);
    const c = shadeHex(0x8fd04e, 0.75 + rand() * 0.5);
    const o = (y * TEX_SIZE + x) * 4;
    img.data[o] = (c >> 16) & 255;
    img.data[o + 1] = (c >> 8) & 255;
    img.data[o + 2] = c & 255;
  }
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}

function grassSideFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.drawImage(dirtFace(rand), 0, 0);
  // The classic grass-block side: a clean green cap sitting on the dirt,
  // with a ragged bottom edge where the two meet. The cap is 3-4 px deep,
  // like Minecraft's, and the join is a couple of pixel teeth rather than
  // a smooth blend.
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  for (let x = 0; x < TEX_SIZE; x++) {
    const cap = 3 + Math.floor(rand() * 1.5); // 3..4
    const teeth = rand() < 0.5 ? 1 : 0; // ragged lip
    const depth = cap + teeth;
    const grass = shadeHex(0x6aac3c, 0.88 + rand() * 0.24);
    const gr = (grass >> 16) & 255;
    const gg = (grass >> 8) & 255;
    const gb = grass & 255;
    for (let y = 0; y < depth; y++) {
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = gr;
      img.data[o + 1] = gg;
      img.data[o + 2] = gb;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function stoneFace(rand) {
  // Minecraft's stone: a mid grey with soft patches of lighter and darker
  // rock, speckled across the tile. The blotches give it depth, the
  // speckles give it grit.
  return noiseCanvas(rand, 0x7f7f7f, { speckles: 52, blotches: 6 });
}

/**
 * An ore: rock with something in it.
 *
 * Minecraft's ores are the same rock with a handful of coloured lumps, and
 * the lumps are what you learn to spot from across a cavern — so they are
 * drawn as a few blobs with a darker rim and a bright facet on the
 * upper-left, which is the whole of "this is a crystal and not a stain".
 *
 * The rock is a parameter because there are two of them: below the deepslate
 * line the same vein is drawn on deepslate, or it would be a bright grey
 * patch hanging in a near-black wall.
 */
function oreFace(base, colour, shine, lumps = 5) {
  return (rand) => {
    const cv = base(rand);
    const ctx = cv.getContext('2d');
    for (let i = 0; i < lumps; i++) {
      const x = 1 + Math.floor(rand() * (TEX_SIZE - 4));
      const y = 1 + Math.floor(rand() * (TEX_SIZE - 4));
      const w = 2 + Math.floor(rand() * 2);
      const h = 2 + Math.floor(rand() * 2);
      // The rim is the lump's own colour turned down, not its bits masked
      // off: masking drops each channel to whatever is left under 0x80,
      // which is a different hue rather than a darker one — it turned
      // iron's warm tan into magenta.
      ctx.fillStyle = hex(shadeHex(colour, 0.45));
      ctx.fillRect(x, y, w + 1, h + 1);
      ctx.fillStyle = hex(colour);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = hex(shine);
      ctx.fillRect(x, y, 1, 1);
    }
    return cv;
  };
}


// Deepslate: darker and cooler than stone, with the fine dark streaks that
// make the switch obvious the moment you dig past it. Minecraft's deepslate
// reads as near-black rock with subtle lighter inclusions, not as grey with
// black lines — so the speckles are the light parts here.
function deepslateFace(rand) {
  const cv = noiseCanvas(rand, 0x35373c, { speckles: 60, blotches: 6, blotchColor: 0x24262b });
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  // A few faint light inclusions, like the quartz flecks in real deepslate.
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(rand() * TEX_SIZE);
    const y = Math.floor(rand() * TEX_SIZE);
    const o = (y * TEX_SIZE + x) * 4;
    const v = 96 + Math.floor(rand() * 46);
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v + 6;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// The ten ore tiles: five lumps, on each of the two rocks. Most of the
// colours carry over unchanged; the ones that move are the two that would
// otherwise disappear into the darker rock. Coal goes *down* rather than up —
// its lumps read on deepslate as holes in it, which is what they look like in
// Minecraft too — while diamond and redstone are brightened, because a
// gemstone that is dimmer than the wall around it is not a gemstone.
const ORE_LUMPS = [
  { name: 'coal', colour: 0x24242a, deep: 0x101014, shine: 0x53535c, deepShine: 0x6c6c78, lumps: 6 },
  { name: 'iron', colour: 0xc4906a, deep: 0xc4906a, shine: 0xe8c2a2, deepShine: 0xf0d0b4, lumps: 5 },
  { name: 'gold', colour: 0xf0c23a, deep: 0xf0c23a, shine: 0xfff0a8, deepShine: 0xfff0a8, lumps: 5 },
  { name: 'redstone', colour: 0xd0202a, deep: 0xe0303a, shine: 0xff6a6a, deepShine: 0xff8080, lumps: 6 },
  { name: 'diamond', colour: 0x39d9d2, deep: 0x4ee8e0, shine: 0xbdfffb, deepShine: 0xd6fffd, lumps: 4 },
];
const [coalFace, ironFace, goldFace, redstoneFace, diamondFace] =
  ORE_LUMPS.map((o) => oreFace(stoneFace, o.colour, o.shine, o.lumps));
const [deepCoalFace, deepIronFace, deepGoldFace, deepRedstoneFace, deepDiamondFace] =
  ORE_LUMPS.map((o) => oreFace(deepslateFace, o.deep, o.deepShine, o.lumps));

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
  // Cobblestone in Minecraft is a mosaic of rounded stones with dark mortar
  // between them. Build it from a handful of irregular blobs on a dark
  // background, each one shaded like a little boulder.
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  // mortar base
  for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
    const f = 0.42 + rand() * 0.16;
    const v = Math.round(96 * f);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v + 4;
    img.data[i * 4 + 3] = 255;
  }
  // stones: ~7 irregular ellipses
  const stones = 7;
  for (let s = 0; s < stones; s++) {
    const cx = 2 + rand() * (TEX_SIZE - 4);
    const cy = 2 + rand() * (TEX_SIZE - 4);
    const rx = 2.2 + rand() * 2.2;
    const ry = 2.0 + rand() * 2.0;
    const base = Math.round(110 + rand() * 80);
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        // noise inside the stone
        const f = 0.82 + rand() * 0.36;
        let v = Math.round(base * f);
        if (rand() < 0.25) v *= 0.85; // fleck
        // simple top-light: brighter on the upper-left
        v *= 0.9 + 0.22 * (1 - (dy + 1) / 2);
        const o = (y * TEX_SIZE + x) * 4;
        img.data[o] = v;
        img.data[o + 1] = v;
        img.data[o + 2] = v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
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
  // Oak planks: four horizontal boards with staggered end joints, a warm
  // honey tone, and the little darker dots Minecraft gives each plank.
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const range = makeNoise(rand, 1);
  const seam = 0x4a3418;
  for (let y = 0; y < TEX_SIZE; y++) {
    const row = Math.floor(y / 4);
    for (let x = 0; x < TEX_SIZE; x++) {
      let c = shadeHex(0xb8945f, range(x, y));
      // horizontal plank seams every 4 rows
      if (y % 4 === 0) c = shadeHex(seam, 0.9 + range(x, y) * 0.2);
      // vertical seam: staggered per plank row
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
  // the two little plank nail dots per board, like Minecraft's planks
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 2;
    for (const x of [row % 2 === 0 ? 1 : 9, row % 2 === 0 ? 13 : 5]) {
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = 62;
      img.data[o + 1] = 46;
      img.data[o + 2] = 28;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function sandFace(rand) {
  // Minecraft's sand is a warm pale yellow with a fine grain of darker
  // specks — enough to read as sand rather than as a flat cream tile.
  return noiseCanvas(rand, 0xdbd4a2, { speckles: 64 });
}

function bricksFace(rand) {
  // Brick: four courses of two bricks each, red-orange with a pale mortar
  // grid — the same layout Minecraft uses, right down to the offset joints.
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const mortar = 0xd9d4cc;
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
        // per-brick shade with a warmer, more saturated body
        const brickShade = 0.86 + rand() * 0.34;
        c = shadeHex(0xa0522d, brickShade * (0.92 + rand() * 0.16));
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

/** Oak log: vertical bark grooves, like Minecraft's oak log sides. */
function logSideFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const range = makeNoise(rand, 1);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      // vertical grain: darker in irregular columns, with the dark grooves
      // a couple of pixels wide like real bark rather than single lines
      const g1 = Math.sin(x * 1.3 + range(x, y) * 2.2);
      const g2 = Math.sin(x * 2.6 + range(x, y) * 3.1);
      const groove = (g1 > 0.72 || g2 > 0.8) ? 0.68 : 1;
      const c = shadeHex(0x6b4f2a, range(x, y * 0.4) * groove * (0.92 + range(x, y) * 0.16));
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

/** Cut end of a log: rings around a centre, like Minecraft's oak top. */
function logTopFace(rand) {
  const cv = noiseCanvas(rand, 0x9c7e4c, { speckles: 26 });
  const ctx = cv.getContext('2d');
  // A slightly darker centre, then the rings stepping out — each one a full
  // circle rather than a path, so the ends meet cleanly.
  ctx.fillStyle = 'rgba(70,50,25,0.25)';
  ctx.beginPath();
  ctx.arc(8, 8, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,50,25,0.5)';
  ctx.lineWidth = 1;
  for (const r of [3, 4.8, 6.4]) {
    ctx.beginPath();
    ctx.arc(8, 8, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return cv;
}

/** Leaves: dense mottled green. Opaque, like Minecraft's "fast" graphics. */
function leavesFace(rand) {
  const cv = noiseCanvas(rand, 0x3c7a24, { speckles: 100, blotches: 8 });
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  // Scatter bright and dark leaf pixels so it reads as foliage. Minecraft's
  // leaves are a deep green with a lot of small-scale variation — nearly
  // every pixel differs slightly from its neighbour.
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rand() * TEX_SIZE);
    const y = Math.floor(rand() * TEX_SIZE);
    const c = shadeHex(0x549c33, 0.6 + rand() * 0.8);
    const o = (y * TEX_SIZE + x) * 4;
    img.data[o] = (c >> 16) & 255;
    img.data[o + 1] = (c >> 8) & 255;
    img.data[o + 2] = c & 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ---------- crafting-era blocks ----------

/** Crafting table top: a 2x2 grid of planks with dark borders. */
function craftingTopFace(rand) {
  const cv = planksFace(rand);
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = 'rgba(60,40,18,0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, 7.5, 7.5);
  ctx.strokeRect(8.5, 0.5, 7.5, 7.5);
  ctx.strokeRect(0.5, 8.5, 7.5, 7.5);
  ctx.strokeRect(8.5, 8.5, 7.5, 7.5);
  return cv;
}

/** Crafting table side: a plank face with two handles and a tool under it. */
function craftingSideFace(rand) {
  const cv = planksFace(rand);
  const ctx = cv.getContext('2d');
  // Two small dark handles.
  ctx.fillStyle = '#5a3d1c';
  ctx.fillRect(4, 7, 2, 2);
  ctx.fillRect(10, 7, 2, 2);
  ctx.fillStyle = '#3a2712';
  ctx.fillRect(4, 7, 1, 2);
  ctx.fillRect(10, 7, 1, 2);
  // A pencil/saw hint: a diagonal pale line.
  ctx.strokeStyle = 'rgba(150,110,60,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(2, 12);
  ctx.lineTo(13, 3);
  ctx.stroke();
  return cv;
}

/** Furnace side: rough stone with a pale outline band. */
function furnaceSideFace(rand) {
  const cv = stoneFace(rand);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(20,20,20,0.35)';
  ctx.fillRect(0, 0, 16, 1);
  ctx.fillRect(0, 15, 16, 1);
  ctx.fillRect(0, 0, 1, 16);
  ctx.fillRect(15, 0, 1, 16);
  return cv;
}

/** Furnace front: the dark mouth with a fire glow, like Minecraft's. */
function furnaceFrontFace(rand) {
  const cv = furnaceSideFace(rand);
  const ctx = cv.getContext('2d');
  // Dark mouth
  ctx.fillStyle = '#1a1715';
  ctx.fillRect(5, 4, 6, 8);
  ctx.fillStyle = '#0d0b0a';
  ctx.fillRect(5, 4, 6, 1);
  // Fire: orange core with yellow heart
  ctx.fillStyle = '#8a4a1a';
  ctx.fillRect(7, 8, 2, 4);
  ctx.fillStyle = '#d4762a';
  ctx.fillRect(7, 8, 2, 3);
  ctx.fillStyle = '#f5c04a';
  ctx.fillRect(8, 9, 1, 1);
  // Grey trim around the mouth
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(5, 4, 6, 1);
  ctx.fillRect(5, 12, 6, 1);
  ctx.fillRect(5, 4, 1, 8);
  ctx.fillRect(10, 4, 1, 8);
  return cv;
}

/** Furnace top: flat stone. */
function furnaceTopFace(rand) {
  return stoneFace(rand);
}

/**
 * Glass: mostly transparent, with a pale frame and a diagonal shine — the
 * fast-graphics look. Most pixels have alpha 0; the world material uses
 * alphaTest to cut them out.
 */
function glassFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  // Frame
  ctx.fillStyle = 'rgba(210,235,255,0.9)';
  ctx.fillRect(0, 0, TEX_SIZE, 1);
  ctx.fillRect(0, 15, TEX_SIZE, 1);
  ctx.fillRect(0, 0, 1, TEX_SIZE);
  ctx.fillRect(15, 0, 1, TEX_SIZE);
  // Inner frame highlight (bottom-right thickens like a real pane)
  ctx.fillStyle = 'rgba(235,248,255,0.75)';
  ctx.fillRect(14, 1, 1, 14);
  ctx.fillRect(1, 14, 13, 1);
  ctx.fillStyle = 'rgba(160,195,225,0.7)';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillRect(15, 15, 1, 1);
  // Diagonal shine
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(3, 5, 1, 1);
  ctx.fillRect(4, 4, 1, 1);
  ctx.fillRect(5, 3, 1, 1);
  ctx.fillRect(6, 2, 1, 1);
  ctx.fillRect(5, 5, 1, 1);
  ctx.fillRect(6, 4, 1, 1);
  return cv;
}

/** TNT: red with a pale band and "TNT" hinted by three dark marks. */
function tntSideFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  // Red body with subtle noise.
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const f = 0.85 + rand() * 0.3;
      const r = Math.round(0xd03020 * f);
      const g = Math.round(0x1c1c1c * f);
      const b = Math.round(0x1c1c1c * f);
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = Math.min(255, r + 30);
      img.data[o + 1] = Math.min(255, g + 22);
      img.data[o + 2] = Math.min(255, b + 22);
      img.data[o + 3] = 255;
    }
  }
  // The pale band and the three dark "TNT" dashes, like Minecraft's.
  for (let x = 0; x < TEX_SIZE; x++) {
    for (let y = 6; y <= 9; y++) {
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = 232; img.data[o + 1] = 226; img.data[o + 2] = 214;
    }
  }
  for (let i = 0; i < 3; i++) {
    const x0 = 2 + i * 4;
    for (let x = x0; x < x0 + 3; x++) {
      for (let y = 7; y <= 8; y++) {
        const o = (y * TEX_SIZE + x) * 4;
        img.data[o] = 40; img.data[o + 1] = 30; img.data[o + 2] = 30;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** TNT top/bottom: red with lighter speckles. */
function tntTopFace(rand) {
  return noiseCanvas(rand, 0xb02018, { speckles: 24, blotches: 2, blotchColor: 0x6a100c });
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

/**
 * A tool: a wooden haft corner to corner, and a head at the top of it.
 *
 * Both tools are the same picture with a different head, because that is what
 * they are — Minecraft's pickaxe and shovel share a stick and differ in what
 * is lashed to it, and at sixteen pixels the head is the only part with room
 * to say anything.
 */
function toolCanvas(rand, head) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // The haft, bottom-left to top-right, with a darker edge under it.
  ctx.strokeStyle = '#4a3418';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(3.5, 13.5);
  ctx.lineTo(10.5, 5.5);
  ctx.stroke();
  ctx.strokeStyle = '#8a6532';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(3.5, 13.5);
  ctx.lineTo(10.5, 5.5);
  ctx.stroke();

  head(ctx);
  return cv;
}

/** Iron, as three tones: the shadow, the metal, and the light along its edge. */
const IRON_DARK = '#6e7378';
const IRON = '#b9c0c6';
const IRON_LIGHT = '#e7edf2';

function pickaxeFace(rand) {
  return toolCanvas(rand, (ctx) => {
    // A shallow arc across the top with two points turned down at its ends.
    ctx.strokeStyle = IRON_DARK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5.5, 5.5);
    ctx.quadraticCurveTo(10.5, 1.0, 14.5, 5.0);
    ctx.stroke();
    ctx.strokeStyle = IRON;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(5.5, 5.5);
    ctx.quadraticCurveTo(10.5, 1.6, 14.5, 5.0);
    ctx.stroke();
    ctx.fillStyle = IRON_LIGHT;
    ctx.fillRect(9, 2, 3, 1);
  });
}

function shovelFace(rand) {
  return toolCanvas(rand, (ctx) => {
    // A blade: a square with its bottom corners taken off.
    ctx.fillStyle = IRON_DARK;
    ctx.fillRect(8, 2, 7, 7);
    ctx.fillStyle = IRON;
    ctx.fillRect(9, 3, 5, 5);
    ctx.fillStyle = IRON_LIGHT;
    ctx.fillRect(9, 3, 2, 1);
    ctx.clearRect(8, 8, 1, 1);
    ctx.clearRect(14, 8, 1, 1);
  });
}

/** Two sticks crossed: the crafting ingredient, drawn corner to corner. */
function sticksFace(rand) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  const drawStick = (x0, y0, x1, y1, light, dark) => {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y0 + 0.5);
    ctx.lineTo(x1 + 0.5, y1 + 0.5);
    ctx.stroke();
    ctx.strokeStyle = light;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  // One stick bottom-left to top-right, one crossed over it.
  drawStick(3, 13, 12, 4, '#a5824a', '#5c401f');
  drawStick(3, 4, 12, 12, '#9a7a42', '#54401f');
  return cv;
}

/**
 * Wooden tool heads: the same haft as the iron tools with a pale wood head.
 * Minecraft's wooden tools are visibly lighter than stone or iron, and the
 * difference matters here because you craft them — the sprite is how you
 * tell the tiers apart at a glance.
 */
const WOOD_DARK = '#5c401f';
const WOOD = '#8a6532';
const WOOD_LIGHT = '#b8945f';

function woodPickaxeFace(rand) {
  return toolCanvas(rand, (ctx) => {
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5.5, 5.5);
    ctx.quadraticCurveTo(10.5, 1.0, 14.5, 5.0);
    ctx.stroke();
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(5.5, 5.5);
    ctx.quadraticCurveTo(10.5, 1.6, 14.5, 5.0);
    ctx.stroke();
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(9, 2, 3, 1);
  });
}

function woodShovelFace(rand) {
  return toolCanvas(rand, (ctx) => {
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(8, 2, 7, 7);
    ctx.fillStyle = WOOD;
    ctx.fillRect(9, 3, 5, 5);
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(9, 3, 2, 1);
    ctx.clearRect(8, 8, 1, 1);
    ctx.clearRect(14, 8, 1, 1);
  });
}

/** Stone tool heads: the same haft, a grey head — Minecraft's stone tier. */
const STONE_DARK = '#5a5a5a';
const STONE_HEAD = '#8a8a8a';
const STONE_LIGHT = '#bdbdbd';

function stonePickaxeFace(rand) {
  return toolCanvas(rand, (ctx) => {
    ctx.strokeStyle = STONE_DARK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5.5, 5.5);
    ctx.quadraticCurveTo(10.5, 1.0, 14.5, 5.0);
    ctx.stroke();
    ctx.strokeStyle = STONE_HEAD;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(5.5, 5.5);
    ctx.quadraticCurveTo(10.5, 1.6, 14.5, 5.0);
    ctx.stroke();
    ctx.fillStyle = STONE_LIGHT;
    ctx.fillRect(9, 2, 3, 1);
  });
}

function stoneShovelFace(rand) {
  return toolCanvas(rand, (ctx) => {
    ctx.fillStyle = STONE_DARK;
    ctx.fillRect(8, 2, 7, 7);
    ctx.fillStyle = STONE_HEAD;
    ctx.fillRect(9, 3, 5, 5);
    ctx.fillStyle = STONE_LIGHT;
    ctx.fillRect(9, 3, 2, 1);
    ctx.clearRect(8, 8, 1, 1);
    ctx.clearRect(14, 8, 1, 1);
  });
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
  { id: 23, name: 'Coal Ore', side: coalFace, top: coalFace, bottom: coalFace },
  { id: 24, name: 'Iron Ore', side: ironFace, top: ironFace, bottom: ironFace },
  { id: 25, name: 'Gold Ore', side: goldFace, top: goldFace, bottom: goldFace },
  { id: 26, name: 'Redstone Ore', side: redstoneFace, top: redstoneFace, bottom: redstoneFace },
  { id: 27, name: 'Diamond Ore', side: diamondFace, top: diamondFace, bottom: diamondFace },
  { id: 28, name: 'Deepslate Coal Ore', side: deepCoalFace, top: deepCoalFace, bottom: deepCoalFace },
  { id: 29, name: 'Deepslate Iron Ore', side: deepIronFace, top: deepIronFace, bottom: deepIronFace },
  { id: 30, name: 'Deepslate Gold Ore', side: deepGoldFace, top: deepGoldFace, bottom: deepGoldFace },
  { id: 31, name: 'Deepslate Redstone Ore', side: deepRedstoneFace, top: deepRedstoneFace, bottom: deepRedstoneFace },
  { id: 32, name: 'Deepslate Diamond Ore', side: deepDiamondFace, top: deepDiamondFace, bottom: deepDiamondFace },
  // Crafting-era blocks: player-placed only, ids 33+ (see blocks-extra.js).
  // The furnace has no rotation state, so every side carries the fire mouth.
  { id: CRAFTING_TABLE, name: 'Crafting Table', side: craftingSideFace, top: craftingTopFace, bottom: planksFace },
  { id: FURNACE, name: 'Furnace', side: furnaceFrontFace, top: furnaceTopFace, bottom: furnaceTopFace },
  { id: GLASS, name: 'Glass', side: glassFace, top: glassFace, bottom: glassFace },
  { id: TNT, name: 'TNT', side: tntSideFace, top: tntTopFace, bottom: tntTopFace },
];

/**
 * Items. Same shape as a block def so one registry, one icon path and one
 * name lookup serve both; the three faces are simply the same sprite, because
 * a flat thing has no sides.
 */
export const ITEM_DEFS = [
  { id: BUCKET, name: 'Bucket', item: true, side: bucketFace, top: bucketFace, bottom: bucketFace },
  { id: WATER_BUCKET, name: 'Water Bucket', item: true, side: waterBucketFace, top: waterBucketFace, bottom: waterBucketFace },
  { id: PICKAXE, name: 'Iron Pickaxe', item: true, side: pickaxeFace, top: pickaxeFace, bottom: pickaxeFace },
  { id: SHOVEL, name: 'Iron Shovel', item: true, side: shovelFace, top: shovelFace, bottom: shovelFace },
  { id: STICKS, name: 'Sticks', item: true, side: sticksFace, top: sticksFace, bottom: sticksFace },
  { id: WOOD_PICKAXE, name: 'Wooden Pickaxe', item: true, side: woodPickaxeFace, top: woodPickaxeFace, bottom: woodPickaxeFace },
  { id: WOOD_SHOVEL, name: 'Wooden Shovel', item: true, side: woodShovelFace, top: woodShovelFace, bottom: woodShovelFace },
  { id: STONE_PICKAXE, name: 'Stone Pickaxe', item: true, side: stonePickaxeFace, top: stonePickaxeFace, bottom: stonePickaxeFace },
  { id: STONE_SHOVEL, name: 'Stone Shovel', item: true, side: stoneShovelFace, top: stoneShovelFace, bottom: stoneShovelFace },
];

/** Everything with a texture in the atlas: blocks first, then items. */
export const ATLAS_DEFS = [...BLOCK_DEFS, ...ITEM_DEFS];

/**
 * What you start with.
 *
 * Nine slots and more than nine things worth having, so the list is a series
 * of arguments about what earns one. The two tools take theirs by force:
 * without a pickaxe stone is seven and a half seconds a block and ore gives
 * you nothing at all, so a hotbar of pretty building blocks and no pickaxe is
 * a hotbar you cannot dig your way out of. Cobblestone and sand go — both are
 * a few seconds' digging away — and the oak log stays gone, because it is the
 * one you get back by walking up to a tree.
 */
export const STARTER_BLOCKS = [1, 2, 3, 5, 7, 9, PICKAXE, SHOVEL, BUCKET];

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

// ---------- breaking ----------

/**
 * The crack that grows over a block while you dig it.
 *
 * Ten stages, which is Minecraft's count, and every pixel of them written by
 * hand into image data rather than stroked.
 *
 * That is the whole of the rework. The first version drew each crack as a
 * canvas path, and a canvas path at fractional coordinates is anti-aliased —
 * so what landed on a 16x16 texture that is then magnified forty times by a
 * nearest-neighbour sampler was not a crack, it was a soft grey smudge with
 * blurred ends. Minecraft's destroy stages are pixel art: every cell is on or
 * off, the lines are one pixel wide and jagged because they step rather than
 * slope, and that hard edge is what reads as *broken* rather than as dirty.
 *
 * The crack is grown once, as an ordered list of cells spreading outward from
 * the middle, and stage n is the first tenth-of-the-way-through-n of it. That
 * gives Minecraft's other property for free: each stage strictly contains the
 * one before, so it reads as one thing getting worse rather than as ten
 * pictures taking turns.
 *
 * Each dark cell also lights the cell below-right of it, where nothing dark
 * is going to land. Minecraft's stages are greyscale and lean on block light
 * to be visible; this game has no torches, and a crack that is only dark is
 * invisible on the deepslate you would be mining it in.
 */
const CRACK_STAGES = 10;

/**
 * The whole crack, cell by cell, in the order it spreads.
 *
 * Branches are grown breadth-first from a queue so they advance together and
 * the crack opens outward, instead of one arm reaching the edge before the
 * next one starts.
 */
function crackCells() {
  const rand = mulberry32(4523);
  const cells = [];
  const seen = new Set();
  const mid = TEX_SIZE / 2;
  const key = (x, y) => y * TEX_SIZE + x;

  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= TEX_SIZE || y >= TEX_SIZE) return false;
    const k = key(x, y);
    if (!seen.has(k)) {
      seen.add(k);
      cells.push([x, y]);
    }
    return true;
  };

  // Four arms out of the middle, plus a couple of shorter ones, all stepping
  // one cell at a time and wandering a cell either side as they go.
  const queue = [];
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rand() * 0.6;
    // Not all from the same cell: eight arms out of one point is a starburst,
    // and a broken block is not a starburst. They start a little way out,
    // scattered, so what spreads is a web.
    const r = 0.5 + rand() * 2.5;
    queue.push({ x: mid + Math.cos(a) * r, y: mid + Math.sin(a) * r, a, life: 14 });
  }

  while (queue.length) {
    const b = queue.shift();
    if (b.life <= 0) continue;
    // A step is a whole cell in the dominant direction and, now and then, one
    // in the other — which is what makes the line jagged rather than smooth.
    b.a += (rand() - 0.5) * 1.1;
    // ...and then pulled a third of the way back to straight-out-from-the-
    // middle, or a wandering arm curls round on itself and the corners of the
    // tile never crack at all.
    const ox = b.x - mid;
    const oy = b.y - mid;
    if (ox || oy) {
      const outward = Math.atan2(oy, ox);
      b.a += (((outward - b.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.34;
    }
    const dx = Math.cos(b.a);
    const dy = Math.sin(b.a);
    const step = Math.abs(dx) > Math.abs(dy)
      ? [Math.sign(dx), rand() < 0.42 ? Math.sign(dy) : 0]
      : [rand() < 0.42 ? Math.sign(dx) : 0, Math.sign(dy)];
    b.x += step[0];
    b.y += step[1];
    if (!put(Math.round(b.x), Math.round(b.y))) continue;
    b.life--;
    // A fork every so often, which is what turns four lines into a web.
    if (b.life > 3 && rand() < 0.3) {
      queue.push({ x: b.x, y: b.y, a: b.a + (rand() < 0.5 ? 1.3 : -1.3), life: b.life - 3 });
    }
    queue.push(b);
  }
  return { cells, seen, key };
}

let crackAll = null;

function crackCanvas(stage) {
  if (!crackAll) crackAll = crackCells();
  const { cells, seen, key } = crackAll;
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const shown = Math.round(cells.length * (stage + 1) / CRACK_STAGES);

  const set = (x, y, v, a) => {
    if (x < 0 || y < 0 || x >= TEX_SIZE || y >= TEX_SIZE) return;
    const o = (y * TEX_SIZE + x) * 4;
    if (img.data[o + 3] >= a) return; // never lighten a cell already darkened
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    img.data[o + 3] = a;
  };

  // The lit side first, so a dark cell always wins the cell it shares. Not
  // every cell gets one: a highlight beside every single dark pixel draws a
  // second line parallel to the first, and what you want is a chip of light
  // here and there along the crack.
  for (let i = 0; i < shown; i++) {
    const [x, y] = cells[i];
    if ((i * 2654435761) % 5 < 2 && !seen.has(key(x + 1, y + 1))) set(x + 1, y + 1, 232, 128);
  }
  for (let i = 0; i < shown; i++) set(cells[i][0], cells[i][1], 0, 205);
  ctx.putImageData(img, 0, 0);
  return cv;
}

let crackUrls = null;

/** The crack stages as data URLs, cheapest to newest — built once. */
export function getCrackStages() {
  if (!crackUrls) {
    crackUrls = [];
    for (let i = 0; i < CRACK_STAGES; i++) crackUrls.push(crackCanvas(i).toDataURL());
  }
  return crackUrls;
}

/** Which stage a fraction of the way through breaking looks like. */
export function crackStage(progress) {
  return Math.min(CRACK_STAGES - 1, Math.max(0, Math.floor(progress * CRACK_STAGES)));
}

// ---------- HUD sprites ----------
//
// Hearts and bubbles, drawn the same way as everything else here: on a tiny
// canvas, pixel by pixel, out of nothing. They are 9x9 because Minecraft's
// are, and because at that size the shape has to be *stated* rather than
// drawn — a heart is two arcs and a point, and at nine pixels each of those
// is two or three cells you either fill or do not.

/** 1 = filled, 2 = the darker outline. Nine rows of nine. */
const HEART_PIXELS = [
  '022002200',
  '211211120',
  '211111112',
  '211111112',
  '211111112',
  '021111120',
  '002111200',
  '000212000',
  '000020000',
];

/** A bubble: a ring with a highlight where the light gets in. */
const BUBBLE_PIXELS = [
  '000222000',
  '002133200',
  '021333320',
  '213333312',
  '213333312',
  '213333312',
  '021333320',
  '002333200',
  '000222000',
];

/** Paint a 9x9 sprite map with a palette and hand back a data URL. */
function spriteUrl(rows, palette, scale = 4) {
  const size = rows.length;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size * scale;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const key = rows[y][x];
      const colour = palette[key];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return cv.toDataURL();
}

const hudCache = new Map();
const hudSprite = (name, rows, palette) => {
  if (!hudCache.has(name)) hudCache.set(name, spriteUrl(rows, palette));
  return hudCache.get(name);
};

/** A full heart, and the empty socket that shows where one used to be. */
export const heartUrl = () =>
  hudSprite('heart', HEART_PIXELS, { 1: '#e6202a', 2: '#4a0a10' });
export const heartEmptyUrl = () =>
  hudSprite('heart-empty', HEART_PIXELS, { 1: '#3b3b3b', 2: '#141414' });
/** Half a heart is the same sprite with its right half cut away — see hud.js. */
export const bubbleUrl = () =>
  hudSprite('bubble', BUBBLE_PIXELS, { 1: '#ffffff', 2: '#0b1c3a', 3: '#8fd2ff' });

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

/**
 * A representative [r, g, b] tint (0..1) for a block id, for the block break
 * particles. Not a pixel-perfect sample — a single colour the chips can fly
 * out as, close enough to the block's look to read as bits of it.
 */
const TINT_BY_ID = {
  1: [0.48, 0.74, 0.29],   // grass top green
  2: [0.47, 0.33, 0.23],   // dirt
  3: [0.50, 0.50, 0.50],   // stone
  4: [0.54, 0.54, 0.54],   // cobblestone
  5: [0.72, 0.58, 0.37],   // oak planks
  6: [0.86, 0.83, 0.63],   // sand
  7: [0.61, 0.31, 0.18],   // bricks
  8: [0.29, 0.29, 0.29],   // bedrock
  9: [0.96, 0.96, 0.96],   // snow
  10: [0.42, 0.31, 0.16],  // oak log
  11: [0.25, 0.50, 0.16],  // leaves
  12: [0.24, 0.25, 0.27],  // deepslate
  22: [0.46, 0.65, 0.85],  // ice
  23: [0.42, 0.42, 0.45],  // coal ore
  24: [0.58, 0.55, 0.50],  // iron ore
  25: [0.62, 0.55, 0.35],  // gold ore
  26: [0.55, 0.42, 0.42],  // redstone ore
  27: [0.48, 0.62, 0.60],  // diamond ore
  28: [0.30, 0.30, 0.32],  // deepslate coal ore
  29: [0.42, 0.40, 0.38],  // deepslate iron ore
  30: [0.46, 0.41, 0.30],  // deepslate gold ore
  31: [0.40, 0.32, 0.32],  // deepslate redstone ore
  32: [0.35, 0.47, 0.46],  // deepslate diamond ore
  33: [0.72, 0.58, 0.37],  // crafting table
  34: [0.50, 0.48, 0.46],  // furnace
  35: [0.82, 0.92, 1.00],  // glass
  36: [0.75, 0.18, 0.14],  // tnt
};

export function blockTint(id) {
  return TINT_BY_ID[id] ?? [0.5, 0.5, 0.5];
}
