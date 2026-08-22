// A shared painter for everything drawn as pixel art in this game.
//
// The old art pipeline painted procedurally: a block face was a noise field,
// an item was a handful of generated blobs, and a mob skin was a flat colour
// with a wobble. That is fast to write and it looks like it: noise has no
// intent, so nothing it draws looks like the thing it is pretending to be.
// Minecraft's own art is the opposite — every texel is a deliberate choice,
// and the whole craft of it is in those choices.
//
// This file is the machinery those choices are written in, and it exists so
// that the choices live in exactly one place and nothing else: a pixel map is
// sixteen (or eight, for mob faces) strings of letters and a palette that
// turns the letters into colours. A map says what the art *is*; this file
// says how to put it on a canvas, and it deliberately knows nothing about
// any particular block, item or mob.
//
//   paintMap(ctx, rows, palette, opts)       — draw a map into a context
//   paintedCanvas(size, rows, palette, opts) — build a canvas holding a map
//   resolveMap(rows, palette)                — a map flattened to colours
//   paintCells(ctx, cells, ...)              — draw an already-resolved map
//   stamp(target, ..., stampCells, ..., ox, oy) — composite one over another
//   outline(rows) / paintWithOutline(...)    — the one-texel icon rim
//   shade / hexOf / parseHexColor / mix      — colour helpers
//   wobbleRng                                — a seeded per-pixel wobble
//
// Nothing here touches THREE or the DOM's window; it is pure 2D canvas code
// so Node's canvas stub in the test suite can run it.

import { mulberry32, clamp } from './utils.js';

/** Parse '#rrggbb' to an integer 0xRRGGBB. Throws on anything else. */
export function parseHexColor(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`not a colour: ${hex}`);
  }
  return parseInt(hex.slice(1), 16);
}

/** An integer colour to '#rrggbb'. */
export const hexOf = (c) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Scale each channel of a 0xRRGGBB colour by `f`, clamped to byte range.
 * Accepts a colour string too and returns the same type it was given.
 */
export function shade(color, f) {
  const wasHex = typeof color === 'string';
  const c = wasHex ? parseHexColor(color) : color;
  const r = clamp(Math.round(((c >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((c >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((c & 255) * f), 0, 255);
  const out = (r << 16) | (g << 8) | b;
  return wasHex ? hexOf(out) : out;
}

/** Mix two 0xRRGGBB colours, `t` of `b` over `a` (t in 0..1). */
export function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * A per-pixel wobble: `mulberry32(seed)` stepped once per pixel, scaled to
 * [1 - amount, 1 + amount]. The wobble is what stops a flat area of one
 * colour reading as plastic — Minecraft's textures all carry it too, at
 * about this amplitude.
 */
export function wobbleRng(seed, amount = 0.055) {
  const rand = mulberry32(seed);
  return () => 1 + (rand() - 0.5) * 2 * amount;
}

/** Validate a pixel map: N strings of N characters. Returns N. */
export function mapSize(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('pixel map must be a non-empty array of strings');
  }
  const n = rows.length;
  for (const row of rows) {
    if (typeof row !== 'string' || row.length !== n) {
      throw new Error(`pixel map rows must be ${n} characters`);
    }
  }
  return n;
}

/** A map flattened to integer colours: 0 = transparent, else 0xRRGGBB. */
export function resolveMap(rows, palette) {
  const n = mapSize(rows);
  const out = new Uint32Array(n * n);
  const cache = new Map();
  for (let y = 0; y < n; y++) {
    const row = rows[y];
    for (let x = 0; x < n; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const hex = palette[ch];
      if (!hex) continue; // an unpainted letter is a hole, like Minecraft
      let c = cache.get(hex);
      if (c === undefined) {
        c = parseHexColor(hex);
        cache.set(hex, c);
      }
      out[y * n + x] = c;
    }
  }
  return out;
}

/**
 * Paint a map onto a 2D context at (ox, oy), each cell `scale` canvas pixels
 * on a side, with an optional per-pixel seeded wobble so flat colour keeps a
 * little life. `tint` (0..1, default 1) scales brightness across the board.
 */
export function paintMap(ctx, rows, palette, {
  ox = 0, oy = 0, scale = 1, seed = 0, wobble = 0.055, tint = 1,
} = {}) {
  const n = mapSize(rows);
  const cells = resolveMap(rows, palette);
  const w = wobble ? wobbleRng(seed, wobble) : () => 1;
  const s = scale;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = cells[y * n + x];
      if (!c) continue;
      ctx.fillStyle = hexOf(shade(c, w() * tint));
      ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }
  return cells;
}

/** Build a canvas holding one map, painted with a wobble. */
export function paintedCanvas(size, rows, palette, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  paintMap(ctx, rows, palette, {
    scale: size / rows.length, seed: opts.seed ?? 1, wobble: opts.wobble, tint: opts.tint,
  });
  return cv;
}

/**
 * Composite one resolved map over another at (ox, oy) in cell coordinates.
 * `transparent` cells of the stamp leave the target alone; everything else
 * overwrites. Returns a new Uint32Array the size of the target.
 */
export function stamp(target, tw, th, stampCells, sw, sh, ox, oy) {
  const out = new Uint32Array(target);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const c = stampCells[y * sw + x];
      if (!c) continue;
      const tx = ox + x;
      const ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= tw || ty >= th) continue;
      out[ty * tw + tx] = c;
    }
  }
  return out;
}

/**
 * Paint a resolved Uint32Array (0 transparent, else 0xRRGGBB) directly into
 * a 2D context as scale-sized squares — the path used when a map has been
 * composited with `stamp` before it is drawn.
 */
export function paintCells(ctx, cells, n, ox, oy, scale, seed = 0, wobble = 0.055) {
  const w = wobble ? wobbleRng(seed, wobble) : () => 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = cells[y * n + x];
      if (!c) continue;
      ctx.fillStyle = hexOf(shade(c, w()));
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

/**
 * Derive the one-pixel dark outline around every opaque cell of a map.
 *
 * Minecraft item icons all carry this rim — it is what separates the sprite
 * from the world behind it at any scale, and it is drawn as *part of the
 * map* rather than by a stroke, because a canvas stroke anti-aliases at
 * fractional coordinates and a 16×16 tile magnified by a nearest-neighbour
 * sampler turns that into a grey smear. One cell thick, corners included,
 * so it reads as a border and not as a shadow.
 *
 * @returns a new map where every cell adjacent (8-way) to an opaque cell
 *          that is itself transparent carries the outline letter `x`.
 */
export function outline(rows, outlineChar = 'x') {
  const n = mapSize(rows);
  const out = rows.map((r) => r.split(''));
  const solid = (x, y) =>
    x >= 0 && y >= 0 && x < n && y < n && rows[y][x] !== '.' && rows[y][x] !== ' ';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (solid(x, y) || out[y][x] !== '.' && out[y][x] !== ' ') continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (solid(x + dx, y + dy)) out[y][x] = outlineChar;
        }
      }
    }
  }
  return out.map((r) => r.join(''));
}

/**
 * Paint a map with its outline on a canvas: the outline map is drawn first
 * (in `outlineColor`) and the map itself on top, so the rim survives under
 * the wobble. This is the one-step path for icons.
 */
export function paintWithOutline(ctx, rows, palette, {
  ox = 0, oy = 0, scale = 1, seed = 0, wobble = 0.055, outlineColor = '#1a1410',
} = {}) {
  const rim = outline(rows);
  paintMap(ctx, rim, { x: outlineColor }, { ox, oy, scale, seed, wobble: wobble * 0.4 });
  paintMap(ctx, rows, palette, { ox, oy, scale, seed, wobble });
}

/** A vertical gradient canvas: `stops` is [[t, hex], ...] with t in 0..1. */
export function gradientCanvas(size, stops) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    // Outside the stops, hold the nearest end rather than snapping back to
    // the first one — a stop list that does not reach 1 would otherwise
    // paint its bottom row with its top colour.
    let c = t <= stops[0][0] ? stops[0][1] : stops[stops.length - 1][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (t >= t0 && t <= t1) {
        c = hexOf(mix(parseHexColor(c0), parseHexColor(c1), (t - t0) / (t1 - t0 || 1)));
        break;
      }
    }
    ctx.fillStyle = c;
    ctx.fillRect(0, y, size, 1);
  }
  return cv;
}
