// Drawing the mobs.
//
// One THREE group per mob, built by the model factories and kept in step
// with the simulation by uid. That is the whole of it, and the reason it is
// this small: mobs.js owns everything worth knowing and this file only
// believes it.
//
// Sixteen mobs of eight-ish parts is a hundred-odd draw calls — the price
// the population cap in mobs.js was set to keep affordable — and spawn and
// death are rare enough (a mob a second at the very most, on a full night)
// that building and tearing down a model per event costs nothing.

import * as THREE from '../vendor/three.module.min.js';
import { createMobModel } from './mob-models.js';

export class MobsRenderer {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** uid -> { kind, group, update } */
    this.models = new Map();
    /** uids seen last frame, so removal is a set difference and not a scan. */
    this._seen = new Set();
  }

  /**
   * Bring the drawn population in line with the simulated one, and animate
   * everything that is staying.
   *
   * `dt` is the *animation* clock — zero while paused — because a paused
   * world is completely still, mobs very much included.
   */
  update(mobs) {
    this._seen.clear();
    for (const mob of mobs.list) {
      this._seen.add(mob.uid);
      let entry = this.models.get(mob.uid);
      if (!entry) {
        const model = createMobModel(mob.kind);
        this.scene.add(model.group);
        entry = model;
        this.models.set(mob.uid, entry);
      }
      entry.update({
        x: mob.x,
        y: mob.y,
        z: mob.z,
        yaw: mob.yaw,
        headYaw: mob.headYaw,
        headPitch: mob.headPitch,
        walkPhase: mob.walkPhase,
        hurtFlash: mob.hurtFlash,
        burning: mob.burning,
        fuse: mob.kind === entry.kind ? mob.fuse : 0,
        dying: mob.dying,
      });
    }
    // Anything simulated no longer exists here either. Materials are
    // per-mob (that is how one zombie can flash without all of them
    // flashing), so they are the part that must be disposed; the geometry
    // and textures are shared and outlive the individual.
    for (const [uid, entry] of this.models) {
      if (this._seen.has(uid)) continue;
      this.scene.remove(entry.group);
      entry.group.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      });
      this.models.delete(uid);
    }
  }

  /** Everyone out. A world reset must not leave ghosts in the scene. */
  clear() {
    for (const [, entry] of this.models) {
      this.scene.remove(entry.group);
      entry.group.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      });
    }
    this.models.clear();
  }
}
