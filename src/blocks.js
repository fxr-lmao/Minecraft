import * as THREE from 'three';
import { BLOCK_DEFS, getBlockAssets } from './textures.js';

// One shared BoxGeometry per block type with UVs remapped to the 3-column
// atlas [side | top | bottom]. BoxGeometry emits 6 groups in the order:
// +x, -x, +y, -y, +z, -z.
const geometryCache = new Map();

function atlasGeometry() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uv = geo.attributes.uv;
  const index = geo.index;
  const cols = [0, 0, 1, 2, 0, 0]; // face -> atlas column (side, side, top, bottom, side, side)
  // BoxGeometry is indexed (24 unique vertices, 36 indices in 6 face groups):
  // remap the UVs of each face's vertices to that face's atlas column.
  for (const group of geo.groups) {
    const col = cols[group.materialIndex];
    for (let j = group.start; j < group.start + group.count; j++) {
      const vi = index.getX(j);
      uv.setX(vi, uv.getX(vi) / 3 + col / 3);
    }
  }
  return geo;
}

export function getBlockGeometry() {
  if (!geometryCache.has('block')) {
    const geo = atlasGeometry();
    geo.computeVertexNormals();
    geometryCache.set('block', geo);
  }
  return geometryCache.get('block');
}

export function getBlockDef(id) {
  return BLOCK_DEFS.find((b) => b.id === id) ?? null;
}

/**
 * Build one InstancedMesh per block type for a set of block positions.
 * positions: array of {x, y, z} world coordinates (block centers).
 * Returns a Map<blockId, THREE.InstancedMesh>.
 */
export function buildBlockMeshes(positions) {
  const byType = new Map();
  for (const p of positions) {
    if (!byType.has(p.id)) byType.set(p.id, []);
    byType.get(p.id).push(p);
  }

  const meshes = new Map();
  const geometry = getBlockGeometry();
  const dummy = new THREE.Object3D();

  for (const [id, list] of byType) {
    const def = getBlockDef(id);
    const { texture } = getBlockAssets(def);
    const material = new THREE.MeshLambertMaterial({ map: texture });
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    meshes.set(id, mesh);
  }
  return meshes;
}
