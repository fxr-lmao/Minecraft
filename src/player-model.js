// Blocky player avatar shown in the two third-person views.
//
// Proportions follow the classic 64x32 skin layout measured in "skin pixels":
// legs 12, body 12, head 8 = 32 px tall, scaled so the model is exactly the
// 1.8 block hitbox. Limbs hang from pivots (hips/shoulders) so they swing
// from the right end.

import * as THREE from '../vendor/three.module.min.js';
import { PLAYER_HEIGHT } from './constants.js';
import { mulberry32, clamp } from './utils.js';
import { AvatarHand } from './held-item.js';

const PX = PLAYER_HEIGHT / 32; // one skin pixel in world units

// Deliberately brighter than a real Minecraft skin: the scene is ACES
// tone-mapped, so anything near Steve's #3f2a17 hair collapses to black when
// the sun is on the far side of the player (which is most of the time in
// third person).
const SKIN = 0xe8b28c;
const HAIR = 0x7a5130;
const SHIRT = 0x00b6b6;
const SLEEVE = 0x14a0a0;
const PANTS = 0x4f63c8;
const SHOE = 0x5f5c6b;

/** Small noisy 8x8 texture so flat colours don't look plasticky. */
function flatTexture(color, seed, opts = {}) {
  const { rows = null } = opts; // rows: [{ from, to, color }] painted on top
  const S = 8;
  const rand = mulberry32(seed);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const paint = (c, y0, y1) => {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < S; x++) {
        const f = 0.88 + rand() * 0.22;
        const r = clamp(Math.round(((c >> 16) & 255) * f), 0, 255);
        const g = clamp(Math.round(((c >> 8) & 255) * f), 0, 255);
        const b = clamp(Math.round((c & 255) * f), 0, 255);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };
  paint(color, 0, S);
  for (const row of rows ?? []) paint(row.color, row.from, row.to);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The face: skin, hair fringe, two eyes and a mouth. */
function faceTexture() {
  const S = 8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = `#${SKIN.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = `#${HAIR.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, S, 2);
  // eyes: white sclera with a dark blue pupil
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1, 3, 2, 1);
  ctx.fillRect(5, 3, 2, 1);
  ctx.fillStyle = '#3b3b8c';
  ctx.fillRect(2, 3, 1, 1);
  ctx.fillRect(5, 3, 1, 1);
  // mouth
  ctx.fillStyle = '#8b5a45';
  ctx.fillRect(3, 6, 2, 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function boxMesh(w, h, d, materials) {
  const geo = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Self-illumination (emissive = the part's own texture, dimmed) so the side
// facing away from the sun stays readable instead of turning into a
// silhouette. The world's blocks don't need this — they are lit from above.
const AMBIENT = 0x6e6e6e;

function partMaterial(tex) {
  return new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: AMBIENT });
}

function uniformMaterials(color, seed, opts) {
  return partMaterial(flatTexture(color, seed, opts));
}

/**
 * Build the avatar. Returns { group, update(state) }.
 * The group's origin sits at the player's feet.
 */
export function createPlayerModel() {
  const group = new THREE.Group();
  /**
   * Everything hangs off this rather than off the group directly, so that
   * swimming can tip the whole body over without disturbing the group's
   * position (the player's feet) or its yaw. Rotating the group itself would
   * mean fighting the body/head separation for control of the same three
   * angles.
   */
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  group.add(root);

  // ---- head (front face is -Z, matching the forward vector) ----
  const hairSide = { rows: [{ from: 0, to: 2, color: HAIR }] };
  const headSide = uniformMaterials(SKIN, 11, hairSide);
  const headTop = uniformMaterials(HAIR, 12);
  const headBottom = uniformMaterials(SKIN, 13);
  const headBack = uniformMaterials(HAIR, 14);
  const face = partMaterial(faceTexture());
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const head = boxMesh(8, 8, 8, [headSide, headSide, headTop, headBottom, headBack, face]);
  const headPivot = new THREE.Group();
  headPivot.position.y = 24 * PX; // neck
  head.position.y = 4 * PX; // head centre, relative to the neck pivot
  headPivot.add(head);
  root.add(headPivot);

  // ---- body ----
  const body = boxMesh(8, 12, 4, uniformMaterials(SHIRT, 21));
  body.position.y = 18 * PX;
  root.add(body);

  // ---- arms / legs on pivots ----
  const limb = (color, seed, w, h, d, x, y, opts) => {
    const pivot = new THREE.Group();
    pivot.position.set(x * PX, y * PX, 0);
    const mesh = boxMesh(w, h, d, uniformMaterials(color, seed, opts));
    mesh.position.y = (-h / 2) * PX;
    pivot.add(mesh);
    root.add(pivot);
    return pivot;
  };

  const sleeve = { rows: [{ from: 0, to: 3, color: SLEEVE }] };
  const shoe = { rows: [{ from: 5, to: 8, color: SHOE }] };
  const armL = limb(SKIN, 31, 4, 12, 4, -6, 24, sleeve);
  const armR = limb(SKIN, 32, 4, 12, 4, 6, 24, sleeve);

  // What the avatar is holding, parented to the right arm so it swings with
  // it. A block sits in the fist at Minecraft's angle; a tool goes in the
  // same socket with its own pose, which is why this is a group rather than
  // a mesh — and why the pose lives in item-models.js rather than here.
  const hand = new THREE.Group();
  hand.position.set(1.5 * PX, -13 * PX, -3 * PX); // the fist, a little ahead of the arm
  hand.rotation.set(-0.5, 0.5, 0.1);
  armR.add(hand);
  /**
   * The hand rig.
   *
   * This used to be a bare mesh and a scale factor, which was exactly right
   * for a block and exactly wrong for everything else: a tool needs a pose,
   * a grip offset and a model of its own, and a *flat sprite* held side-on by
   * a figure you are looking at from behind is one pixel wide — which is why
   * the pickaxe used to disappear as you turned. AvatarHand owns all of that.
   */
  const heldHand = new AvatarHand(hand);
  const legL = limb(PANTS, 41, 4, 12, 4, -2, 12, shoe);
  const legR = limb(PANTS, 42, 4, 12, 4, 2, 12, shoe);

  // The head turns independently of the body (YXZ so yaw applies before pitch).
  headPivot.rotation.order = 'YXZ';

  const materials = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) materials.push(...o.material);
    else materials.push(o.material);
  });

  let phase = 0;
  let clock = 0; // seconds of *unpaused* game time, for idle motion
  let swing = 0; // 0..1 arm swing when breaking/placing
  let crouch = 0;
  let sprintLean = 0;
  let swim = 0; // 0..1 blend between standing up and lying flat
  let stroke = 0; // the crawl, in radians of shoulder rotation
  let bodyYaw = null; // smoothed; the head twists relative to it
  let opacity = 1;

  return {
    group,

    /** Trigger the mining/placing arm swing. */
    swingArm() {
      swing = 1;
    },

    /**
     * Put something in the avatar's hand, or nothing.
     *
     * Takes an id now rather than a geometry, because what an item looks like
     * in three dimensions is a property of the item and not of whatever the
     * first-person view happens to have built. Blocks still come in as
     * geometry + material, since a block *is* the same cube in both hands and
     * building it twice would be two copies of the same 36 triangles.
     */
    setHeldItem(id, blockGeometry, blockMaterial) {
      heldHand.set(id ?? 0, blockGeometry, blockMaterial);
      // Any material the hand has just cloned has to join the fade list, or
      // the avatar goes translucent while the thing it is carrying does not.
      //
      // ...and it has to be caught up to the *current* opacity as it joins,
      // because setOpacity below short-circuits when the value has not
      // changed. Without this, switching to a pickaxe while the camera is
      // pushed up against your back hands you a perfectly opaque pickaxe
      // floating in front of a transparent arm.
      let added = false;
      for (const m of heldHand.materials()) {
        if (materials.includes(m)) continue;
        materials.push(m);
        added = true;
      }
      if (added && opacity < 0.999) {
        for (const m of heldHand.materials()) {
          m.opacity = opacity;
          m.transparent = true;
          m.depthWrite = false;
          m.needsUpdate = true;
        }
      }
    },

    /** The hand rig itself, for anything that needs to reach past this API. */
    hand: heldHand,

    /**
     * Fade the avatar out when the third-person camera is right on top of it.
     * Transparency is only switched on while it is actually needed.
     */
    setOpacity(value) {
      const o = clamp(value, 0, 1);
      if (Math.abs(o - opacity) < 0.01) return;
      opacity = o;
      const transparent = o < 0.999;
      for (const m of materials) {
        m.opacity = o;
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.depthWrite = !transparent;
          m.needsUpdate = true;
        }
      }
    },

    /**
     * @param {object} s
     *   { dt, pos, yaw, pitch, speed, onGround, sneaking, sprinting, swimming, vel }
     */
    update(s) {
      group.position.set(s.pos.x, s.pos.y, s.pos.z);

      // ---- body / head separation ----
      // Minecraft turns the body toward where you are *moving* and lets the
      // head twist up to ~55° away from it; look further and the body follows.
      // Without this the whole avatar snaps around with the mouse, which is
      // what made third person look so stiff.
      // Swimming overrides it: a swimmer goes where they are pointed, so the
      // body lines up with the look direction rather than trailing the
      // velocity, and it does so quickly — the whole point of the pose is
      // that you steer with your head.
      if (bodyYaw === null) bodyYaw = s.yaw;
      const moving = s.speed > 0.35 && s.vel;
      const targetYaw = s.swimming ? s.yaw : (moving ? Math.atan2(-s.vel.x, -s.vel.z) : bodyYaw);
      const turnRate = s.swimming ? 12 : (moving ? 9 : 0);
      bodyYaw = approachAngle(bodyYaw, targetYaw, turnRate, s.dt);

      // clamp the head twist, dragging the body along past the limit
      let twist = wrapAngle(s.yaw - bodyYaw);
      const LIMIT = 0.96; // ~55°
      if (twist > LIMIT) {
        bodyYaw = wrapAngle(s.yaw - LIMIT);
        twist = LIMIT;
      } else if (twist < -LIMIT) {
        bodyYaw = wrapAngle(s.yaw + LIMIT);
        twist = -LIMIT;
      }
      group.rotation.y = bodyYaw;
      headPivot.rotation.y = twist;
      headPivot.rotation.x = clamp(s.pitch, -1.3, 1.3);

      // ---- walk cycle (relative to the body, so strafing swings too) ----
      phase += s.speed * s.dt * 2.4;
      const amp = clamp(s.speed * 0.17, 0, 0.95);
      const a = Math.sin(phase) * amp;
      legL.rotation.x = a;
      legR.rotation.x = -a;
      armL.rotation.x = -a * 0.85;
      armR.rotation.x = a * 0.85;
      // Idle arm sway, driven by the game clock rather than wall-clock time
      // so that it stops dead when the game is paused.
      clock += s.dt;
      const idle = Math.sin(clock * 1.1) * 0.045;
      armL.rotation.z = -idle;
      armR.rotation.z = idle;

      // in the air: tuck the legs slightly
      if (!s.onGround) {
        legL.rotation.x = 0.35;
        legR.rotation.x = -0.15;
      }

      // ---- swimming ----
      // Tip the whole rig onto its front and point it where the player is
      // looking. The rotation happens at the feet, so the model has to be
      // slid forward by half its length and lifted to the middle of the
      // swimming hitbox afterwards, or the swimmer would pivot around their
      // own ankles and end up buried in the sea floor.
      swim += ((s.swimming ? 1 : 0) - swim) * Math.min(1, s.dt * 9);
      if (swim < 0.005) {
        swim = 0;
        stroke = 0;
      } else {
        // The crawl runs a little faster the harder you are swimming.
        stroke += s.dt * (2.6 + Math.min(s.speed, 3) * 0.9);
      }
      root.rotation.x = swim * (-Math.PI / 2 + clamp(s.pitch, -1.15, 1.15));
      root.position.set(0, swim * 0.30, swim * 0.90);

      if (swim > 0) {
        // Arms out in front, pulling alternately; legs fluttering behind.
        // A shoulder turned all the way to -pi points the arm along the body,
        // which face down is straight ahead — so the crawl is a sweep either
        // side of that rather than a windmill, and whatever is in the hand
        // stays out where it can be seen.
        const flutter = Math.sin(stroke * 2) * 0.32;
        armL.rotation.x = mix(armL.rotation.x, -Math.PI + Math.sin(stroke) * 0.85, swim);
        armR.rotation.x = mix(armR.rotation.x, -Math.PI + Math.sin(stroke + Math.PI) * 0.85, swim);
        armL.rotation.z = mix(armL.rotation.z, -0.16, swim);
        armR.rotation.z = mix(armR.rotation.z, 0.16, swim);
        legL.rotation.x = mix(legL.rotation.x, flutter, swim);
        legR.rotation.x = mix(legR.rotation.x, -flutter, swim);
        // The body is already pointing where the player is looking, so the
        // neck only needs whatever is left over.
        headPivot.rotation.x *= 1 - swim * 0.8;
      }

      // sneak: lean forward, drop the body, tilt the arms back. Neither
      // crouching nor a sprinting lean means anything face down in the water,
      // so swimming fades both out.
      crouch += ((s.sneaking ? 1 : 0) - crouch) * Math.min(1, s.dt * 14);
      // sprint: lean into the run
      sprintLean += ((s.sprinting ? 1 : 0) - sprintLean) * Math.min(1, s.dt * 8);
      const upright = 1 - swim;
      const bend = crouch * upright;

      const lean = bend * 0.45 + sprintLean * upright * 0.16;
      body.rotation.x = lean;
      body.position.y = (18 - 2 * bend) * PX;
      headPivot.position.y = (24 - 3 * bend) * PX;
      headPivot.position.z = bend * 2.2 * PX;
      headPivot.rotation.x -= lean * 0.75; // keep the head level while leaning
      armL.position.y = armR.position.y = (24 - 3 * bend) * PX;
      armL.position.z = armR.position.z = bend * 1.8 * PX;
      legL.position.y = legR.position.y = (12 - 1 * bend) * PX;

      // swing decay — a fast strike and a slower recovery, the same curve
      // the first-person hand uses, so both views tell the same story.
      if (swing > 0) {
        swing = Math.max(0, swing - s.dt * 6);
        const t = 1 - swing; // 0 -> 1
        const curve = t < 0.35
          ? Math.sin((t / 0.35) * Math.PI * 0.5)
          : Math.cos(((t - 0.35) / 0.65) * Math.PI * 0.5);
        armR.rotation.x -= curve * 1.7;
        armR.rotation.z -= curve * 0.25;
      }
    },
  };
}

/** Linear blend, for easing one pose into another. */
export function mix(a, b, t) {
  return a + (b - a) * t;
}

/** Wrap an angle to (-pi, pi]. */
export function wrapAngle(a) {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
}

/** Move `current` toward `target` the short way round, at `rate` rad/s. */
export function approachAngle(current, target, rate, dt) {
  const diff = wrapAngle(target - current);
  if (rate <= 0) return current;
  const step = rate * dt;
  if (Math.abs(diff) <= step) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * step);
}
