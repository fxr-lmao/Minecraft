// Voxel mesher with hidden-face culling.
//
// Only faces exposed to air are emitted, so the flat 128x128x4 ground drops
// from ~393k faces (6 per block) to ~18k faces. Faces are merged into one
// BufferGeometry per block type *per chunk*, so placing or breaking a block
// only re-meshes that chunk (a few ms) instead of the whole world.
//
// Face table: each entry is a quad with its outward normal, atlas column
// (0 = side, 1 = top, 2 = bottom), 4 corners wound CCW when viewed from
// outside, and UVs within that column.

import * as THREE from '../vendor/three.module.min.js';
import { getBlockAssets, getBlockDefById } from './textures.js';

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

/** Is the neighbor cell solid for rendering? (out-of-bounds rules) */
function neighborSolid(world, x, y, z) {
  if (y < 0) return true; // below the world: sealed
  if (y >= world.layers) return false; // above: open sky
  // Horizontal out-of-bounds counts as air so the world edge walls render.
  if (x < 0 || x >= world.size || z < 0 || z >= world.size) return false;
  return world.blocks[world.index(x, y, z)] !== 0;
}

export const getBlockDef = getBlockDefById;

/**
 * Pure face collection (no DOM/THREE) — unit-testable in Node.
 * `bounds` limits the scan to one chunk: { x0, x1, z0, z1 } (x1/z1 exclusive).
 * Returns Map<blockId, { pos: number[], uv: number[], n: number[] }>
 * with 6 vertices per quad.
 */
export function collectFaces(world, bounds) {
  const x0 = bounds ? Math.max(0, bounds.x0) : 0;
  const x1 = bounds ? Math.min(world.size, bounds.x1) : world.size;
  const z0 = bounds ? Math.max(0, bounds.z0) : 0;
  const z1 = bounds ? Math.min(world.size, bounds.z1) : world.size;

  const buffers = new Map();
  for (let y = 0; y < world.layers; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const id = world.blocks[world.index(x, y, z)];
        if (id === 0) continue;
        for (let f = 0; f < 6; f++) {
          const d = DIRS[f];
          if (neighborSolid(world, x + d[0], y + d[1], z + d[2])) continue;
          let buf = buffers.get(id);
          if (!buf) {
            buf = { pos: [], uv: [], n: [] };
            buffers.set(id, buf);
          }
          const face = FACES[f];
          const u0 = face.col / 3; // atlas column offset
          for (const vi of TRI_VERTICES) {
            const v = face.v[vi];
            const u = face.uv[vi];
            buf.pos.push(x + v[0], y + v[1], z + v[2]);
            buf.uv.push(u0 + u[0] / 3, u[1]);
            buf.n.push(face.n[0], face.n[1], face.n[2]);
          }
        }
      }
    }
  }
  return buffers;
}

function buildGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.n, 3));
  return geo;
}

/**
 * A single unit cube centred on the origin with the same atlas UVs the world
 * mesher uses — the block held in the player's hand in first person.
 */
export function buildSingleBlockGeometry() {
  const buf = { pos: [], uv: [], n: [] };
  for (const face of FACES) {
    const u0 = face.col / 3;
    for (const vi of TRI_VERTICES) {
      const v = face.v[vi];
      const u = face.uv[vi];
      buf.pos.push(v[0] - 0.5, v[1] - 0.5, v[2] - 0.5);
      buf.uv.push(u0 + u[0] / 3, u[1]);
      buf.n.push(face.n[0], face.n[1], face.n[2]);
    }
  }
  return buildGeometry(buf);
}

/**
 * Keeps the scene meshes in sync with the world.
 * One mesh per (chunk, block type); dirty chunks are rebuilt on demand.
 */
export class WorldRenderer {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.materials = new Map(); // blockId -> MeshLambertMaterial (shared)
    this.chunks = new Map(); // "cx,cz" -> Map<blockId, THREE.Mesh>

    for (let cz = 0; cz < world.chunksPerSide; cz++) {
      for (let cx = 0; cx < world.chunksPerSide; cx++) this.rebuildChunk(cx, cz);
    }
  }

  /** Shared material for a block type (also used by the held-block mesh). */
  materialFor(id) {
    let mat = this.materials.get(id);
    if (!mat) {
      const { texture } = getBlockAssets(getBlockDef(id));
      mat = new THREE.MeshLambertMaterial({ map: texture });
      this.materials.set(id, mat);
    }
    return mat;
  }

  rebuildChunk(cx, cz) {
    const size = this.world.chunkSize;
    const buffers = collectFaces(this.world, {
      x0: cx * size, x1: (cx + 1) * size,
      z0: cz * size, z1: (cz + 1) * size,
    });

    const key = `${cx},${cz}`;
    let meshes = this.chunks.get(key);
    if (!meshes) {
      meshes = new Map();
      this.chunks.set(key, meshes);
    }

    // Update / create a mesh per block type present in the chunk.
    for (const [id, buf] of buffers) {
      const geo = buildGeometry(buf);
      const existing = meshes.get(id);
      if (existing) {
        existing.geometry.dispose();
        existing.geometry = geo;
        existing.visible = true;
      } else {
        const mesh = new THREE.Mesh(geo, this.materialFor(id));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        meshes.set(id, mesh);
        this.scene.add(mesh);
      }
    }
    // Block types that vanished from the chunk: empty their geometry.
    for (const [id, mesh] of meshes) {
      if (!buffers.has(id)) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.BufferGeometry();
        mesh.visible = false;
      }
    }
  }

  /** Re-mesh every chunk the world flagged since the last call. */
  flushDirty() {
    for (const [cx, cz] of this.world.consumeDirtyChunks()) this.rebuildChunk(cx, cz);
  }
}
