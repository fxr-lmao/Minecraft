// Water you can see moving through the air.
//
// Everything up to now has been the *surface* of water — where it is, what
// shape it is, how light gets through it. None of that says anything about
// what happens when you hit it, and hitting it is most of what a player
// actually does to water. Jumping into a lake produced nothing at all: the
// screen went blue and that was the entire event.
//
// So: droplets. One pooled buffer of them, one draw call, four things that
// make them —
//
//   * a **splash** when you break the surface, sized by how hard you hit it;
//   * **spray** at the foot of anything falling, found by looking for water
//     that has water above it and something solid below;
//   * **bubbles** off a swimmer, which rise, wobble, and pop at the surface;
//   * a **wake**, the small stuff kicked up behind someone swimming along the
//     top of the water.
//
// The particles are ordinary scene geometry on the default layer, which means
// the water passes handle them for free: a droplet above the surface writes
// depth in the refraction pass, so the water behind it is discarded and it
// stays in front; a bubble under the surface does not, so the water composites
// over it and it comes out absorbed and tinted like everything else down
// there. Neither case needed a line of code — it falls out of drawing them
// before the water rather than after it.
//
// Frozen with the game clock, like everything else that moves.

import * as THREE from '../vendor/three.module.min.js';
import { isWater, isOpaque, waterHeight, isWaterSource } from './terrain.js';

/**
 * How many can be alive at once. A splash is ~24 of them and a waterfall
 * throws a handful a second, so a thousand is a lot of water in the air
 * before anything has to be recycled early.
 */
export const MAX_PARTICLES = 1024;

/** Gravity on a droplet, in blocks/s². Lighter than the player: it is spray. */
const DROP_GRAVITY = 22;
/** How fast a bubble rises once the water has hold of it. */
const BUBBLE_RISE = 1.6;
/** Drag on anything travelling through water, per second. */
const WATER_DRAG = 3.4;
/** Drag in air. Small — droplets are mostly ballistic. */
const AIR_DRAG = 0.4;

/** Kinds, which decide how a particle moves rather than how it looks. */
export const DROPLET = 0;
export const BUBBLE = 1;
export const FOAM = 2;

const VERTEX = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;

varying float vAlpha;
varying vec3 vTint;

#ifdef USE_FOG
  varying float vFogDepth;
#endif

void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  #ifdef USE_FOG
    vFogDepth = -mv.z;
  #endif
  // Size in world units rather than pixels, so a droplet is the same size in
  // the world however close you are to it and whatever the resolution is.
  gl_PointSize = size * (300.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
varying float vAlpha;
varying vec3 vTint;

#include <fog_pars_fragment>

void main() {
  // A round sprite with a soft edge, cut out rather than faded to nothing:
  // these write depth so the water knows to stay behind them, and a depth
  // value under a fully transparent pixel is a square hole in the sea.
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float edge = 1.0 - smoothstep(0.10, 0.25, r);
  float a = vAlpha * edge;
  if (a < 0.02) discard;

  gl_FragColor = vec4(vTint, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * A fixed pool of droplets.
 *
 * Every particle lives in flat typed arrays and dead ones are swapped to the
 * end of the live range rather than removed, so spawning and killing are both
 * O(1) and the buffer stays contiguous for the GPU. There is no allocation
 * anywhere after the constructor.
 */
export class Particles {
  constructor(scene, { max = MAX_PARTICLES } = {}) {
    this.max = max;
    this.count = 0;

    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.pz = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.seed = new Float32Array(max);

    // The GPU's copy. Positions are rewritten every frame; size, alpha and
    // tint only when they change, but writing all four is one pass over the
    // live range and simpler than tracking which is dirty.
    this.aPos = new Float32Array(max * 3);
    this.aSize = new Float32Array(max);
    this.aAlpha = new Float32Array(max);
    this.aTint = new Float32Array(max * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.aSize, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.aAlpha, 1));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.aTint, 3));
    geo.setDrawRange(0, 0);
    // Frustum culling would need a bounding sphere kept up to date across a
    // thousand independently moving points; the whole system is one draw call
    // of at most a thousand vertices, so it is cheaper never to cull it.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: true,
      fog: true,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.geometry = geo;
    scene.add(this.points);

    /** Seconds until the next look for waterfalls. */
    this._scanIn = 0;
    /** Seconds until the next bubble off a submerged swimmer. */
    this._bubbleIn = 0;
    this._wakeIn = 0;
  }

  /** Everything gone — used when the world is reset out from under us. */
  clear() {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /**
   * Add one. Silently does nothing when the pool is full, which is the right
   * answer: the pool is full because a great deal is already going on, and
   * one more droplet in the middle of that is not what anyone is looking at.
   */
  spawn(x, y, z, vx, vy, vz, kind, life, size, tint) {
    if (this.count >= this.max) return false;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.kind[i] = kind;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.seed[i] = Math.random() * 6.283;
    this.aSize[i] = size;
    this.aTint[i * 3] = tint[0];
    this.aTint[i * 3 + 1] = tint[1];
    this.aTint[i * 3 + 2] = tint[2];
    return true;
  }

  /** Swap the dead one at `i` with the last live one. */
  _kill(i) {
    const last = --this.count;
    if (i === last) return;
    this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.kind[i] = this.kind[last];
    this.seed[i] = this.seed[last];
    this.aSize[i] = this.aSize[last];
    this.aTint[i * 3] = this.aTint[last * 3];
    this.aTint[i * 3 + 1] = this.aTint[last * 3 + 1];
    this.aTint[i * 3 + 2] = this.aTint[last * 3 + 2];
  }

  // ------------------------------------------------------------- emitters

  /**
   * Breaking the surface. `speed` is how fast you were going down when you
   * hit it, which is the only thing that decides how big a splash is: a
   * belly-flop from a cliff and stepping off a ledge into a pond are the same
   * event with two very different amounts of water in the air.
   */
  splash(x, y, z, speed) {
    const force = Math.min(1, speed / 12);
    const n = Math.round(8 + force * 26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      // Outward and up, with the fastest droplets going most steeply — which
      // is what makes a splash a crown rather than a puff.
      const out = (0.9 + r * 2.6) * (0.4 + force);
      const up = (2.0 + Math.random() * 3.6) * (0.45 + force);
      this.spawn(
        x + Math.cos(a) * r * 0.35, y + 0.02, z + Math.sin(a) * r * 0.35,
        Math.cos(a) * out, up, Math.sin(a) * out,
        DROPLET, 0.5 + Math.random() * 0.5, 0.055 + Math.random() * 0.05,
        SPRAY_TINT
      );
    }
    // A low collar of foam around the point of entry, which is the part that
    // reads as *water* rather than as a firework.
    const ring = Math.round(4 + force * 10);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + Math.random() * 0.4;
      const out = 1.4 + Math.random() * 1.2 * (0.5 + force);
      this.spawn(
        x + Math.cos(a) * 0.3, y + 0.03, z + Math.sin(a) * 0.3,
        Math.cos(a) * out, 0.5 + Math.random() * 0.9, Math.sin(a) * out,
        FOAM, 0.45 + Math.random() * 0.35, 0.09 + Math.random() * 0.07,
        FOAM_TINT
      );
    }
  }

  /** One bubble, off a swimmer or out of the sea floor. */
  bubble(x, y, z) {
    this.spawn(
      x, y, z,
      (Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3,
      BUBBLE, 1.6 + Math.random() * 1.6, 0.03 + Math.random() * 0.045,
      BUBBLE_TINT
    );
  }

  /** Spray thrown back up where falling water lands on something. */
  spray(x, y, z) {
    const a = Math.random() * Math.PI * 2;
    const out = Math.random() * 1.5;
    this.spawn(
      x + (Math.random() - 0.5) * 0.7, y + 0.1, z + (Math.random() - 0.5) * 0.7,
      Math.cos(a) * out, 1.4 + Math.random() * 2.4, Math.sin(a) * out,
      Math.random() < 0.55 ? FOAM : DROPLET,
      0.5 + Math.random() * 0.6, 0.05 + Math.random() * 0.06,
      Math.random() < 0.55 ? FOAM_TINT : SPRAY_TINT
    );
  }

  // -------------------------------------------------------------- driving

  /**
   * Move everything on, and decide what dies.
   *
   * `world` is needed because a droplet has to know when it has hit
   * something: landing in water ends it in a plop, landing on rock ends it
   * outright, and a bubble ends at the surface. Without that they sail
   * through the sea floor and hang in the air inside the cliff behind it.
   */
  update(dt, world) {
    if (dt <= 0) {
      this._upload();
      return;
    }
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); i--; continue; }

      const x = this.px[i];
      const y = this.py[i];
      const z = this.pz[i];
      const cell = world.get(Math.floor(x), Math.floor(y), Math.floor(z));
      const wet = isWater(cell) && y <= Math.floor(y)
        + waterHeight(cell, world.isWaterAt(Math.floor(x), Math.floor(y) + 1, Math.floor(z)));

      const kind = this.kind[i];
      if (kind === BUBBLE) {
        // A bubble out of water is not a bubble any more.
        if (!wet) { this._kill(i); i--; continue; }
        const wobble = Math.sin(this.seed[i] + this.life[i] * 6.0) * 0.35;
        this.vx[i] += wobble * dt;
        this.vz[i] += Math.cos(this.seed[i] * 1.7 + this.life[i] * 5.0) * 0.35 * dt;
        this.vy[i] += (BUBBLE_RISE - this.vy[i]) * Math.min(1, dt * 4);
      } else {
        this.vy[i] -= DROP_GRAVITY * dt;
        const drag = wet ? WATER_DRAG : AIR_DRAG;
        const f = Math.exp(-drag * dt);
        this.vx[i] *= f;
        this.vz[i] *= f;
        if (wet) {
          // Hitting water kills a droplet: it has joined the water. Foam
          // lingers on the surface a moment longer, which is what a splash
          // leaves behind.
          if (this.vy[i] < 0) {
            if (kind === FOAM && this.life[i] > 0.12) this.life[i] = 0.12;
            else { this._kill(i); i--; continue; }
          }
          this.vy[i] *= f;
        }
      }

      const nx = x + this.vx[i] * dt;
      const ny = y + this.vy[i] * dt;
      const nz = z + this.vz[i] * dt;
      if (isOpaque(world.get(Math.floor(nx), Math.floor(ny), Math.floor(nz)))) {
        this._kill(i);
        i--;
        continue;
      }
      this.px[i] = nx;
      this.py[i] = ny;
      this.pz[i] = nz;
    }
    this._upload();
  }

  /**
   * Look around the player for water falling onto something and throw spray
   * off the bottom of it.
   *
   * Deliberately a scan rather than a signal from the flow simulation. The
   * simulation only runs where water is *changing*, and a waterfall that has
   * settled has stopped changing — it is still falling, it just is not news
   * any more. The scan is small, capped, and four times a second.
   */
  scanFalls(dt, world, cx, cy, cz, radius = 7) {
    this._scanIn -= dt;
    if (this._scanIn > 0) return 0;
    this._scanIn = 0.25;
    let made = 0;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const z0 = Math.floor(cz);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dy = -4; dy <= 5; dy++) {
          const x = x0 + dx;
          const y = y0 + dy;
          const z = z0 + dz;
          const here = world.get(x, y, z);
          if (!isWater(here) || isWaterSource(here)) continue;
          // Falling water is flowing water with water above it. Where the
          // block below is not water any more, it has arrived.
          if (!world.isWaterAt(x, y + 1, z)) continue;
          const below = world.get(x, y - 1, z);
          if (isWater(below)) continue;
          if (!isOpaque(below)) continue;
          if (Math.random() > 0.5) continue; // thin it out; a fall is not a firehose
          this.spray(x + 0.5, y, z + 0.5);
          made++;
          if (made >= 12) return made;
        }
      }
    }
    return made;
  }

  /**
   * The trail a player leaves in the water: bubbles when they are under it,
   * and a scatter of foam when they are swimming along the top of it.
   */
  followPlayer(dt, player) {
    if (!player.inWater) {
      this._bubbleIn = 0;
      this._wakeIn = 0;
      return;
    }
    const { x, y, z } = player.pos;
    if (player.submerged) {
      this._bubbleIn -= dt;
      if (this._bubbleIn <= 0) {
        // Faster when you are working, which is when you would be breathing.
        this._bubbleIn = player.swimming ? 0.10 : 0.35;
        this.bubble(
          x + (Math.random() - 0.5) * 0.4,
          y + player.eyeHeight * (0.6 + Math.random() * 0.4),
          z + (Math.random() - 0.5) * 0.4
        );
      }
      return;
    }
    if (player.horizontalSpeed < 0.8) return;
    this._wakeIn -= dt;
    if (this._wakeIn > 0) return;
    this._wakeIn = 0.06;
    const top = player.waterTop === -Infinity ? y : player.waterTop;
    const back = Math.atan2(-player.vel.z, -player.vel.x);
    const a = back + (Math.random() - 0.5) * 1.1;
    this.spawn(
      x + Math.cos(a) * 0.35, top + 0.02, z + Math.sin(a) * 0.35,
      Math.cos(a) * 0.8, 0.7 + Math.random() * 0.8, Math.sin(a) * 0.8,
      FOAM, 0.3 + Math.random() * 0.3, 0.06 + Math.random() * 0.06,
      FOAM_TINT
    );
  }

  /** Copy the live range up to the GPU and tell three how much of it to draw. */
  _upload() {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      this.aPos[i * 3] = this.px[i];
      this.aPos[i * 3 + 1] = this.py[i];
      this.aPos[i * 3 + 2] = this.pz[i];
      // Fade out over the last third of a life, so nothing ever blinks out.
      const t = this.life[i] / this.maxLife[i];
      this.aAlpha[i] = Math.min(1, t * 3) * (this.kind[i] === BUBBLE ? 0.55 : 0.85);
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
    this.geometry.attributes.tint.needsUpdate = true;
  }
}

/** Spray is water seen thin: paler and greener than the body of it. */
const SPRAY_TINT = [0.62, 0.86, 0.94];
/** Foam is broken water, which is white with the sky in it. */
const FOAM_TINT = [0.90, 0.96, 1.0];
/** A bubble is mostly the light behind it. */
const BUBBLE_TINT = [0.78, 0.92, 1.0];

export { SPRAY_TINT, FOAM_TINT, BUBBLE_TINT };
