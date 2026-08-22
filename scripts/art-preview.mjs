// Render the hand-authored pixel maps to PNGs so the art can be eyeballed
// without a browser. Paints every block face (and, later, item sprites) on
// a real canvas is not possible in Node, so this rasterises the resolved
// maps directly into RGBA buffers and writes them with zlib (no deps).
//
// Usage: node scripts/art-preview.mjs blocks
//        node scripts/art-preview.mjs sprites
// Writes preview/art-<name>.png.

import { mkdirSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import * as blocks from '../src/block-pixels.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A resolved map -> PNG file. 0 colours read as transparent. */
function writePng(path, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function png(path, cells, n, scale = 12) {
  const w = n * scale;
  const rgba = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const c = cells[Math.floor(y / scale) * n + Math.floor(x / scale)];
      const o = (y * w + x) * 4;
      rgba[o] = (c >> 16) & 255;
      rgba[o + 1] = (c >> 8) & 255;
      rgba[o + 2] = c & 255;
      rgba[o + 3] = c ? 255 : 0;
    }
  }
  writePng(path, w, w, rgba);
}

const resolve = (rows, palette) => {
  const n = rows.length;
  const out = new Uint32Array(n * n);
  const parse = (h) => parseInt(h.slice(1), 16);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const hex = palette[ch];
      if (!hex) continue;
      out[y * n + x] = parse(hex);
    }
  }
  return out;
};

mkdirSync('preview', { recursive: true });

const which = process.argv[2] ?? 'blocks';
if (which === 'sprites') {
  const { outline } = await import('../src/pixelart.js');
  const sprites = await import('../src/item-sprites.js');
  // Tools paint with haft + tier palettes; pick iron as the representative.
  const toolPal = { ...sprites.HAFT, ...sprites.HEAD_IRON };
  for (const [name, rows] of Object.entries(sprites.ALL_SPRITES)) {
    const pals = Object.values(sprites).filter(
      (p) => typeof p === 'object' && !Array.isArray(p) && p !== null);
    const palette = pals.find((p) =>
      rows.every((r) => [...r].every((ch) => ch === '.' || p[ch])))
      ?? toolPal;
    // paint fill + outline into one buffer
    const n = rows.length;
    const cells = resolve(rows, palette);
    const rim = resolve(outline(rows), { x: '#241c14' });
    const merged = new Uint32Array(n * n);
    for (let i = 0; i < n * n; i++) merged[i] = rim[i] || cells[i];
    png(`preview/sprite-${name.toLowerCase()}.png`, merged, n);
    console.log(name, n + 'px');
  }
} else if (which === 'sheet') {
  // Contact sheets: every tile composed side by side, for eyeballing the
  // whole catalogue at once. Blocks first, then the item sprites with their
  // outline rims.
  const { outline } = await import('../src/pixelart.js');
  const sprites = await import('../src/item-sprites.js');
  const toolPal = { ...sprites.HAFT, ...sprites.HEAD_IRON };
  const tile = (cells, n, scale = 8) => {
    const out = Buffer.alloc(n * scale * n * scale * 4);
    out.fill(255, 3);
    for (let y = 0; y < n * scale; y++) {
      for (let x = 0; x < n * scale; x++) {
        const c = cells[Math.floor(y / scale) * n + Math.floor(x / scale)];
        const o = (y * n * scale + x) * 4;
        if (!c) continue;
        out[o] = (c >> 16) & 255;
        out[o + 1] = (c >> 8) & 255;
        out[o + 2] = c & 255;
      }
    }
    return { w: n * scale, h: n * scale, data: out };
  };
  const compose = (entries, cols, outPath) => {
    const S = 128; // each tile shown at 128px
    const rowsN = Math.ceil(entries.length / cols);
    const W = cols * (S + 6) + 6;
    const H = rowsN * (S + 6) + 6;
    const sheet = Buffer.alloc(W * H * 4, 40);
    sheet.fill(255, 3);
    entries.forEach((entry, i) => {
      const t = tile(entry.cells, entry.n, S / entry.n);
      const ox = 6 + (i % cols) * (S + 6);
      const oy = 6 + Math.floor(i / cols) * (S + 6);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const so = (y * S + x) * 4;
          const dof = ((oy + y) * W + ox + x) * 4;
          if (t.data[so + 3] === 0) continue;
          sheet[dof] = t.data[so];
          sheet[dof + 1] = t.data[so + 1];
          sheet[dof + 2] = t.data[so + 2];
        }
      }
    });
    writePng(outPath, W, H, sheet);
  };
  const blockEntries = [];
  for (const [key, value] of Object.entries(blocks)) {
    if (!key.endsWith('_PX') || !Array.isArray(value)) continue;
    const base = key.slice(0, -3);
    let palette = blocks[`${base}_PALETTE`];
    if (!palette) continue;
    blockEntries.push({ cells: resolve(value, palette), n: value.length });
  }
  compose(blockEntries, 6, 'preview/blocks-sheet.png');
  console.log('blocks sheet:', blockEntries.length, 'tiles');
  const spriteEntries = [];
  for (const [name, rows] of Object.entries(sprites.ALL_SPRITES)) {
    const pals = Object.values(sprites).filter(
      (p) => typeof p === 'object' && !Array.isArray(p) && p !== null);
    const palette = pals.find((p) =>
      rows.every((r) => [...r].every((ch) => ch === '.' || p[ch])))
      ?? toolPal;
    const cells = resolve(rows, palette);
    const rim = resolve(outline(rows), { x: '#241c14' });
    const merged = new Uint32Array(cells.length);
    for (let i = 0; i < cells.length; i++) merged[i] = rim[i] || cells[i];
    spriteEntries.push({ cells: merged, n: rows.length });
  }
  compose(spriteEntries, 8, 'preview/sprites-sheet.png');
  console.log('sprites sheet:', spriteEntries.length, 'tiles');
} else if (which === 'blocks') {
  for (const [key, value] of Object.entries(blocks)) {
    if (!key.endsWith('_PX') || !Array.isArray(value)) continue;
    const name = key.slice(0, -3).toLowerCase();
    let palette = blocks[`${key.slice(0, -3)}_PALETTE`];
    if (!palette && name.startsWith('lump_')) {
      palette = blocks.ORE_PALETTES.coal;
      if (name === 'lump_redstone') palette = blocks.ORE_PALETTES.redstone;
      if (name === 'lump_diamond') palette = blocks.ORE_PALETTES.diamond;
    }
    if (!palette) continue;
    const cells = resolve(value, palette);
    png(`preview/art-${name}.png`, cells, value.length);
    console.log(name, value.length + 'px');
  }
}
