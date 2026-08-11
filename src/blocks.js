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
import { getAtlasTexture, getBlockDefById, ATLAS_TILES, atlasTile } from './textures.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants.js';
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
export function meshChunk(world, cx, cz) {
  const chunk = world.chunk(cx, cz);
  const pos = [];
  const uv = [];
  const n = [];
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const top = Math.min(chunk.maxY + 1, WORLD_HEIGHT - 1);

  // Neighbour chunks are read through world.get so faces on a chunk seam are
  // culled correctly against the chunk next door.
  for (let y = 0; y <= top; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = chunk.blocks[chunk.index(lx, y, lz)];
        if (id === 0) continue;
        const wx = x0 + lx;
        const wz = z0 + lz;
        for (let f = 0; f < 6; f++) {
          const d = DIRS[f];
          const ny = y + d[1];
          if (ny < 0) continue; // sealed underside is never visible
          let neighbour;
          if (ny >= WORLD_HEIGHT) {
            neighbour = 0;
          } else {
            const nx = lx + d[0];
            const nz = lz + d[2];
            neighbour = (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE)
              ? chunk.blocks[chunk.index(nx, ny, nz)]
              : world.get(wx + d[0], ny, wz + d[2]);
          }
          if (neighbour !== 0) continue;

          const face = FACES[f];
          const tile = atlasTile(id, face.col);
          for (const vi of TRI_VERTICES) {
            const v = face.v[vi];
            const t = face.uv[vi];
            pos.push(wx + v[0], y + v[1], wz + v[2]);
            uv.push(tileU(tile, t[0]), t[1]);
            n.push(face.n[0], face.n[1], face.n[2]);
          }
        }
      }
    }
  }
  return { pos, uv, n };
}

function buildGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.n, 3));
  geo.computeBoundingSphere(); // needed for frustum culling to work
  return geo;
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
    /** key -> THREE.Mesh */
    this.meshes = new Map();
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

    // drop meshes that are now out of range
    for (const [key, mesh] of this.meshes) {
      const [mx, mz] = key.split(',').map(Number);
      const dx = mx - cx;
      const dz = mz - cz;
      if (dx * dx + dz * dz > (r + 1) * (r + 1) + r) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(key);
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

  buildChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const buf = meshChunk(this.world, cx, cz);
    const existing = this.meshes.get(key);
    if (buf.pos.length === 0) {
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
        this.meshes.delete(key);
      }
      return;
    }
    const geo = buildGeometry(buf);
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geo;
      return;
    }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; // chunks never move
    mesh.updateMatrix();
    this.meshes.set(key, mesh);
    this.scene.add(mesh);
  }

  /** True once every chunk in range has a mesh (used by the loading screen). */
  get ready() {
    return this.queue.length === 0;
  }
}

export { toChunk, toLocal };
