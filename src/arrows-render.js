// Drawing the arrows.
//
// An arrow is three little boxes — a grey head, a pale shaft and a red
// fletching — grouped so the whole thing can be aimed along its velocity in
// one quaternion write per frame. One shared set of geometries and materials
// for every arrow, because a skeleton volley is several dozen of these and
// each one is three draw calls even before you think about textures.
//
// Like mobs-render.js, this file only believes the simulation: arrows.js owns
// where they are and whether they still exist, and this keeps the drawn
// population in step with it by id.

import * as THREE from '../vendor/three.module.min.js';

const SHAFT_LEN = 0.55;
const HEAD_LEN = 0.1;
const FLETCH_LEN = 0.12;

let geo = null;
let headGeo = null;
let fletchGeo = null;
let shaftMat = null;
let headMat = null;
let fletchMat = null;

function buildShared() {
  if (geo) return;
  geo = new THREE.BoxGeometry(0.025, 0.025, SHAFT_LEN);
  headGeo = new THREE.BoxGeometry(0.04, 0.04, HEAD_LEN);
  fletchGeo = new THREE.BoxGeometry(0.09, 0.015, FLETCH_LEN);
  shaftMat = new THREE.MeshLambertMaterial({ color: 0x8a7a5a, emissive: 0x2a2a2a });
  headMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6, emissive: 0x2e3236 });
  fletchMat = new THREE.MeshLambertMaterial({ color: 0xc02828, emissive: 0x2a0808 });
}

export class ArrowsRenderer {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** arrow id -> THREE.Group */
    this.models = new Map();
    this._seen = new Set();
  }

  /**
   * Bring the drawn arrows in line with the simulated ones and aim each
   * along its velocity. Arrows that have ended are removed here; the
   * geometries and materials are shared and outlive every individual.
   */
  update(arrows) {
    buildShared();
    this._seen.clear();
    for (const a of arrows.list) {
      this._seen.add(a.id);
      let group = this.models.get(a.id);
      if (!group) {
        group = new THREE.Group();
        const shaft = new THREE.Mesh(geo, shaftMat);
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.z = -(SHAFT_LEN + HEAD_LEN) / 2;
        const fletch = new THREE.Mesh(fletchGeo, fletchMat);
        fletch.position.z = (SHAFT_LEN - FLETCH_LEN) / 2;
        group.add(shaft, head, fletch);
        this.scene.add(group);
        this.models.set(a.id, group);
      }
      group.position.set(a.x, a.y, a.z);
      const len = Math.hypot(a.vx, a.vy, a.vz);
      if (len > 1e-4) {
        group.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(a.vx / len, a.vy / len, a.vz / len)
        );
      }
    }
    for (const [id, group] of this.models) {
      if (this._seen.has(id)) continue;
      this.scene.remove(group);
      this.models.delete(id);
    }
  }

  clear() {
    for (const [, group] of this.models) this.scene.remove(group);
    this.models.clear();
  }
}
