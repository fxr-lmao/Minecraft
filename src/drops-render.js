// Drawing the dropped items.
//
// The whole population of drops is one THREE object per *distinct id* on the
// floor, not one per item: an InstancedMesh, so thirty stacks of cobblestone
// left by a wall you mined are one draw call with thirty matrices in it. A
// TNT crater can leave three hundred drops, and three hundred meshes is three
// hundred draw calls of eight triangles each, which is the single most
// wasteful thing a renderer can be asked to do.
//
// Instances are only re-sorted when the *set* of ids on the floor changes.
// Their matrices are rewritten every frame, which is one 4x4 compose per
// drop — a few hundred, and nothing next to a frame of voxels.
//
// The geometry is the same geometry the hand uses. A dropped pickaxe is the
// pickaxe you were holding, at the same scale relative to a block, which is
// the thing that makes the world feel like it is made of one set of objects
// rather than of icons and models that happen to share a name.

import * as THREE from '../vendor/three.module.min.js';
import { Drops } from './drops.js';
import { itemGeometry, createItemMaterial } from './held-item.js';
import { isItem } from './items.js';

/** How big a dropped item is, relative to its model. Minecraft's is 0.25. */
export const DROP_SCALE = 0.32;
/** ...and a block, which is a full cube and needs to be smaller. */
export const DROP_BLOCK_SCALE = 0.26;

/**
 * How many instances a pool starts with, and how much it grows by.
 *
 * An InstancedMesh's count is fixed at construction, so a pool that runs out
 * has to be rebuilt. Growing in powers of two means that happens a handful of
 * times in the worst session and never in a normal one.
 */
const POOL_START = 16;

export class DropsRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {(id: number) => THREE.BufferGeometry|null} blockGeometryFor
   *   The caller's unit-cube builder, so a dropped block is exactly the cube
   *   the hand and the world already agree on.
   * @param {THREE.Material} blockMaterial the world atlas material
   */
  constructor(scene, blockGeometryFor, blockMaterial) {
    this.scene = scene;
    this.blockGeometryFor = blockGeometryFor;
    this.blockMaterial = blockMaterial;
    this.itemMaterial = createItemMaterial();
    /** id -> { mesh, capacity } */
    this.pools = new Map();
    /** Scratch, so the per-frame update allocates nothing. */
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 1, 0);
    /** Reused per frame: id -> array of drops. */
    this._buckets = new Map();
    this.visible = true;
  }

  /** Everything gone — used when the world is reset out from under us. */
  clear() {
    for (const pool of this.pools.values()) {
      this.scene.remove(pool.mesh);
      pool.mesh.dispose();
    }
    this.pools.clear();
  }

  setVisible(v) {
    this.visible = v;
    for (const pool of this.pools.values()) pool.mesh.visible = v;
  }

  /** The pool for an id, made or grown as needed. */
  _pool(id, needed) {
    let pool = this.pools.get(id);
    const capacity = Math.max(POOL_START, 1 << Math.ceil(Math.log2(Math.max(1, needed))));
    if (pool && pool.capacity >= needed) return pool;

    if (pool) {
      this.scene.remove(pool.mesh);
      pool.mesh.dispose();
    }

    const item = isItem(id);
    const geometry = item ? itemGeometry(id) : this.blockGeometryFor(id);
    if (!geometry) return null;
    const material = item ? this.itemMaterial : this.blockMaterial;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The population moves every frame and is scattered across the world, so
    // a bounding sphere would have to be recomputed constantly to be worth
    // anything. One draw call of a few hundred instances is cheaper than
    // keeping it honest.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.count = 0;
    mesh.visible = this.visible;
    this.scene.add(mesh);
    pool = { mesh, capacity };
    this.pools.set(id, pool);
    return pool;
  }

  /**
   * Rebuild the instance matrices from the current population.
   *
   * `clock` is game time, so a paused game freezes the spin along with
   * everything else — which is the rule the whole game is built on and the
   * one thing an animation added late always forgets.
   */
  update(drops, clock) {
    const buckets = this._buckets;
    for (const list of buckets.values()) list.length = 0;

    for (const d of drops.items) {
      let list = buckets.get(d.id);
      if (!list) {
        list = [];
        buckets.set(d.id, list);
      }
      list.push(d);
    }

    for (const [id, list] of buckets) {
      const pool = list.length ? this._pool(id, list.length) : this.pools.get(id);
      if (!pool) continue;
      const item = isItem(id);
      const scale = item ? DROP_SCALE : DROP_BLOCK_SCALE;
      let n = 0;
      for (const d of list) {
        const { lift, spin } = Drops.bob(d, clock);
        this._p.set(d.x, d.y + lift + scale * 0.5, d.z);
        this._q.setFromAxisAngle(this._axis, spin);
        this._s.setScalar(scale);
        this._m.compose(this._p, this._q, this._s);
        pool.mesh.setMatrixAt(n++, this._m);
      }
      pool.mesh.count = n;
      if (n > 0) pool.mesh.instanceMatrix.needsUpdate = true;
      pool.mesh.visible = this.visible && n > 0;
    }

    // An id that has left the floor entirely keeps its (empty) pool, because
    // the same block is very likely to be dropped again in a moment and
    // rebuilding an InstancedMesh is the expensive part. It costs one hidden
    // object per block type ever dropped, which is bounded by the number of
    // block types.
    for (const [id, pool] of this.pools) {
      if (!buckets.has(id) || buckets.get(id).length === 0) {
        pool.mesh.count = 0;
        pool.mesh.visible = false;
      }
    }
  }

  /** For the debug screen: how many draw calls the drops are costing. */
  get drawCalls() {
    let n = 0;
    for (const pool of this.pools.values()) if (pool.mesh.visible) n++;
    return n;
  }
}
