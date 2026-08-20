// The THREE side of the held item: geometry cache, materials, and the two
// rigs that hold things — the first-person one in front of the camera and the
// avatar's fist.
//
// held-geometry.js and item-models.js are pure: arrays and numbers, testable
// in Node. This file is the only part that knows what a Mesh is, and it is
// deliberately thin — it caches, it poses, and it animates. Every decision
// about what a thing *is* was made before it got here.
//
// The one thing worth explaining is the material split. A block in the hand
// samples the world atlas, because that is where its faces live and because
// sharing the atlas means the hand costs no extra texture. An item does not:
// its colour is baked into the vertices by the extruder, so it needs no
// texture at all, and a vertex-coloured Lambert material is both cheaper and
// better looking than a textured one — there is no filtering to get wrong at
// the edge of a texel and no alpha cut-out to leave black fringes on.

import * as THREE from '../vendor/three.module.min.js';
import {
  buildExtrudedSprite, buildBucketModel, meshBounds,
} from './held-geometry.js';
import {
  modelSpec, poseKind, firstPersonPose, thirdPersonPose,
  GRIP_HEIGHT, MODELLED_ITEMS, POSE_KIND_TOOL, POSE_KIND_BUCKET,
} from './item-models.js';
import { isItem, itemShape } from './items.js';

/**
 * Geometry cache, keyed by item id. An item's model never changes, and the
 * biggest of them is a few hundred triangles, so they are built once on
 * demand and kept for the session.
 */
const geometryCache = new Map();
/** The bounds of each cached geometry, for the grip maths. */
const boundsCache = new Map();

/** Turn the pure mesh data into a BufferGeometry. */
function toGeometry(mesh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(mesh.colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The 3D geometry for an item id, or null if it has none (a block, which is
 * a cube and is built elsewhere).
 */
export function itemGeometry(id) {
  if (geometryCache.has(id)) return geometryCache.get(id);
  const spec = modelSpec(id);
  if (!spec) {
    geometryCache.set(id, null);
    return null;
  }
  const mesh = spec.kind === 'bucket'
    ? buildBucketModel(spec.full)
    : buildExtrudedSprite(spec.rows, spec.palette, spec);
  const geo = toGeometry(mesh);
  geometryCache.set(id, geo);
  boundsCache.set(id, meshBounds(mesh));
  return geo;
}

/** The model bounds for an item id, or null. */
export function itemBounds(id) {
  if (!boundsCache.has(id)) itemGeometry(id);
  return boundsCache.get(id) ?? null;
}

/**
 * Build every model up front.
 *
 * A few hundred triangles is nothing, but building fourteen of them the first
 * time you scroll along a full hotbar is fourteen hitches in a row, each one
 * exactly where the player is looking. Doing it during the loading screen
 * costs about a millisecond in total and nobody ever sees it.
 */
export function warmItemModels() {
  let built = 0;
  for (const id of MODELLED_ITEMS) {
    if (itemGeometry(id)) built++;
  }
  return built;
}

/**
 * Materials for the item models.
 *
 * Two of them, and the difference is the same one the world makes between a
 * thing in the scene and a thing in your hand: the avatar's copy fades out
 * when the third-person camera comes close, and the first-person copy must
 * not fade with it.
 *
 * Both are Lambert with vertex colours and an emissive floor. The floor is
 * the same trick the avatar uses: ACES tone mapping crushes an unlit face to
 * black, and a tool held with the sun behind you is otherwise a silhouette.
 */
export function createItemMaterial() {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: 0x4a4a4a,
    // The emissive term has no map, so it lifts every face by the same
    // amount — which is what we want, because the *shape* is already in the
    // vertex colours (see FACE_SHADE) and does not need the light to describe
    // it a second time.
  });
}

/**
 * Apply a pose from item-models.js to an object.
 * Kept here rather than inline so the two rigs cannot drift apart.
 */
export function applyPose(object, pose, extraScale = 1) {
  object.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  object.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
  object.scale.setScalar(pose.scale * extraScale);
}

/**
 * How far a tool has to slide along its own length so the fist lands on the
 * grip rather than on the middle of the haft.
 *
 * The model is centred on the origin and GRIP_HEIGHT says where the hand goes
 * as a fraction from the bottom, so the offset is the distance from the
 * centre to that point, negated: shift the model *up* by however far the grip
 * is *below* centre.
 */
export function gripOffset(id) {
  const shape = itemShape(id);
  if (!shape) return 0;
  const bounds = itemBounds(id);
  if (!bounds) return 0;
  const frac = GRIP_HEIGHT[shape] ?? 0.5;
  const gripY = bounds.min[1] + bounds.size[1] * frac;
  return -gripY;
}

// ------------------------------------------------------------------ the rigs

/**
 * The first-person held item.
 *
 * A two-level rig, and the levels matter:
 *
 *   frame  — pinned to the bottom-right corner of the screen every frame, in
 *            world units that depend on the FOV and the aspect ratio. This is
 *            the only thing that knows about the screen.
 *   item   — posed inside the frame according to what it is, and swung.
 *
 * Before this there was one mesh doing both jobs, which is why the swing had
 * to be written as an offset to the pinning maths: every animation had to be
 * expressed in screen-corner units and re-derived whenever the aspect ratio
 * changed. Splitting them means the swing is just a rotation about a pivot,
 * which is what a swing is.
 */
export class FirstPersonHand {
  constructor(camera, { layer = 0 } = {}) {
    this.camera = camera;
    this.frame = new THREE.Group();
    this.frame.frustumCulled = false;
    camera.add(this.frame);

    /**
     * The swing pivot. A tool rotates about the *bottom* of its haft — the
     * wrist — not about its middle. Swinging about the middle makes the head
     * come down and the handle go up, which reads as a seesaw rather than as
     * a strike.
     */
    this.pivot = new THREE.Group();
    this.frame.add(this.pivot);

    this.holder = new THREE.Group();
    this.pivot.add(this.holder);

    this.material = createItemMaterial();
    this.blockMaterial = null; // set by the caller: the atlas material

    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.holder.add(this.mesh);

    if (layer) {
      this.frame.traverse((o) => o.layers.set(layer));
      this.mesh.layers.set(layer);
    }
    this.layer = layer;

    this.id = -1;
    this.visible = false;
    /** 0..1, counts *down* while the swing plays out. */
    this.swing = 0;
    /** Which pose family is loaded, so the pose is only re-applied on change. */
    this.kind = null;
  }

  /** Show or hide the whole rig. */
  setVisible(v) {
    this.visible = v;
    this.frame.visible = v;
  }

  /**
   * Put an item (or a block) in the hand.
   *
   * `blockGeometry` is the caller's unit cube for a block id; items build
   * their own. Passing it in rather than importing the block mesher keeps
   * this file free of the world's atlas.
   */
  setItem(id, blockGeometry, blockMaterial) {
    if (id === this.id) return;
    this.id = id;
    if (!id) {
      this.setVisible(false);
      return;
    }
    if (isItem(id)) {
      const geo = itemGeometry(id);
      if (geo) {
        this.mesh.geometry = geo;
        this.mesh.material = this.material;
      } else {
        // An item with no model yet: fall back to the block path rather than
        // showing nothing, so a new id is a bad-looking cube and not a bug
        // report about an invisible hand.
        this.mesh.geometry = blockGeometry ?? this.mesh.geometry;
        this.mesh.material = blockMaterial ?? this.material;
      }
    } else {
      this.mesh.geometry = blockGeometry ?? this.mesh.geometry;
      this.mesh.material = blockMaterial ?? this.material;
    }
    // Keep the layer assignment: swapping geometry does not change it, but
    // swapping in a mesh from elsewhere would.
    if (this.layer) this.mesh.layers.set(this.layer);

    const pose = firstPersonPose(id);
    applyPose(this.holder, pose);
    // Slide a tool down so the wrist is at its grip. Applied on top of the
    // pose's own offset, in the pose's own scale.
    const grip = gripOffset(id);
    if (grip) this.holder.position.y += grip * pose.scale;
    this.kind = poseKind(id);
    this.setVisible(true);
  }

  /**
   * Pin the rig to the bottom-right of the screen.
   *
   * The frame sits `dist` in front of the lens; how far right and down that
   * is depends on the FOV and the aspect ratio, which is why this runs every
   * frame rather than once. `size` is the fraction of the smaller half-extent
   * the item should occupy.
   */
  place(dist, size) {
    const camera = this.camera;
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * dist;
    const halfW = halfH * camera.aspect;
    const r = size * Math.min(halfH, halfW * 0.95);
    this.frame.position.set(halfW - r * 1.2, -halfH + r * 0.7, -dist);
    this.frame.scale.setScalar(r / 0.85);
    return r;
  }

  /** Start a swing. */
  strike() {
    this.swing = 1;
  }

  /**
   * Advance the swing and apply it.
   *
   * Minecraft's swing is not a sine wave. It is a fast strike and a slower
   * recovery, and the asymmetry is most of why it reads as a *hit*: the arm
   * goes out in about a third of the time it takes to come back. The same
   * curve drives the avatar's arm, so the two views tell the same story.
   *
   * A tool swings further than a block and adds a wrist snap — the roll term
   * — because a pickaxe is swung and a block is merely shoved into place.
   */
  update(dt) {
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 4.5);
    const s = this.swing;
    const t = s > 0 ? 1 - s : 0;
    const curve = s <= 0 ? 0 : (t < 0.35
      ? Math.sin((t / 0.35) * Math.PI * 0.5)
      : Math.cos(((t - 0.35) / 0.65) * Math.PI * 0.5));

    const tool = this.kind === POSE_KIND_TOOL;
    // The pivot swings; the item inside it keeps its pose. Down and back,
    // with the tool going further and rolling as it goes.
    //
    // The distances are in *frame* units, and the frame is scaled to the
    // item's on-screen size — which is the point of the split. The old code
    // wrote the same motion in camera units multiplied by the item radius,
    // so every one of these numbers had an `r` in it and changing the FOV
    // changed the swing. Here the swing is the same swing on any screen.
    this.pivot.rotation.x = curve * (tool ? 1.15 : 0.8);
    this.pivot.rotation.z = tool ? curve * 0.42 : 0;
    this.pivot.position.y = -curve * (tool ? 0.70 : 0.94);
    this.pivot.position.x = -curve * (tool ? 0.30 : 0.43);
    this.pivot.position.z = curve * (tool ? 0.20 : 0.10);
    return curve;
  }

  /**
   * Tint the item for being underwater. The held rig is drawn in a pass of
   * its own, after the underwater grade, so it is the one thing the grade
   * cannot reach — see water-render.js.
   */
  setUnderwater(under) {
    this.material.color.setHex(under ? 0x86b4d2 : 0xffffff);
    this.material.emissive.setHex(under ? 0x1e2c3a : 0x4a4a4a);
  }
}

/**
 * The avatar's hand.
 *
 * Simpler than the first-person rig because the arm is doing the animating:
 * this only has to hold the right model at the right size and angle, and get
 * out of the way when there is nothing in the fist.
 */
export class AvatarHand {
  constructor(socket) {
    this.socket = socket;
    this.holder = new THREE.Group();
    socket.add(this.holder);
    this.mesh = null;
    this.material = createItemMaterial();
    /** Source material -> this hand's own copy (see setOpacity). */
    this.clones = new Map();
    this.id = -1;
  }

  /**
   * Put something in the fist.
   *
   * Blocks come in as geometry + material from the first-person rig, which is
   * exactly what they did before; items build their own and use this hand's
   * own material so the fade can touch it.
   */
  set(id, blockGeometry, blockMaterial) {
    if (id === this.id) return;
    this.id = id;
    if (!id) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }

    let geometry = null;
    let material = null;
    if (isItem(id)) {
      geometry = itemGeometry(id);
      material = this.material;
    }
    if (!geometry) {
      geometry = blockGeometry;
      material = this._cloneOf(blockMaterial);
    }
    if (!geometry) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }

    if (!this.mesh) {
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.castShadow = true;
      this.holder.add(this.mesh);
    } else {
      this.mesh.geometry = geometry;
      this.mesh.material = material;
    }
    this.mesh.visible = true;

    const pose = thirdPersonPose(id);
    applyPose(this.holder, pose);
    const grip = gripOffset(id);
    if (grip) this.holder.position.y += grip * pose.scale;
  }

  /**
   * The avatar fades out when the camera is on top of it, and a shared
   * material cannot fade for one user and not another — so each source
   * material gets one clone, made once and kept.
   */
  _cloneOf(material) {
    if (!material) return this.material;
    let own = this.clones.get(material);
    if (!own) {
      own = material.clone();
      this.clones.set(material, own);
    }
    return own;
  }

  /** Every material this hand might be using, for the avatar's fade. */
  materials() {
    return [this.material, ...this.clones.values()];
  }
}
