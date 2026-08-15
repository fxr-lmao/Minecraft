// The passes that make water possible.
//
// A single-pass translucent surface can only ever guess. It does not know what
// is behind it, so it cannot absorb light through the water — it can only fade
// toward a colour with an alpha somebody picked. It does not know how far away
// the sea floor is, so it cannot tell a foot of water over sand from six
// blocks of it, and it cannot find the waterline, which is why the shore came
// out as a hard line with no foam on it. It does not know what is above it, so
// the only thing it can reflect is a gradient.
//
// That was the shape of the last version and it is why shallow water read as
// wet sand: it was 46% opaque over a bright beach, so what you mostly saw was
// the beach. Turning the alpha up would have hidden the sea floor instead,
// which is worse. Both are wrong for the same reason — the surface was
// guessing at a quantity it could have measured.
//
// So it measures them. Three passes:
//
//   1. **Refraction.** Render everything except the water into an off-screen
//      target with a *depth texture* attached. Now the water shader can sample
//      the colour behind any of its pixels, and — from the depth — how far
//      through the water that light travelled. That one number gives
//      Beer-Lambert absorption (real colour by depth), the soft shoreline
//      (thickness → 0 at the water's edge), and caustics that land on
//      whatever is actually behind the water and can never leak onto dry land.
//
//   2. **Reflection.** Render the world again from a camera mirrored through
//      the water plane, at a fraction of the resolution. This is the pass that
//      puts the trees and the cliffs in the water instead of a flat gradient.
//      It is also the expensive one, so it is the one the quality setting
//      turns off first.
//
//   3. **Composite.** Blit the refraction target to the screen — through the
//      underwater grade, when the camera is submerged — and then draw the
//      water surface on top of it. The water is the only thing rendered in
//      this pass, and it depth-tests itself against the depth texture from
//      pass 1, which is exact.
//
// The whole thing is skipped when there is no water on screen, and skipped
// entirely at the lowest quality setting, where the surface falls back to
// shading itself from a procedural sky the way it used to.

import * as THREE from '../vendor/three.module.min.js';
import { createUnderwaterMaterial } from './underwater.js';
import { waterUniforms } from './water-shader.js';

/** Everything off: one pass, sky-only reflection, no depth, no refraction. */
export const WATER_FAST = 0;
/** Refraction, absorption, depth foam and caustics. Two passes. */
export const WATER_FANCY = 1;
/** ...and the world reflected in the surface. Three passes. */
export const WATER_ULTRA = 2;
export const WATER_QUALITY_NAMES = ['Fast', 'Fancy', 'Reflections'];

/**
 * The water surface lives on its own layer so a pass can include or exclude
 * every water mesh at once without walking the scene graph.
 */
export const WATER_LAYER = 1;

/**
 * How much smaller the reflection is rendered. A reflection is scattered by
 * the wave normal before you ever see it, so half the linear resolution — a
 * quarter of the pixels — is genuinely free of visible cost, and it is the
 * difference between reflections being affordable and not.
 */
const REFLECT_SCALE = 0.5;

/**
 * The refraction target is rendered at full resolution because it is also the
 * image you see: the composite blits it to the screen rather than drawing the
 * world twice. Only the water surface is drawn again on top.
 */
const REFRACT_SCALE = 1;

/**
 * Manages the render targets and drives the passes.
 *
 * It owns no state about the world beyond the height of the plane to mirror
 * through, which the caller updates as the player moves between bodies of
 * water at different heights.
 */
export class WaterView {
  constructor(renderer, { quality = WATER_ULTRA } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.enabled = true;

    /** The plane the reflection is mirrored through, in world y. */
    this.planeY = 0;
    /** True while the camera is below the surface. */
    this.underwater = false;

    this.width = 1;
    this.height = 1;
    /**
     * How long the whole thing took last frame, smoothed. Reported on the
     * debug screen, because "is the water what is costing me frames?" is the
     * first question anyone asks after turning the setting up, and the answer
     * should not require a profiler.
     */
    this.frameMs = 0;

    this.refract = null;
    this.reflect = null;

    // The composite: a single triangle covering the screen. A triangle rather
    // than a quad because the diagonal seam of a two-triangle quad costs a
    // little fill and buys nothing.
    this.compositeScene = new THREE.Scene();
    this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.compositeMaterial = createUnderwaterMaterial();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute(
      [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3
    ));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri, this.compositeMaterial);
    quad.frustumCulled = false;
    this.compositeScene.add(quad);

    // The mirrored camera. Its projection is copied from the real one every
    // frame; only where it sits and where it points differ.
    this.mirrorCamera = new THREE.PerspectiveCamera();
    this.mirrorCamera.layers.set(0);
    /** Everything below the water is clipped away, or the reflection shows
     *  the underside of the sea floor folded up over the sky. */
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._scratch = {
      target: new THREE.Vector3(),
      up: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      texMatrix: new THREE.Matrix4(),
    };
  }

  /** Free the targets — called when the quality setting turns them off. */
  dispose() {
    this.refract?.dispose();
    this.reflect?.dispose();
    this.refract = null;
    this.reflect = null;
  }

  setQuality(quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    if (quality === WATER_FAST) this.dispose();
    this._applyDefines();
  }

  /** Which passes the current quality wants. */
  get wantsRefraction() {
    return this.enabled && this.quality >= WATER_FANCY;
  }

  get wantsReflection() {
    return this.enabled && this.quality >= WATER_ULTRA;
  }

  _applyDefines() {
    const refract = this.wantsRefraction ? 1 : 0;
    const reflect = this.wantsReflection ? 1 : 0;
    for (const material of this.materials ?? []) {
      if (material.defines.USE_REFRACTION === refract
        && material.defines.USE_REFLECTION === reflect) continue;
      material.defines.USE_REFRACTION = refract;
      material.defines.USE_REFLECTION = reflect;
      material.needsUpdate = true;
    }
  }

  /**
   * Hand over the water materials so their uniforms and compile-time flags can
   * be kept in step with the passes.
   */
  useMaterials(materials) {
    this.materials = materials;
    for (const m of materials) {
      m.defines = m.defines ?? {};
      m.defines.USE_REFRACTION = 0;
      m.defines.USE_REFLECTION = 0;
    }
    this._applyDefines();
  }

  /** (Re)allocate the targets for the current drawing buffer size. */
  _resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x * REFRACT_SCALE));
    const h = Math.max(1, Math.floor(size.y * REFRACT_SCALE));
    if (this.refract && this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;

    this.refract?.dispose();
    // The depth texture is the whole point of this target. Nearest filtering
    // on it is not a preference: a filtered depth sample between a near and a
    // far surface is a depth that is on neither of them, and the thickness
    // computed from it would haloes every silhouette.
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.refract = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthTexture: depth,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // Written through the same tone mapping and colour space as the canvas
    // would be, so the composite is a straight copy and the water can mix with
    // it without either of them being converted twice.
    this.refract.texture.colorSpace = THREE.SRGBColorSpace;
    this.refract.texture.generateMipmaps = false;

    const rw = Math.max(1, Math.floor(size.x * REFLECT_SCALE));
    const rh = Math.max(1, Math.floor(size.y * REFLECT_SCALE));
    this.reflect?.dispose();
    this.reflect = new THREE.WebGLRenderTarget(rw, rh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.reflect.texture.colorSpace = THREE.SRGBColorSpace;
    this.reflect.texture.generateMipmaps = false;
  }

  /**
   * Point the mirrored camera. For a horizontal plane this is short: put the
   * camera the same distance the other side of it, flip the vertical component
   * of where it is looking, and flip its up vector too.
   *
   * Flipping `up` as well as the target is what keeps the transform a
   * rotation rather than a mirror. A true mirror matrix has a negative
   * determinant, which reverses triangle winding, and every front face in the
   * world would be culled as a back one.
   */
  _aimMirror(camera) {
    const { target, up, forward } = this._scratch;
    const mirror = this.mirrorCamera;

    mirror.projectionMatrix.copy(camera.projectionMatrix);
    mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.fov = camera.fov;
    mirror.aspect = camera.aspect;

    const h = this.planeY;
    mirror.position.set(camera.position.x, 2 * h - camera.position.y, camera.position.z);

    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    target.copy(camera.position).add(forward);
    target.y = 2 * h - target.y;

    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    mirror.up.set(up.x, -up.y, up.z);
    mirror.lookAt(target);
    mirror.updateMatrixWorld(true);

    // Clip everything under the surface. Without it a reflection contains the
    // sea floor, folded up above the horizon, which is the single most
    // recognisable way for planar reflections to look wrong.
    this.clipPlane.set(new THREE.Vector3(0, 1, 0), -h + 0.02);
  }

  /**
   * The matrix that turns a world position into a lookup in the reflection
   * texture: the mirrored camera's view-projection, with the clip-space
   * [-1, 1] remapped to a texture's [0, 1].
   */
  _reflectionMatrix() {
    const m = this._scratch.texMatrix;
    m.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    m.multiply(this.mirrorCamera.projectionMatrix);
    m.multiply(this.mirrorCamera.matrixWorldInverse);
    return m;
  }

  /**
   * Render one frame.
   *
   * `hasWater` lets the caller say there is none in view, in which case this
   * is exactly a plain render and costs exactly what a plain render costs.
   */
  render(scene, camera, hasWater = true) {
    const started = performance.now();
    this._render(scene, camera, hasWater);
    this.frameMs += (performance.now() - started - this.frameMs) * 0.06;
  }

  _render(scene, camera, hasWater) {
    const renderer = this.renderer;

    if (!this.wantsRefraction || !hasWater) {
      // One pass. The surface shades itself from the procedural sky, which is
      // what it did before any of this existed.
      camera.layers.enableAll();
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    this._resize();
    this._syncUniforms(camera);

    // ---- pass 1: everything except the water, plus its depth ----
    // The only pass that builds a shadow map. Left to itself three would
    // rebuild it for each of the three renders, which is three times the
    // shadow cost for one frame's worth of shadows.
    renderer.shadowMap.autoUpdate = true;
    camera.layers.disable(WATER_LAYER);
    camera.layers.disable(HELD_LAYER);
    renderer.setRenderTarget(this.refract);
    renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = false;

    // ---- pass 2: the world, mirrored ----
    if (this.wantsReflection && !this.underwater) {
      this._aimMirror(camera);
      const previousClipping = renderer.clippingPlanes;
      renderer.clippingPlanes = [this.clipPlane];
      renderer.setRenderTarget(this.reflect);
      renderer.render(scene, this.mirrorCamera);
      renderer.clippingPlanes = previousClipping;
      this._setReflectionUniforms(true);
    } else {
      this._setReflectionUniforms(false);
    }

    // ---- pass 3: composite, then the surface on top of it ----
    // The composite has already painted the frame, so the water render must
    // not clear it again — and it does not need the depth buffer either,
    // because it tests itself against the depth texture from pass 1.
    renderer.setRenderTarget(null);
    this.compositeMaterial.uniforms.uScene.value = this.refract.texture;
    this.compositeMaterial.uniforms.uDepth.value = this.refract.depthTexture;
    renderer.render(this.compositeScene, this.compositeCamera);

    renderer.autoClear = false;
    camera.layers.set(WATER_LAYER);
    renderer.render(scene, camera);

    // ...and the block in your hand last of all. It is a hand, not a thing in
    // the world: standing in the shallows puts water fragments a few
    // centimetres from the lens and half a metre in front of it, which is
    // nearer than the block, so any pass that treats it as scenery has the
    // sea draw over the top of your own arm.
    camera.layers.set(HELD_LAYER);
    renderer.render(scene, camera);

    renderer.autoClear = true;
    camera.layers.enableAll();
  }

  /** Feed the shared uniforms everything that changed this frame. */
  _syncUniforms(camera) {
    const u = waterUniforms;
    u.uSceneColor.value = this.refract.texture;
    u.uSceneDepth.value = this.refract.depthTexture;
    u.uResolution.value.set(this.width, this.height);
    u.uCameraNear.value = camera.near;
    u.uCameraFar.value = camera.far;
    u.uUnder.value = this.underwater ? 1 : 0;

    const c = this.compositeMaterial.uniforms;
    c.uResolution.value.set(this.width, this.height);
    c.uCameraNear.value = camera.near;
    c.uCameraFar.value = camera.far;
    c.uUnder.value = this.underwater ? 1 : 0;
    c.uTime.value = u.uTime.value;
    c.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    c.uCameraMatrix.value.copy(camera.matrixWorld);
    c.uCameraPos.value.copy(camera.position);
    c.uSurfaceY.value = this.planeY;
    c.uSunDir.value.copy(u.uSunDir.value);
  }

  _setReflectionUniforms(on) {
    const u = waterUniforms;
    u.uReflection.value = on ? this.reflect.texture : null;
    u.uReflectionStrength.value = on ? 1 : 0;
    if (on) u.uReflectionMatrix.value.copy(this._reflectionMatrix());
  }
}

/**
 * The first-person held block lives here rather than on the default layer:
 * it is parented to the camera, so a mirrored camera rendering the same scene
 * would find it hanging in mid-air and put it in the reflection.
 */
export const HELD_LAYER = 2;
