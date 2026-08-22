// Three-dimensional items: turning a 16x16 pixel map into a solid.
//
// Until now everything you could hold that was not a block was a *sprite* —
// two quads back to back with a picture on them, a hundredth of a block
// thick. In first person, held at an angle in the corner of the screen, that
// very nearly works. Everywhere else it does not, and the two places it
// fails are the two places you spend most of your time looking at your own
// hands:
//
//   * In third person the avatar holds the thing side-on. A flat sprite seen
//     edge-on is one pixel wide — the pickaxe *disappeared* as you turned,
//     and came back as a paper cut-out as you turned further. There is no
//     angle at which a plane looks like a tool.
//   * A sprite has one normal, so a lit material shades the whole of it by
//     whatever that single direction catches. That is why the held item had
//     to be drawn unlit: not because an icon should be unlit, but because
//     lighting a plane looks worse than not lighting it.
//
// Minecraft solves both the same way and has since 1.8: an item is not a
// picture, it is a *slab*. Every opaque pixel of the icon becomes a cuboid
// one sixteenth of a block deep, the interior faces cancel, and what is left
// is a chunky little model with a front, a back and a jagged silhouette of
// sides — which is exactly why a Minecraft sword has a visible thickness and
// catches the light along its edge.
//
// This file is the mesher for that, and it is deliberately the same shape as
// the chunk mesher: pure arrays in, pure arrays out. No THREE, no DOM, no
// canvas. The pixel maps it reads are the same ones the atlas paints from, so
// the model and the icon can never drift apart, and every rule in here is
// unit-tested in Node.
//
// The builders that come out of it:
//
//   buildExtrudedSprite  — the general case: any 16x16 map becomes a solid.
//   buildBoxModel        — a list of cuboids, for things that are genuinely
//                          three-dimensional objects rather than pictures
//                          of one. The bucket is the reason this exists: it
//                          is a container, it is open at the top, and you
//                          should be able to see the water sitting in it.
//   buildSolidModel      — cuboids *and* hexahedra, for the tools: a blade
//                          that tapers to a point, an axe head that ends in
//                          an edge, a pickaxe arch, a shovel flare.

/**
 * How deep an extruded item is, as a fraction of its 1x1 sprite. Minecraft's
 * item models are 16x16x1 in texel units, so one sixteenth.
 */
export const SPRITE_DEPTH = 1 / 16;

/** The sprite grid. Everything in here assumes 16, but not silently. */
export const SPRITE_SIZE = 16;

/**
 * Per-face shading, baked into the vertex colours.
 *
 * The held model is lit by the same directional sun as the world, and a sun
 * that happens to be behind you leaves a tool as a flat silhouette — the same
 * problem the avatar has, and it is solved the same way there (an emissive
 * floor under everything). Baking Minecraft's own face shading in as well
 * means the *shape* survives even when the lighting says nothing: the top of
 * a blade is brighter than its underside no matter where the sun is, which is
 * most of what makes a lump of pixels read as a solid object.
 *
 * The numbers are Minecraft's ambient occlusion ratios for the six
 * directions, with the back left brighter than a real -Z face would be
 * because half the time it is the side you are looking at.
 */
export const FACE_SHADE = {
  front: 1.0,
  back: 0.92,
  left: 0.74,
  right: 0.82,
  top: 1.0,
  bottom: 0.58,
};

/** Parse '#rrggbb' into [r, g, b] in 0..1, sRGB. Throws on anything else. */
export function parseHex(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`not a colour: ${hex}`);
  }
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * A sprite map plus its palette, flattened into a grid of colours.
 *
 * Returns { size, cells } where `cells` is size*size entries of either null
 * (transparent) or [r, g, b]. Row 0 is the top of the sprite, which is how
 * the maps are written and how a canvas reads them; the extruder turns that
 * into +y at the top, which is how the world works.
 *
 * `mirrorX` flips the map left-to-right. It exists for one specific reason:
 * every tool sprite in this game is drawn with its haft running down to the
 * *left*, because that is the convention every Minecraft item icon follows
 * and the icons have to match it. But the hand that holds the thing is on the
 * right of the screen in first person and on the avatar's right shoulder in
 * third, so a tool posed from the unmirrored map points its handle away into
 * space and holds the head where the fist should be. Mirroring the pixels is
 * a great deal more honest than rotating the model 180 degrees and hoping
 * nobody notices that the light is coming out of the wrong side of it.
 */
export function spriteCells(rows, palette, { mirrorX = false } = {}) {
  if (!Array.isArray(rows) || rows.length !== SPRITE_SIZE) {
    throw new Error(`sprite must be ${SPRITE_SIZE} rows, got ${rows?.length}`);
  }
  const cells = new Array(SPRITE_SIZE * SPRITE_SIZE).fill(null);
  const cache = new Map();
  for (let y = 0; y < SPRITE_SIZE; y++) {
    const row = rows[y];
    if (typeof row !== 'string' || row.length !== SPRITE_SIZE) {
      throw new Error(`sprite row ${y} must be ${SPRITE_SIZE} characters`);
    }
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const ch = row[mirrorX ? SPRITE_SIZE - 1 - x : x];
      if (ch === '.' || ch === ' ') continue;
      const hex = palette[ch];
      if (!hex) continue; // a letter with no colour is a hole, like Minecraft
      let rgb = cache.get(hex);
      if (!rgb) {
        rgb = parseHex(hex);
        cache.set(hex, rgb);
      }
      cells[y * SPRITE_SIZE + x] = rgb;
    }
  }
  return { size: SPRITE_SIZE, cells };
}

/**
 * A growable set of triangles.
 *
 * Plain arrays rather than typed ones: an item is built once, cached forever,
 * and the largest of them is a few hundred triangles. The chunk mesher's
 * typed-buffer machinery would be a hundred lines here to save a hundred
 * microseconds that happen twice a session.
 */
export class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
  }

  /** Number of triangles written so far. */
  get triangles() {
    return this.positions.length / 9;
  }

  /**
   * One quad as two triangles. `corners` must be wound counter-clockwise as
   * seen from the direction `normal` points, or the face is invisible from
   * the side you meant to look at it from — which, on a solid, means you can
   * see straight through into the inside of it.
   */
  quad(corners, normal, color) {
    const [a, b, c, d] = corners;
    this._tri(a, b, c, normal, color);
    this._tri(a, c, d, normal, color);
  }

  _tri(a, b, c, normal, color) {
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color[0], color[1], color[2]);
    }
  }

  /** Plain data, for the THREE layer (or a test) to do what it likes with. */
  build() {
    return {
      positions: this.positions,
      normals: this.normals,
      colors: this.colors,
      triangles: this.triangles,
    };
  }
}

/** Multiply a colour by a shade factor, clamped. */
export function shade(rgb, factor) {
  return [
    Math.min(1, rgb[0] * factor),
    Math.min(1, rgb[1] * factor),
    Math.min(1, rgb[2] * factor),
  ];
}

/** Are two colours the same to within a texel's worth of rounding? */
function sameColor(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) < 1e-6
    && Math.abs(a[1] - b[1]) < 1e-6
    && Math.abs(a[2] - b[2]) < 1e-6;
}

/**
 * Extrude a sprite into a solid.
 *
 * The three families of face:
 *
 *   front / back  — one quad per *run* of same-coloured pixels along a row,
 *                   rather than one per pixel. A pickaxe is 91 opaque pixels
 *                   and 24 runs, so the merge is worth having, and it costs
 *                   one comparison per pixel.
 *   left / right  — the vertical silhouette: a face wherever an opaque pixel
 *                   has a transparent (or absent) neighbour sideways. Merged
 *                   downwards, for the same reason.
 *   top / bottom  — the horizontal silhouette, merged along the row.
 *
 * Interior faces are never generated at all, which is the whole trick: two
 * neighbouring opaque pixels have no wall between them, so a solid blade is
 * a solid blade and not sixteen stacked boxes with their sides showing
 * through each other where the depth buffer cannot decide.
 *
 * `depthAt(row)` is the new part: a depth *profile*. When present, each row
 * extrudes to its own thickness (in texels), so a sword can have a thin
 * blade, a thick crossguard and a slim grip in one model — and where two
 * rows of different thickness meet, the extruder emits the ledge that the
 * thicker row steps out into, which is what makes the guard read as a
 * guard instead of as a coloured stripe. Walls split where the thickness
 * changes so the silhouette follows the profile.
 *
 * @param {string[]} rows 16 strings of 16 characters
 * @param {Record<string,string>} palette letter -> '#rrggbb'
 * @param {object} [opts]
 * @param {number|function} [opts.depth]   total thickness in texels, or a
 *                                          per-row function (default 1)
 * @param {boolean} [opts.mirrorX]
 * @param {number} [opts.scale]   uniform scale applied to the finished model
 * @param {MeshBuilder} [opts.out] build into this builder (for composite
 *                                 models) instead of a fresh one
 * @returns {{positions:number[], normals:number[], colors:number[], triangles:number}}
 */
export function buildExtrudedSprite(rows, palette, opts = {}) {
  const builder = opts.out ?? new MeshBuilder();
  extrudeInto(builder, rows, palette, opts);
  return opts.out ? builder : builder.build();
}

/**
 * The working half of buildExtrudedSprite: write the extrusion into an
 * existing builder. Shared by the plain path and the tool models, which
 * extrude the sprite and then bolt extra parts onto the same mesh.
 */
export function extrudeInto(builder, rows, palette, opts = {}) {
  const {
    depth = SPRITE_DEPTH,
    mirrorX = false,
    scale = 1,
  } = opts;
  const depthAt = typeof depth === 'function'
    ? depth
    : () => depth;
  const { size, cells } = spriteCells(rows, palette, { mirrorX });
  const half = (row) => depthAt(row) / 2;
  const at = (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? null : cells[y * size + x]);

  // Pixel (x, row) occupies [x/size, (x+1)/size] across and, because row 0 is
  // the top of the sprite, [1 - (row+1)/size, 1 - row/size] up. Everything is
  // then centred on the origin and scaled, so a model is always 1x1 before
  // its pose has anything to say about it.
  const px = (x) => (x / size - 0.5) * scale;
  const py = (row) => (0.5 - row / size) * scale;
  const pz = (z) => z * scale;

  // ---- front (+z) and back (-z) ----
  //
  // Greedy-merged in two dimensions. A run along a row is extended
  // *downwards* for as long as the row below it is an identical run *of the
  // same depth*, which keeps the seam where a blade meets a guard exactly
  // where the profile says it is.
  const used = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size;) {
      const idx = y * size + x;
      const c = at(x, y);
      if (!c || used[idx]) { x++; continue; }

      // How far right this run goes.
      let w = 1;
      while (x + w < size && !used[y * size + x + w] && sameColor(at(x + w, y), c)) w++;

      // How far down it can be extended, keeping the same width and depth.
      let h = 1;
      outer: while (y + h < size) {
        if (depthAt(y + h) !== depthAt(y)) break;
        for (let i = 0; i < w; i++) {
          const j = (y + h) * size + x + i;
          if (used[j] || !sameColor(at(x + i, y + h), c)) break outer;
        }
        h++;
      }

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) used[(y + dy) * size + x + dx] = 1;
      }

      const x0 = px(x);
      const x1 = px(x + w);
      const y0 = py(y + h);
      const y1 = py(y);
      const hz = half(y);
      builder.quad(
        [[x0, y0, pz(hz)], [x1, y0, pz(hz)], [x1, y1, pz(hz)], [x0, y1, pz(hz)]],
        [0, 0, 1], shade(c, FACE_SHADE.front)
      );
      builder.quad(
        [[x1, y0, pz(-hz)], [x0, y0, pz(-hz)], [x0, y1, pz(-hz)], [x1, y1, pz(-hz)]],
        [0, 0, -1], shade(c, FACE_SHADE.back)
      );
      x += w;
    }
  }

  // ---- left (-x) and right (+x) silhouette, merged downwards ----
  // Runs split where the colour changes *or* the depth changes, so the
  // side wall follows the profile.
  for (let x = 0; x <= size; x++) {
    for (const dir of [-1, 1]) {
      const cx = dir === -1 ? x : x - 1; // the pixel that owns the face
      let y = 0;
      while (y < size) {
        const c = at(cx, y);
        const exposed = c && !at(cx + dir, y);
        if (!exposed) { y++; continue; }
        let end = y + 1;
        while (end < size) {
          const c2 = at(cx, end);
          if (!c2 || at(cx + dir, end) || !sameColor(c2, c)) break;
          if (depthAt(end) !== depthAt(y)) break;
          end++;
        }
        const fx = px(dir === -1 ? cx : cx + 1);
        const y0 = py(end);
        const y1 = py(y);
        const hz = half(y);
        if (dir === -1) {
          builder.quad(
            [[fx, y0, pz(-hz)], [fx, y0, pz(hz)], [fx, y1, pz(hz)], [fx, y1, pz(-hz)]],
            [-1, 0, 0], shade(c, FACE_SHADE.left)
          );
        } else {
          builder.quad(
            [[fx, y0, pz(hz)], [fx, y0, pz(-hz)], [fx, y1, pz(-hz)], [fx, y1, pz(hz)]],
            [1, 0, 0], shade(c, FACE_SHADE.right)
          );
        }
        y = end;
      }
    }
  }

  // ---- top (+y) and bottom (-y) silhouette, merged along the row ----
  for (let y = 0; y <= size; y++) {
    for (const dir of [-1, 1]) {
      // dir = -1: the face on top of a pixel (nothing in the row above it).
      const cy = dir === -1 ? y : y - 1;
      let x = 0;
      while (x < size) {
        const c = at(x, cy);
        const exposed = c && !at(x, cy + dir);
        if (!exposed) { x++; continue; }
        let end = x + 1;
        while (end < size) {
          const c2 = at(end, cy);
          if (!c2 || at(end, cy + dir) || !sameColor(c2, c)) break;
          if (depthAt(cy) !== depthAt(end)) break;
          end++;
        }
        const fy = py(dir === -1 ? cy : cy + 1);
        const x0 = px(x);
        const x1 = px(end);
        const hz = half(cy);
        if (dir === -1) {
          builder.quad(
            [[x0, fy, pz(hz)], [x1, fy, pz(hz)], [x1, fy, pz(-hz)], [x0, fy, pz(-hz)]],
            [0, 1, 0], shade(c, FACE_SHADE.top)
          );
        } else {
          builder.quad(
            [[x0, fy, pz(-hz)], [x1, fy, pz(-hz)], [x1, fy, pz(hz)], [x0, fy, pz(hz)]],
            [0, -1, 0], shade(c, FACE_SHADE.bottom)
          );
        }
        x = end;
      }
    }
  }

  // ---- depth steps: the ledges where the profile changes ----
  //
  // Two adjacent opaque rows of different thickness leave the thicker one
  // sticking out of the thinner one's front and back faces. These ledges
  // are the faces that show it. One per pixel column — a profile changes
  // at whole-row boundaries, and a row's worth of 1px ledges is nothing.
  for (let y = 0; y < size - 1; y++) {
    const hUp = half(y);
    const hDn = half(y + 1);
    if (hUp === hDn) continue;
    for (let x = 0; x < size; x++) {
      const cu = at(x, y);
      const cd = at(x, y + 1);
      if (!cu || !cd) continue;
      const c = cu;
      const x0 = px(x);
      const x1 = px(x + 1);
      const fy = py(y + 1);
      // The ledge is a vertical strip in the x-z plane at the row
      // boundary: the part of the thicker row's front face that the
      // thinner row does not cover. Seen from the front it is the step the
      // profile makes, so its normals point +y (upward face) and -y.
      const zLo = pz(Math.min(hUp, hDn));
      const zHi = pz(Math.max(hUp, hDn));
      // upward-facing ledge (+y)
      builder.quad(
        [[x0, fy, zHi], [x1, fy, zHi], [x1, fy, zLo], [x0, fy, zLo]],
        [0, 1, 0], shade(c, FACE_SHADE.top)
      );
      // downward-facing ledge (-y)
      builder.quad(
        [[x0, fy, zLo], [x1, fy, zLo], [x1, fy, zHi], [x0, fy, zHi]],
        [0, -1, 0], shade(c, FACE_SHADE.bottom)
      );
    }
  }

  return builder;
}

// ---------------------------------------------------------------- box models
//
// Some things are not pictures. A bucket is a container: it has an inside, it
// is open at the top, and when it is full you should be able to see the water
// sitting in it rather than a blue rectangle painted on the outside. An
// extruded sprite cannot say any of that — it is a slab with a bucket printed
// on both faces, and turning it edge-on shows you a bucket-shaped biscuit.
//
// So the bucket is built the way Minecraft builds a block model: out of
// cuboids, in texel units, with per-face colours. Everything below is in the
// same 16-texel space as the sprites, so a box model and an extruded sprite
// come out the same size and can be posed by the same numbers.

/**
 * One cuboid, in texel units (0..16 on each axis, origin at the lower-left-
 * back corner of the sprite cube). `faces` may omit any face that is buried
 * inside another box, which is not an optimisation so much as a correctness
 * measure: two coincident faces z-fight, and a bucket that shimmers along its
 * rim as you turn is worse than one with a hole nobody can see into.
 *
 * @typedef {{
 *   from: [number, number, number],
 *   to: [number, number, number],
 *   color: string,
 *   faces?: string[],
 *   shades?: Record<string, number>,
 * }} Box
 */

const ALL_FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/**
 * Build a mesh from a list of boxes.
 *
 * Texel coordinates come in, model coordinates (a 1x1x1 cube centred on the
 * origin) go out — same convention as the extruder, so the two are
 * interchangeable as far as the pose table is concerned.
 */
export function buildBoxModel(boxes, opts = {}) {
  const { scale = 1 } = opts;
  const mesh = new MeshBuilder();
  for (const box of boxes) boxInto(mesh, box, scale);
  return mesh.build();
}

/**
 * One texel-space box, written into an existing builder — the shared
 * half of buildBoxModel, so a tool can extrude its sprite and bolt its
 * boxes onto the same mesh.
 */
export function boxInto(builder, box, scale = 1) {
  const p = (t) => (t / SPRITE_SIZE - 0.5) * scale;
  const [fx, fy, fz] = box.from;
  const [tx, ty, tz] = box.to;
  if (tx <= fx || ty <= fy || tz <= fz) {
    throw new Error(`degenerate box ${JSON.stringify(box)}`);
  }
  const rgb = parseHex(box.color);
  const faces = box.faces ?? ALL_FACES;
  const shades = box.shades ?? {};
  const factor = (name) => shades[name] ?? FACE_SHADE[name];
  const x0 = p(fx), x1 = p(tx);
  const y0 = p(fy), y1 = p(ty);
  const z0 = p(fz), z1 = p(tz);

  for (const face of faces) {
    const col = shade(rgb, factor(face));
    switch (face) {
      case 'front':
        builder.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], col);
        break;
      case 'back':
        builder.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], col);
        break;
      case 'left':
        builder.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], col);
        break;
      case 'right':
        builder.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], col);
        break;
      case 'top':
        builder.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], col);
        break;
      case 'bottom':
        builder.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], col);
        break;
      default:
        throw new Error(`unknown face ${face}`);
    }
  }
  return builder;
}

// --------------------------------------------------------------- tool models
//
// A tool is built the way a 3D-resource-pack builds one: out of real
// cuboids and hexahedra, not extruded from its icon. The first version of
// the 3D tools extruded the 16×16 sprite — the *icon* — into a slab with a
// depth profile, which left every tool looking like the icon cut out of
// cardboard: the same diagonal composition, the same flat picture, just
// with thickness. A real pickaxe is a haft with a head curving down over
// it; a real sword tapers to a point; a real axe head is a wedge that
// ends in an edge. Those are three-dimensional facts, and they are what
// these parts say:
//
//   * a box — { from, to, color } — the straight parts (hafts, guards,
//     grips, pommels);
//   * a hexahedron — { corners, color } — eight corners in the canonical
//     box order, which lets a face collapse into an edge: the point of a
//     blade, the cutting edge of an axe, the flare of a shovel.
//
// Every face is shaded by the direction it points (the same ambient
// occlusion ratios FACE_SHADE uses), so the models read as lit from the
// upper-left-front without any per-face colour bookkeeping.
//
// The parts live with the shapes (TOOL_SOLIDS in item-models.js); this is
// the mesher that turns them into one solid mesh.

/** The six faces of a hexahedron, in the canonical corner order
 *  0 = (-x,-y,-z) 1 = (+x,-y,-z) 2 = (-x,+y,-z) 3 = (+x,+y,-z)
 *  4 = (-x,-y,+z) 5 = (+x,-y,+z) 6 = (-x,+y,+z) 7 = (+x,+y,+z). */
const HEXA_FACES = [
  { corners: [4, 5, 7, 6] }, // +z
  { corners: [1, 0, 2, 3] }, // -z
  { corners: [2, 3, 7, 6] }, // +y
  { corners: [0, 1, 5, 4] }, // -y
  { corners: [0, 4, 6, 2] }, // -x
  { corners: [1, 5, 7, 3] }, // +x
];

/**
 * A hexahedron into an existing builder: eight corners in texel space, in
 * the canonical order above. A face whose four corners collapse (zero
 * area) is skipped, which is how a blade gets a point and an axe gets an
 * edge; every surviving face's winding is pointed outward from the body,
 * so slanted and collapsed shapes come out solid instead of inside-out.
 */
export function hexahedronInto(builder, corners, color, scale = 1) {
  const p = (t) => (t / SPRITE_SIZE - 0.5) * scale;
  const P = corners.map((c) => [p(c[0]), p(c[1]), p(c[2])]);
  const rgb = parseHex(color);
  const centroid = [0, 0, 0];
  for (const c of P) {
    centroid[0] += c[0] / 8;
    centroid[1] += c[1] / 8;
    centroid[2] += c[2] / 8;
  }
  for (const face of HEXA_FACES) {
    const [a, b, c, d] = face.corners.map((i) => P[i]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-12) continue; // collapsed into an edge: the blade's point
    n = [n[0] / len, n[1] / len, n[2] / len];
    const center = [
      (a[0] + b[0] + c[0] + d[0]) / 4,
      (a[1] + b[1] + c[1] + d[1]) / 4,
      (a[2] + b[2] + c[2] + d[2]) / 4,
    ];
    const outward = [center[0] - centroid[0], center[1] - centroid[1], center[2] - centroid[2]];
    let quad = [a, b, c, d];
    if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) {
      n = [-n[0], -n[1], -n[2]];
      quad = [a, d, c, b];
    }
    // A face can collapse at a corner (a blade's point) without collapsing
    // entirely: drop the doubled corner, and emit one triangle where three
    // corners remain — a degenerate triangle would fail the winding checks
    // and, worse, leave a sliver the light hits differently from its
    // neighbours.
    const pts = [];
    for (const q of quad) {
      const last = pts[pts.length - 1];
      if (!last || Math.abs(q[0] - last[0]) + Math.abs(q[1] - last[1]) + Math.abs(q[2] - last[2]) > 1e-12) {
        pts.push(q);
      }
    }
    if (pts.length === 3) {
      builder._tri(pts[0], pts[1], pts[2], n, shade(rgb, directionShade(n)));
    } else if (pts.length === 4) {
      builder.quad(pts, n, shade(rgb, directionShade(n)));
    }
  }
  return builder;
}

/**
 * The face shading for a solid part: how much light a face catches given
 * the direction it points, weighted by how much of the normal lies along
 * each axis. Axis-aligned faces get exactly FACE_SHADE's values; slanted
 * faces (a wedge's top) blend smoothly between them.
 */
function directionShade(n) {
  const l1 = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
  if (l1 < 1e-12) return 1;
  return (
    Math.abs(n[0]) * (n[0] < 0 ? FACE_SHADE.left : FACE_SHADE.right)
    + Math.abs(n[1]) * (n[1] < 0 ? FACE_SHADE.bottom : FACE_SHADE.top)
    + Math.abs(n[2]) * (n[2] < 0 ? FACE_SHADE.back : FACE_SHADE.front)
  ) / l1;
}

/**
 * Build a solid item model from its parts: each part is a box
 * ({ from, to, color }) or a hexahedron ({ corners, color }), all in
 * texel space, all shaded by the direction of their faces. Everything
 * lands in one mesh.
 *
 * @param {Array} parts
 * @param {object} [opts] { scale }
 */
export function buildSolidModel(parts, opts = {}) {
  const { scale = 1 } = opts;
  const builder = new MeshBuilder();
  for (const part of parts) {
    if (part.corners) hexahedronInto(builder, part.corners, part.color, scale);
    else boxInto(builder, part, scale);
  }
  return builder.build();
}

// ------------------------------------------------------------- the bucket
//
// Minecraft's bucket is a truncated cone in the icon and a flat sprite in the
// hand. This one is a real vessel, because the bucket is the one item in this
// game whose *state* matters — full or empty is the difference between a
// pond on a clifftop and a walk back to the sea — and a container you can
// see into says which it is from any angle, with no icon to read.
//
// Texel layout, from the bottom up:
//   y 1..2    the base plate, a little wider than the wall so it reads as a
//             rim rather than as the wall simply stopping
//   y 2..11   the four walls, one texel thick, with a hollow between them
//   y 11..12  the top rim
//   y 3..10   the water, when there is any, inset so the wall shows around it
//   the handle: two uprights outside the wall and a bar across the top

const IRON_DARK = '#4a5058';
const IRON_MID = '#8a929a';
const IRON_LIGHT = '#c6ccd4';
const IRON_INNER = '#5c646c';
const WATER_TOP = '#4d86d8';
const WATER_DEEP = '#2a4fae';

/**
 * The boxes that make up a bucket.
 * @param {boolean} full whether it is carrying water
 */
export function bucketBoxes(full = false) {
  const boxes = [];

  // --- base ---
  boxes.push({
    from: [3, 1, 3], to: [13, 2, 13],
    color: IRON_MID,
    // The top of the base is the floor of the bucket. It is only visible
    // when the bucket is empty, and when it is full the water sits on it —
    // but leaving it out entirely would show the ground through the bottom
    // of an empty one, which is a hole in a bucket.
  });

  // --- four walls, leaving the middle hollow ---
  const wall = (from, to) => boxes.push({ from, to, color: IRON_MID });
  wall([3, 2, 3], [4, 11, 13]);   // -x
  wall([12, 2, 3], [13, 11, 13]); // +x
  wall([4, 2, 3], [12, 11, 4]);   // -z
  wall([4, 2, 12], [12, 11, 13]); // +z

  // --- the inside of the walls, a shade darker ---
  // Four thin plates just inside the walls rather than one hollow box,
  // because a box needs six faces and four of these need exactly one each.
  const inner = (from, to, faces) =>
    boxes.push({ from, to, color: IRON_INNER, faces, shades: { front: 0.8, back: 0.8, left: 0.8, right: 0.8 } });
  inner([4, 2, 4], [4.001, 11, 12], ['right']);
  inner([11.999, 2, 4], [12, 11, 12], ['left']);
  inner([4, 2, 4], [12, 11, 4.001], ['front']);
  inner([4, 2, 11.999], [12, 11, 12], ['back']);

  // --- rim: four bars around an open mouth ---
  //
  // A ring, not a slab. One box spanning the whole footprint would draw a
  // top face straight across the opening — a lid — and a bucket you cannot
  // see into is the bucket-shaped biscuit this model exists to stop being:
  // the inner walls, the floor and the water plane would all be sealed under
  // it and never drawn. A box model has no holes, so the hole is made out of
  // the four bars that surround it.
  const rim = (from, to) => boxes.push({ from, to, color: IRON_LIGHT });
  rim([3, 11, 3], [13, 12, 4]);   // -z
  rim([3, 11, 12], [13, 12, 13]); // +z
  rim([3, 11, 4], [4, 12, 12]);   // -x
  rim([12, 11, 4], [13, 12, 12]); // +x

  // --- handle: two uprights and a bar over the top ---
  boxes.push({ from: [2, 6, 7], to: [3, 13, 9], color: IRON_DARK });
  boxes.push({ from: [13, 6, 7], to: [14, 13, 9], color: IRON_DARK });
  boxes.push({ from: [3, 13, 7], to: [13, 14, 9], color: IRON_DARK });

  // --- the water, if any ---
  if (full) {
    boxes.push({
      from: [4, 2, 4], to: [12, 10, 12],
      color: WATER_DEEP,
      // Only the top is ever seen; the sides are behind the wall. Drawing
      // them anyway would put two surfaces a thousandth of a texel apart.
      faces: ['top'],
      shades: { top: 1.0 },
    });
    // A lighter band just under the surface, so the water has some depth to
    // it when you look straight down into the bucket.
    boxes.push({
      from: [4.5, 9.9, 4.5], to: [11.5, 9.95, 11.5],
      color: WATER_TOP,
      faces: ['top'],
      shades: { top: 1.05 },
    });
  }

  return boxes;
}

/** The finished bucket mesh. */
export function buildBucketModel(full = false, opts = {}) {
  return buildBoxModel(bucketBoxes(full), opts);
}

// ------------------------------------------------------------------ helpers

/**
 * The axis-aligned bounds of a built mesh. Used by the pose code to sit a
 * model in the hand by its grip rather than by its centre, and by the tests
 * to check that a tool is actually tool-shaped.
 */
export function meshBounds(mesh) {
  const pos = mesh.positions;
  if (!pos.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (pos[i + a] < min[a]) min[a] = pos[i + a];
      if (pos[i + a] > max[a]) max[a] = pos[i + a];
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/**
 * Is this mesh watertight in the only sense that matters here — every face
 * has an outward normal, and no two faces sit in the same place pointing the
 * same way?
 *
 * Not a topological check. It counts coincident co-oriented quads, which is
 * the one failure the mesher can actually produce (a run merged twice, or a
 * box model with a face left in that another box already covers) and the one
 * that shows up on screen as z-fighting.
 */
export function coincidentFaces(mesh) {
  const seen = new Map();
  let clashes = 0;
  const pos = mesh.positions;
  const nrm = mesh.normals;
  for (let t = 0; t < pos.length; t += 9) {
    const key = [];
    for (let v = 0; v < 9; v++) key.push(pos[t + v].toFixed(5));
    key.push(nrm[t].toFixed(3), nrm[t + 1].toFixed(3), nrm[t + 2].toFixed(3));
    const k = key.join(',');
    if (seen.has(k)) clashes++;
    else seen.set(k, true);
  }
  return clashes;
}

/**
 * Every triangle's winding agrees with its stated normal.
 *
 * A face wound the wrong way is invisible from outside and visible from
 * inside, which on a solid object means you see through the near side of it
 * to the inside of the far side — subtle enough on a dark tool that it took
 * a test to find rather than an eye.
 */
export function windingErrors(mesh) {
  const pos = mesh.positions;
  const nrm = mesh.normals;
  let bad = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const ax = pos[t + 3] - pos[t], ay = pos[t + 4] - pos[t + 1], az = pos[t + 5] - pos[t + 2];
    const bx = pos[t + 6] - pos[t + 3], by = pos[t + 7] - pos[t + 4], bz = pos[t + 8] - pos[t + 5];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const dot = cx * nrm[t] + cy * nrm[t + 1] + cz * nrm[t + 2];
    if (dot <= 1e-12) bad++;
  }
  return bad;
}
