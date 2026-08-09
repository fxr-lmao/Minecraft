// Voxel mesher with hidden-face culling.
//
// Only faces exposed to air are emitted, so the flat 128x128x4 world drops
// from ~393k faces (6 per block) to ~18k faces. Merged into one
// BufferGeometry per block type = 3 draw calls total.
//
// Face table: each entry is a quad with its outward normal, atlas column
// (0 = side, 1 = top, 2 = bottom), 4 corners wound CCW when viewed from
// outside, and UVs within that column.

import * as THREE from 'three';
import { BLOCK_DEFS, getBlockAssets } from './textures.js';

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

export function getBlockDef(id) {
  return BLOCK_DEFS.find((b) => b.id === id) ?? null;
}

/**
 * Pure face collection (no DOM/THREE) — unit-testable in Node.
 * Returns Map<blockId, { pos: number[], uv: number[], n: number[] }>
 * with 6 vertices per quad.
 */
export function collectFaces(world) {
  const buffers = new Map();
  const { size, layers } = world;
  for (let y = 0; y < layers; y++) {
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
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

/**
 * Build one Mesh per block type from the collected faces.
 * Returns Map<blockId, THREE.Mesh>.
 */
export function buildWorldMeshes(world) {
  const meshes = new Map();
  for (const [id, buf] of collectFaces(world)) {
    const def = getBlockDef(id);
    const { texture } = getBlockAssets(def);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.n, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: texture }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.set(id, mesh);
  }
  return meshes;
}
