// Voxel mesher with hidden-face culling, and the chunk streamer that keeps
// the scene in sync with an infinite world.
//
// Two things make this fast enough to stream chunks at 90-120 fps:
//
//  1. One draw call per chunk. Every block face samples the same atlas
//     texture, so a chunk is a single mesh no matter how many block types it
//     contains. (Previously it was one mesh per block type per chunk, which
//     with generated terrain would have been ~5 draw calls per chunk and
//     hundreds on screen.)
//  2. Column-bounded scanning. A chunk records its highest solid block, so
//     the mesher walks 15 layers of a hilly chunk instead of all 64.
//
// Face table: each entry is a quad with its outward normal, atlas column
// (0 = side, 1 = top, 2 = bottom), 4 corners wound CCW when viewed from
// outside, and UVs within that tile.

import * as THREE from '../vendor/three.module.min.js';
import {
  getAtlasTexture, getWaterTextures, getBlockDefById, ATLAS_TILES, atlasTile,
} from './textures.js';
import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_MIN_Y, DEEP_RADIUS, toLayer, fromLayer } from './constants.js';
import { CAVE_CEILING_DEPTH, isWater, isOpaque } from './terrain.js';
import { FluidMesher, STILL, FLOWING } from './water-mesh.js';

const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
import { toLocal, toChunk, chunkKey } from './world.js';

export const FACES = [
  { n: [1, 0, 0], col: 0, v: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
  { n: [-1, 0, 0], col: 0, v: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], uv: [[0,0],[1,0],[1,1],[0,1]] },
  { n: [0, 1, 0], col: 1, v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], uv: [[0,0],[1,0],[1,1],[0,1]] },
  { n: [0, -1, 0], col: 2, v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
  { n: [0, 0, 1], col: 0, v: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
  { n: [0, 0, -1], col: 0, v: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], uv: [[0,0],[1,0],[1,1],[0,1]] },
];

const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

const TRI_VERTICES = [0, 1, 2, 0, 2, 3]; // two triangles per quad

export const getBlockDef = getBlockDefById;

/** u range of a tile in the atlas strip, with a half-texel inset. */
export function tileU(tile, u) {
  return (tile + u) / ATLAS_TILES;
}

/**
 * Build the vertex data for one chunk. Pure apart from reading the world —
 * no THREE, no DOM — so it is unit-testable in Node.
 * Returns { pos, uv, n } with 6 vertices per quad, in world coordinates.
 */
// Scratch buffers reused by every chunk. Pushing onto plain arrays cost
// ~180k calls and ~20 ms per chunk; writing straight into typed memory and
// copying out once at the end is an order of magnitude faster and allocates
// nothing per chunk.
let capQuads = 16384;
let sPos = new Uint8Array(capQuads * 18);
let sNrm = new Int8Array(capQuads * 18);
let sUv = new Uint16Array(capQuads * 12);

function growScratch() {
  capQuads *= 2;
  sPos = new Uint8Array(capQuads * 18);
  sNrm = new Int8Array(capQuads * 18);
  sUv = new Uint16Array(capQuads * 12);
}

// Water is not built here. Its surface is not a stack of boxes — the height is
// defined at the corners and shared between cells — so it gets a mesher of its
// own, which also owns its buffers. See water-mesh.js.
const fluid = new FluidMesher();

/**
 * How much rock below the shallowest neighbouring surface still gets meshed
 * in shell mode. Caves stop CAVE_CEILING_DEPTH below the surface, so a couple
 * of layers past that is enough to guarantee no visible face is skipped.
 */
const SHELL_MARGIN = CAVE_CEILING_DEPTH + 2;

/**
 * Build one chunk's geometry.
 *
 * `deep` decides whether cave walls are included. Caves never break through
 * to the sky — generation leaves rock above every one of them — so the
 * terrain shell is watertight and nothing underground can be seen from
 * outside it. Distant chunks therefore skip it entirely, which halves both
 * the geometry and the time spent building it. Chunks the player has edited
 * are always built deep, because a pit they dug themselves *is* a hole in
 * that shell.
 */
export function meshChunk(world, cx, cz, deep = true) {
  const chunk = world.chunk(cx, cz);
  const surface = chunk.surface;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  let vi3 = 0; // write cursor into sPos / sNrm
  let vi2 = 0; // write cursor into sUv
  let overflow = false;
  fluid.begin(world, chunk, x0, z0);
  // Everything in here counts in layers (y - WORLD_MIN_Y), which keeps the
  // vertex positions non-negative and inside a byte.
  const top = Math.min(toLayer(chunk.maxY) + 1, WORLD_HEIGHT - 1);
  const heights = chunk.heights;

  // The four neighbours, so that edge columns can be skipped like any other.
  // They were once scanned in full because reaching across a border looked
  // like more trouble than 12% of columns was worth — but that 12% was doing
  // 71% of the scanning, because a full-height scan is an order of magnitude
  // longer than a skipped one. The mesher already reads these chunks for
  // face culling, so nothing extra is generated.
  const west = world.chunk(cx - 1, cz);
  const east = world.chunk(cx + 1, cz);
  const north = world.chunk(cx, cz - 1);
  const south = world.chunk(cx, cz + 1);
  const E = CHUNK_SIZE - 1;

  // Shell mode trusts that the only air under the surface is cave air, sealed
  // in. A pit dug in *any* neighbour breaks that seal across the border too,
  // so an edited neighbour disqualifies this chunk as well as itself.
  const shell = !deep && !chunk.edited
    && !west.edited && !east.edited && !north.edited && !south.edited;
  /** A per-column value, reaching into the neighbouring chunk when needed. */
  const at = (pick, lx, lz) => {
    if (lx < 0) return pick(west)[lz * CHUNK_SIZE + E];
    if (lx > E) return pick(east)[lz * CHUNK_SIZE];
    if (lz < 0) return pick(north)[E * CHUNK_SIZE + lx];
    if (lz > E) return pick(south)[lx];
    return pick(chunk)[lz * CHUNK_SIZE + lx];
  };
  const pickH = (c) => c.heights;
  const pickS = (c) => c.surface;

  // Iterating column-by-column lets us skip the buried rock: everything
  // below the *lowest* of a column's four neighbours is enclosed on all
  // sides and can never show a face. On mountain chunks that is 40 layers
  // of stone per column, and scanning it was costing ~25 ms a chunk.
  //
  // `heights` is what makes this safe once caves exist: generation lowers a
  // column's entry to the deepest layer it hollowed out, so a tunnel below
  // is never skipped over.
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const col = lz * CHUNK_SIZE + lx;
      let yStart = 0;
      const interior = lx > 0 && lx < E && lz > 0 && lz < E;
      const gt = heights[col];
      if (gt > 0) {
        const lowest = interior
          ? Math.min(
            heights[col - 1], heights[col + 1],
            heights[col - CHUNK_SIZE], heights[col + CHUNK_SIZE]
          )
          : Math.min(
            at(pickH, lx - 1, lz), at(pickH, lx + 1, lz),
            at(pickH, lx, lz - 1), at(pickH, lx, lz + 1)
          );
        // A neighbour reset to 0 by an edit falls back to a full scan.
        if (lowest > 0) yStart = Math.max(0, Math.min(gt, lowest) - 1);
      }
      if (shell) {
        // Down to the *lowest* neighbouring surface, not this column's:
        // a cliff face is exposed all the way down to the ground beside
        // it, and cutting it off at this column's own surface would punch
        // a hole in the wall.
        const s = interior
          ? Math.min(
            surface[col],
            surface[col - 1], surface[col + 1],
            surface[col - CHUNK_SIZE], surface[col + CHUNK_SIZE]
          )
          : Math.min(
            surface[col],
            at(pickS, lx - 1, lz), at(pickS, lx + 1, lz),
            at(pickS, lx, lz - 1), at(pickS, lx, lz + 1)
          );
        yStart = Math.max(yStart, s - SHELL_MARGIN);
      }

      for (let y = yStart; y <= top; y++) {
        const id = chunk.blocks[y * CHUNK_AREA + col];
        if (id === 0) continue;
        // Water is a surface, not a block. Hand it to the fluid mesher, which
        // works out its own faces from the heights of the corners it shares
        // with its neighbours.
        if (isWater(id)) {
          fluid.cell(lx, y, lz, id);
          continue;
        }

        for (let f = 0; f < 6; f++) {
          const d = DIRS[f];
          const ny = y + d[1];
          if (ny < 0) continue; // sealed underside is never visible
          const neighbour = blockAt(chunk, world, x0, z0, lx + d[0], ny, lz + d[2]);

          // A face is hidden only by another solid — you can see the sea floor
          // through the sea, so water does not count as cover.
          if (isOpaque(neighbour)) continue;

          const face = FACES[f];
          const tile = atlasTile(id, face.col);

          if (vi3 + 18 > sPos.length) { overflow = true; break; }
          for (const vi of TRI_VERTICES) {
            const v = face.v[vi];
            const t = face.uv[vi];
            // Positions are chunk-local so they fit in a byte; the mesh is
            // placed at the chunk origin instead.
            sPos[vi3] = lx + v[0];
            sPos[vi3 + 1] = y + v[1];
            sPos[vi3 + 2] = lz + v[2];
            sNrm[vi3] = face.n[0];
            sNrm[vi3 + 1] = face.n[1];
            sNrm[vi3 + 2] = face.n[2];
            vi3 += 3;
            sUv[vi2] = tileU(tile, t[0]) * 65535;
            sUv[vi2 + 1] = t[1] * 65535;
            vi2 += 2;
          }
        }
        if (overflow) break;
      }
      if (overflow) break;
    }
    if (overflow) break;
  }

  if (overflow) {
    growScratch();
    return meshChunk(world, cx, cz, deep);
  }

  return {
    pos: sPos.slice(0, vi3),
    n: sNrm.slice(0, vi3),
    uv: sUv.slice(0, vi2), // 16-bit normalised: divide by 65535 for 0..1
    water: fluid.end(), // { still, flowing }, each a { pos, n, uv }
    x0,
    z0,
  };
}

/**
 * A block by chunk-local coordinates. Anything outside this chunk goes
 * through the world, which generates the neighbour if it has to.
 */
function blockAt(chunk, world, x0, z0, lx, layer, lz) {
  if (layer < 0 || layer >= WORLD_HEIGHT) return 0;
  if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
    return chunk.blocks[layer * CHUNK_AREA + lz * CHUNK_SIZE + lx];
  }
  return world.get(x0 + lx, fromLayer(layer), z0 + lz);
}

/** Full-precision geometry, for the single cube held in the hand. */
function buildGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.n, 3));
  geo.computeBoundingSphere(); // needed for frustum culling to work
  return geo;
}

/**
 * Chunk geometry, packed small. Positions are chunk-local integers (0..32 in
 * x/z, 0..64 in y) so they fit in a byte, normals are just -1/0/1, and UVs
 * only need 16 bits. That is 10 bytes per vertex instead of 32 — at a render
 * distance of 40 chunks the difference is hundreds of megabytes of GPU
 * memory, which is the whole reason such a distance is usable at all.
 */
function buildChunkGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Uint8BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Int8BufferAttribute(buf.n, 3));
  geo.setAttribute('uv', new THREE.Uint16BufferAttribute(buf.uv, 2, true));
  geo.computeBoundingSphere(); // needed for frustum culling to work
  return geo;
}

/** Water, whose surface heights are fractions and so need real floats. */
function buildWaterGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Int8BufferAttribute(buf.n, 3));
  geo.setAttribute('uv', new THREE.Uint16BufferAttribute(buf.uv, 2, true));
  geo.computeBoundingSphere();
  return geo;
}

/** Bytes of vertex data a chunk geometry occupies (for the debug screen). */
export function geometryBytes(geo) {
  const count = geo.getAttribute('position')?.count ?? 0;
  return count * (3 + 3 + 4);
}

/**
 * A single unit cube centred on the origin, textured from the atlas — the
 * block held in the player's hand in first person.
 */
export function buildSingleBlockGeometry(blockId) {
  const buf = { pos: [], uv: [], n: [] };
  for (const face of FACES) {
    const tile = atlasTile(blockId, face.col);
    for (const vi of TRI_VERTICES) {
      const v = face.v[vi];
      const t = face.uv[vi];
      buf.pos.push(v[0] - 0.5, v[1] - 0.5, v[2] - 0.5);
      buf.uv.push(tileU(tile, t[0]), t[1]);
      buf.n.push(face.n[0], face.n[1], face.n[2]);
    }
  }
  return buildGeometry(buf);
}

/**
 * Keeps the scene meshes in sync with the world as the player moves.
 * Chunk builds are spread across frames on a time budget so streaming never
 * causes a visible hitch.
 */
export class WorldRenderer {
  constructor(world, scene, { budgetMs = 6 } = {}) {
    this.world = world;
    this.scene = scene;
    this.budgetMs = budgetMs;
    this.material = new THREE.MeshLambertMaterial({ map: getAtlasTexture() });
    // Water is drawn after everything else and does not write depth, so a
    // surface never hides the water behind it and the sea floor shows
    // through. DoubleSide keeps the surface visible from underneath.
    //
    // Calm and moving water are separate materials because they are separate
    // textures that scroll at their own speeds. That is not a draw call per
    // chunk each: a chunk out at sea has only calm water in it and a chunk
    // with no water at all has neither.
    const waterTex = getWaterTextures();
    const waterMaterial = (map) => new THREE.MeshLambertMaterial({
      map,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.waterMaterials = [waterMaterial(waterTex.still), waterMaterial(waterTex.flowing)];
    this.waterTextures = [waterTex.still, waterTex.flowing];
    /** key -> THREE.Mesh */
    this.meshes = new Map();
    /**
     * key -> the translucent water meshes, one map per texture, and only for
     * the chunks that actually have that kind of water in them.
     */
    this.waterMeshes = [new Map(), new Map()];
    /** Chunks waiting to be built, nearest to the player first. */
    this.queue = [];
    this.centre = { cx: 0, cz: 0 };
    this.renderDistance = 4;
    this.stats = { built: 0, queued: 0, meshes: 0 };
  }

  setRenderDistance(chunks) {
    this.renderDistance = Math.max(1, Math.round(chunks));
  }

  /**
   * Work out which chunks should exist around (cx, cz) and queue the missing
   * ones nearest-first; drop the meshes that fell outside.
   */
  updateStreaming(cx, cz) {
    const r = this.renderDistance;
    if (this.centre.cx !== cx || this.centre.cz !== cz || this.queue.length === 0) {
      this.centre = { cx, cz };
      const wanted = [];
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          // circular distance keeps the corners of the square from costing
          // 40% more chunks than they are worth
          if (dx * dx + dz * dz > r * r + r) continue;
          const key = chunkKey(cx + dx, cz + dz);
          if (!this.meshes.has(key)) wanted.push({ cx: cx + dx, cz: cz + dz, d: dx * dx + dz * dz, key });
        }
      }
      wanted.sort((a, b) => a.d - b.d);
      this.queue = wanted;
    }

    // drop meshes that are now out of range, and rebuild the ones that just
    // crossed the deep radius in either direction — walking towards a chunk
    // has to bring its caves in, and walking away has to give the memory back
    for (const [key, mesh] of this.meshes) {
      const [mx, mz] = key.split(',').map(Number);
      const dx = mx - cx;
      const dz = mz - cz;
      if (dx * dx + dz * dz > (r + 1) * (r + 1) + r) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(key);
        for (const store of this.waterMeshes) {
          const water = store.get(key);
          if (!water) continue;
          this.scene.remove(water);
          water.geometry.dispose();
          store.delete(key);
        }
      } else if (mesh.userData.deep !== this._deepAt(mx, mz)) {
        this.world.markDirty(mx, mz);
      }
    }
  }

  /** Build queued and dirty chunks until the frame budget runs out. */
  update(cx, cz) {
    this.updateStreaming(cx, cz);

    const start = performance.now();
    let built = 0;

    // Edited chunks jump the queue — a block you just placed must appear now.
    for (const [dcx, dcz] of this.world.consumeDirtyChunks()) {
      this.buildChunk(dcx, dcz);
      built++;
    }

    while (this.queue.length && performance.now() - start < this.budgetMs) {
      const next = this.queue.shift();
      this.buildChunk(next.cx, next.cz);
      built++;
    }

    this.stats.built = built;
    this.stats.queued = this.queue.length;
    this.stats.meshes = this.meshes.size;
  }

  /** Chunks this close to the player get their caves meshed. */
  _deepAt(cx, cz) {
    const dx = cx - this.centre.cx;
    const dz = cz - this.centre.cz;
    return dx * dx + dz * dz <= DEEP_RADIUS * DEEP_RADIUS;
  }

  buildChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const deep = this._deepAt(cx, cz);
    const buf = meshChunk(this.world, cx, cz, deep);
    this._sync(this.meshes, key, buf, buf.pos, buildChunkGeometry, this.material, deep, true);
    for (const kind of [STILL, FLOWING]) {
      const water = kind === STILL ? buf.water.still : buf.water.flowing;
      this._sync(this.waterMeshes[kind], key, buf, water.pos,
        () => buildWaterGeometry(water), this.waterMaterials[kind], deep, false);
    }
  }

  /**
   * Scroll the water. Both textures drift along their v axis, which the
   * mesher has already rotated to point downhill on a flowing face, so a
   * stream runs the way it is going and the sea just breathes.
   *
   * It runs off the game clock, so pausing stops the sea like everything else.
   */
  advanceWater(dt) {
    this.waterTextures[STILL].offset.y = (this.waterTextures[STILL].offset.y + dt * 0.06) % 1;
    this.waterTextures[FLOWING].offset.y =
      (this.waterTextures[FLOWING].offset.y + dt * 0.85) % 1;
  }

  /**
   * Put one geometry on screen for a chunk, creating, replacing or removing
   * the mesh as the chunk's contents require. Opaque blocks and water go
   * through this separately: a chunk with no water never gets a second mesh,
   * so the sea costs a draw call only where there is sea.
   */
  _sync(store, key, buf, data, build, material, deep, shadows) {
    const existing = store.get(key);
    if (data.length === 0) {
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
        store.delete(key);
      }
      return;
    }
    const geo = build(buf);
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geo;
      existing.userData.deep = deep;
      return;
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    // Vertices are chunk-local and layer-indexed, so the mesh carries both
    // the horizontal chunk origin and the world's floor.
    mesh.position.set(buf.x0, WORLD_MIN_Y, buf.z0);
    mesh.matrixAutoUpdate = false; // chunks never move
    mesh.updateMatrix();
    mesh.userData.deep = deep;
    store.set(key, mesh);
    this.scene.add(mesh);
  }

  /** Rough GPU vertex memory across every live chunk mesh, in MB. */
  get geometryMB() {
    let bytes = 0;
    for (const mesh of this.meshes.values()) bytes += geometryBytes(mesh.geometry);
    // Water positions are floats rather than bytes, hence the second rate.
    for (const store of this.waterMeshes) {
      for (const mesh of store.values()) {
        bytes += (mesh.geometry.getAttribute('position')?.count ?? 0) * (12 + 3 + 4);
      }
    }
    return bytes / (1024 * 1024);
  }

  /**
   * True once the chunks *around the player* are meshed. The loading screen
   * waits on this rather than the whole queue: at a 40-chunk render distance
   * the full queue is several thousand chunks and takes ten seconds, but the
   * handful you can actually touch are done almost immediately, and the rest
   * streams in behind the fog while you play.
   */
  get ready() {
    const next = this.queue[0];
    return !next || next.d > 4; // d is the squared chunk distance
  }
}

export { toChunk, toLocal };
