// Render the dimensional tool models to PNGs with the same software
// rasteriser the mob preview uses, so a tool's silhouette and its depth
// profile can be checked without WebGL. Each tool is built through the real
// pipeline — modelSpec -> buildToolModel — then drawn at two angles.
//
// Usage: node scripts/tool-preview.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { modelSpec, MODELLED_ITEMS, POSE_KIND_TOOL, poseKind } from '../src/item-models.js';
import { buildToolModel, buildBucketModel } from '../src/held-geometry.js';
import { ITEM_NAMES } from '../src/items.js';

// ---- png encoder ----
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
function png(path, w, h, rgba) {
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

function render(mesh, { yaw = -0.5, pitch = 0.35, zoom = 170 } = {}) {
  const W = 240;
  const H = 240;
  const rgba = Buffer.alloc(W * H * 4, 40);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = 255;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const toView = (x, y, z) => {
    const x1 = cy * x - sy * z;
    const z1 = sy * x + cy * z;
    const y1 = cp * y - sp * z1;
    const z2 = sp * y + cp * z1;
    return [x1, y1, z2];
  };

  const tris = [];
  const { positions, normals, colors } = mesh;
  for (let t = 0; t < positions.length; t += 9) {
    const pts = [];
    let nx = 0, ny = 0, nz = 0;
    let cr = 0, cg = 0, cb = 0;
    for (let v = 0; v < 3; v++) {
      const o = t + v * 3;
      pts.push(toView(positions[o], positions[o + 1], positions[o + 2]));
      nx += normals[o];
      ny += normals[o + 1];
      nz += normals[o + 2];
      cr += colors[o];
      cg += colors[o + 1];
      cb += colors[o + 2];
    }
    nx /= 3; ny /= 3; nz /= 3;
    cr /= 3; cg /= 3; cb /= 3;
    // light from upper-left-front, in view space
    const light = Math.max(0.3, 0.55 + 0.45 * (nx * 0.55 + ny * 0.7 + nz * 0.3));
    const depth = (pts[0][2] + pts[1][2] + pts[2][2]) / 3;
    tris.push({ pts, depth, cr: cr * light * 255, cg: cg * light * 255, cb: cb * light * 255 });
  }
  tris.sort((a, b) => a.depth - b.depth);
  const zBuf = new Float32Array(W * H).fill(-Infinity);
  for (const f of tris) {
    const [a, b, c] = f.pts.map(([x, y, z]) => [W / 2 + x * zoom, H / 2 - y * zoom, z]);
    const [ax, ay, az] = a, [bx, by, bz] = b, [cx, cyy, cz] = c;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cyy)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cyy)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = (bx - ax) * (cyy - ay) - (by - ay) * (cx - ax);
        if (d === 0) continue;
        const u = ((x - ax) * (cyy - ay) - (y - ay) * (cx - ax)) / d;
        const v = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / d;
        const ww = 1 - u - v;
        if (u < 0 || v < 0 || ww < 0) continue;
        const z = az * u + bz * v + cz * ww;
        const idx = y * W + x;
        if (z <= zBuf[idx]) continue;
        zBuf[idx] = z;
        const o = idx * 4;
        rgba[o] = f.cr;
        rgba[o + 1] = f.cg;
        rgba[o + 2] = f.cb;
      }
    }
  }
  return { w: W, h: H, rgba };
}

mkdirSync('preview', { recursive: true });
for (const id of MODELLED_ITEMS) {
  const spec = modelSpec(id);
  if (!spec) continue;
  const mesh = spec.kind === 'bucket' ? buildBucketModel(spec.full) : buildToolModel(spec);
  const name = (ITEM_NAMES[id] ?? `item-${id}`).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const a = render(mesh, { yaw: -0.5, pitch: 0.35 });
  png(`preview/tool-${name}-a.png`, a.w, a.h, a.rgba);
  const b = render(mesh, { yaw: -0.5 + Math.PI / 2, pitch: 0.35 });
  png(`preview/tool-${name}-b.png`, b.w, b.h, b.rgba);
  console.log(name, mesh.triangles + ' tris');
}
