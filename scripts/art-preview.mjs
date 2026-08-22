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
function png(path, cells, n, scale = 12) {
  const w = n * scale;
  const raw = Buffer.alloc((w * 4 + 1) * w);
  for (let y = 0; y < w; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const c = cells[Math.floor(y / scale) * n + Math.floor(x / scale)];
      const o = row + 1 + x * 4;
      raw[o] = (c >> 16) & 255;
      raw[o + 1] = (c >> 8) & 255;
      raw[o + 2] = c & 255;
      raw[o + 3] = c ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const pngBuf = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, pngBuf);
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
