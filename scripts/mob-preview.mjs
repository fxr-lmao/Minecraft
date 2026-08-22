// Render each mob's boxes to a PNG with a tiny software rasteriser, so the
// models can be checked without a WebGL context. The mobs are built from
// spec boxes (mob-models.js); this walks the built THREE group, projects
// every box face with a painter's sort, and lights each face by its normal.
// Each face is tinted with the colour its real texture paints at the face's
// centre — the canvas stub records actual pixels, so the flat renders carry
// the mobs' real palettes, just without the per-pixel detail.
//
// Usage: node scripts/mob-preview.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

// ---- canvas stub that actually paints (so textures have real pixels) ----
class Ctx {
  constructor(canvas) {
    this.canvas = canvas;
    this.px = new Uint32Array(canvas.width * canvas.height);
    this.fillStyle = '#000';
    this.imageSmoothingEnabled = true;
  }
  fillRect(x, y, w, h) {
    const c = parseInt(this.fillStyle.slice(1), 16);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        this.px[yy * this.canvas.width + xx] = c;
      }
    }
  }
}
class Canvas {
  constructor() {
    this.width = 8;
    this.height = 8;
    this._ctx = new Ctx(this);
  }
  getContext() { return this._ctx; }
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? new Canvas() : {}),
  createElementNS: (ns, tag) => (tag === 'canvas' ? new Canvas() : {}),
};

const { createMobModel } = await import('../src/mob-models.js');
const { createPlayerModel } = await import('../src/player-model.js');
const { ZOMBIE, CREEPER, SKELETON, SPIDER, PIG, COW, CHICKEN, SHEEP } = await import('../src/mobs.js');

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

/** The colour a material paints at its texture's centre. */
function materialColor(mat) {
  const tex = mat?.map;
  const img = tex?.image;
  if (!img || !img._ctx) return 0x7c9c6c;
  const ctx = img._ctx;
  const x = Math.floor(ctx.canvas.width / 2);
  const y = Math.floor(ctx.canvas.height / 2);
  const c = ctx.px[y * ctx.canvas.width + x];
  return c || 0x7c9c6c;
}

// ---- the rasteriser ----
function render(model, { yaw = 0.7, pitch = 0.25, zoom = 100 } = {}) {
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

  model.group.updateMatrixWorld(true);
  const faces = [];
  const addQuad = (a, b, c, d, normal, color) => {
    const va = toView(...a);
    const vb = toView(...b);
    const vc = toView(...c);
    const vd = toView(...d);
    const nx = cy * normal[0] - sy * normal[2];
    const nz = sy * normal[0] + cy * normal[2];
    const ny = cp * normal[1] - sp * nz;
    const nz2 = sp * normal[1] + cp * nz;
    const light = Math.max(0.3, 0.5 + 0.5 * (nx * 0.6 + ny * 0.75 + nz2 * 0.25));
    const depth = (va[2] + vb[2] + vc[2] + vd[2]) / 4;
    faces.push({ pts: [va, vb, vc, vd], depth, color, light });
  };

  model.group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.parameters;
    const w = o.matrixWorld.elements;
    const cx = w[12], cyw = w[13], cz = w[14];
    const hw = g.width / 2, hh = g.height / 2, hd = g.depth / 2;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const faceColor = (i) => materialColor(mats.length > 1 ? mats[i] : mats[0]);
    // corners: 0=-x-y-z 1=+x-y-z 2=-x+y-z 3=+x+y-z 4=-x-y+z 5=+x-y+z 6=-x+y+z 7=+x+y+z
    const c = [];
    for (const sx of [-1, 1]) for (const syy of [-1, 1]) for (const sz of [-1, 1]) {
      c.push([cx + sx * hw, cyw + syy * hh, cz + sz * hd]);
    }
    const [p0, p1, p2, p3, p4, p5, p6, p7] = c;
    addQuad(p4, p5, p7, p6, [0, 0, 1], faceColor(5)); // +z (back)
    addQuad(p1, p0, p2, p3, [0, 0, -1], faceColor(4)); // -z (front)
    addQuad(p2, p3, p7, p6, [0, 1, 0], faceColor(2)); // +y
    addQuad(p0, p1, p5, p4, [0, -1, 0], faceColor(3)); // -y
    addQuad(p0, p4, p6, p2, [-1, 0, 0], faceColor(0)); // -x
    addQuad(p1, p5, p7, p3, [1, 0, 0], faceColor(1)); // +x
  });

  faces.sort((a, b) => a.depth - b.depth);
  const zBuf = new Float32Array(W * H).fill(-Infinity);
  for (const f of faces) {
    const r = ((f.color >> 16) & 255) * f.light;
    const g = ((f.color >> 8) & 255) * f.light;
    const b = (f.color & 255) * f.light;
    const pts = f.pts.map(([x, y, z]) => [W / 2 + x * zoom, H / 2 - y * zoom, z]);
    const tri = (a, b, c) => {
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
          rgba[o] = r;
          rgba[o + 1] = g;
          rgba[o + 2] = b;
        }
      }
    };
    tri(pts[0], pts[1], pts[2]);
    tri(pts[0], pts[2], pts[3]);
  }

  return { w: W, h: H, rgba };
}

mkdirSync('preview', { recursive: true });

// The player avatar too — same harness, same angles.
{
  const model = createPlayerModel();
  const front = render(model, { yaw: 0.6, pitch: 0.12, zoom: 105 });
  png('preview/mob-player-front.png', front.w, front.h, front.rgba);
  const side = render(model, { yaw: 0.6 + Math.PI / 2, pitch: 0.12, zoom: 105 });
  png('preview/mob-player-side.png', side.w, side.h, side.rgba);
  console.log('player');
}

const KINDS = [ZOMBIE, CREEPER, SKELETON, SPIDER, PIG, COW, CHICKEN, SHEEP];
const NAMES = { [ZOMBIE]: 'zombie', [CREEPER]: 'creeper', [SKELETON]: 'skeleton', [SPIDER]: 'spider', [PIG]: 'pig', [COW]: 'cow', [CHICKEN]: 'chicken', [SHEEP]: 'sheep' };
for (const kind of KINDS) {
  const model = createMobModel(kind);
  const front = render(model, { yaw: 0.6, pitch: 0.12, zoom: 105 });
  png(`preview/mob-${NAMES[kind]}-front.png`, front.w, front.h, front.rgba);
  const side = render(model, { yaw: 0.6 + Math.PI / 2, pitch: 0.12, zoom: 105 });
  png(`preview/mob-${NAMES[kind]}-side.png`, side.w, side.h, side.rgba);
  console.log(NAMES[kind]);
}
