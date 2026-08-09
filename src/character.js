// Steve-style player character, shown in third-person camera modes.
// Textures are painted procedurally onto small canvases; there are no
// keyframes — the pose is computed every frame from the player state:
//   - legs/arms swing while walking (amplitude ∝ speed)
//   - head follows the camera pitch
//   - sneak: torso leans forward and the body dips
//   - airborne: a slight "in flight" pose
//   - idle: subtle arm sway
//
// The model faces -Z locally, so `group.rotation.y = player.yaw` makes it
// face the player's movement direction.

import * as THREE from '../vendor/three.module.min.js';
import { SPEED_SPRINT } from './constants.js';
import { clamp, lerp } from './utils.js';

// ---- palette ----------------------------------------------------------
const SKIN = '#c08050';
const SKIN_DARK = '#a96f42';
const HAIR = '#3a2812';
const EYE_IRIS = '#453059';
const SHIRT = '#0aa3a3';
const SHIRT_DARK = '#077d7d';
const PANTS = '#3f3fc0';
const SHOES = '#6e6e6e';

// ---- procedural texture helpers ----------------------------------------
function makePartTexture(w, h, painter) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  painter(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function lambert(tex) {
  return new THREE.MeshLambertMaterial({ map: tex });
}

function solid(color, w = 8, h = 8) {
  return makePartTexture(w, h, (ctx, x, y) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, x, y);
  });
}

function paintHeadFace(ctx, w, h) {
  ctx.fillStyle = SKIN;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = HAIR;
  ctx.fillRect(0, 0, w, Math.round(h * 0.22)); // hairline
  // eyes
  const ey = Math.round(h * 0.44);
  const eh = Math.max(3, Math.round(h * 0.12));
  const ew = Math.max(4, Math.round(w * 0.18));
  const lx = Math.round(w * 0.2);
  const rx = Math.round(w * 0.62);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(lx, ey, ew, eh);
  ctx.fillRect(rx, ey, ew, eh);
  ctx.fillStyle = EYE_IRIS;
  ctx.fillRect(lx + Math.round(ew * 0.5), ey, Math.max(2, Math.round(ew * 0.5)), eh);
  ctx.fillRect(rx + Math.round(ew * 0.5), ey, Math.max(2, Math.round(ew * 0.5)), eh);
  // nose + mouth
  ctx.fillStyle = SKIN_DARK;
  ctx.fillRect(Math.round(w * 0.42), Math.round(h * 0.58), Math.round(w * 0.16), Math.round(h * 0.1));
  ctx.fillRect(Math.round(w * 0.34), Math.round(h * 0.78), Math.round(w * 0.32), 2);
}

function paintHeadSide(ctx, w, h) {
  ctx.fillStyle = SKIN;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = HAIR;
  ctx.fillRect(0, 0, w, Math.round(h * 0.28));
  ctx.fillRect(0, 0, Math.round(w * 0.7), Math.round(h * 0.42));
}

function paintShirt(ctx, w, h) {
  ctx.fillStyle = SHIRT;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = SHIRT_DARK;
  ctx.fillRect(0, Math.round(h * 0.85), w, h - Math.round(h * 0.85)); // waistband shade
}

function paintShirtFront(ctx, w, h) {
  paintShirt(ctx, w, h);
  ctx.fillStyle = SKIN;
  ctx.fillRect(Math.round(w * 0.32), 0, Math.round(w * 0.36), Math.round(h * 0.16)); // neckline
}

function paintArm(ctx, w, h) {
  ctx.fillStyle = SHIRT;
  ctx.fillRect(0, 0, w, Math.round(h * 0.3)); // sleeve
  ctx.fillStyle = SKIN;
  ctx.fillRect(0, Math.round(h * 0.3), w, h - Math.round(h * 0.3)); // arm + hand
  ctx.fillStyle = SKIN_DARK;
  ctx.fillRect(0, h - 3, w, 3); // hand shade
}

function paintLeg(ctx, w, h) {
  ctx.fillStyle = PANTS;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = SHOES;
  ctx.fillRect(0, h - 6, w, 6);
}

// ---- model -------------------------------------------------------------

const HEAD = 0.44; // head cube edge
const TORSO_W = 0.52;
const TORSO_H = 0.6;
const TORSO_D = 0.28;
const ARM_W = 0.22;
const ARM_H = 0.56;
const LEG_W = 0.26;
const LEG_H = 0.75;

export class Character {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this._time = 0;
    this._phase = 0;
    this._amp = 0;
    this._crouch = 0;
    this._headPitch = 0;

    // -- torso (pivot at the hips so it can lean when sneaking) --
    this._torso = new THREE.Group();
    this._torso.position.y = LEG_H;
    this.group.add(this._torso);

    const shirtSide = lambert(makePartTexture(16, 16, paintShirt));
    const shirtFront = lambert(makePartTexture(16, 16, paintShirtFront));
    const shirtBottom = lambert(solid(SHIRT_DARK));
    const torsoMesh = new THREE.Mesh(
      new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D),
      // +x, -x, +y, -y, +z(back), -z(front)
      [shirtSide, shirtSide, shirtSide, shirtBottom, shirtSide, shirtFront]
    );
    torsoMesh.position.y = TORSO_H / 2;
    this._torso.add(torsoMesh);

    // -- arms (pivot at the shoulders; children of the torso) --
    const armSide = lambert(makePartTexture(8, 24, paintArm));
    const armCap = lambert(solid(SKIN));
    const armGeo = new THREE.BoxGeometry(ARM_W, ARM_H, ARM_W);
    armGeo.translate(0, -(ARM_H / 2) + 0.04, 0);
    const armMats = [armSide, armSide, armSide, armCap, armSide, armSide];

    this._armL = new THREE.Group();
    this._armL.position.set(-(TORSO_W / 2 + ARM_W / 2 + 0.01), TORSO_H - 0.06, 0);
    this._armL.add(new THREE.Mesh(armGeo, armMats));
    this._torso.add(this._armL);

    this._armR = new THREE.Group();
    this._armR.position.set(TORSO_W / 2 + ARM_W / 2 + 0.01, TORSO_H - 0.06, 0);
    this._armR.add(new THREE.Mesh(armGeo, armMats));
    this._torso.add(this._armR);

    // -- legs (pivot at the hips, attached to the root) --
    const legSide = lambert(makePartTexture(8, 24, paintLeg));
    const legBottom = lambert(solid(SHOES));
    const legGeo = new THREE.BoxGeometry(LEG_W, LEG_H, LEG_W);
    legGeo.translate(0, -LEG_H / 2, 0);
    const legMats = [legSide, legSide, legSide, legBottom, legSide, legSide];

    this._legL = new THREE.Group();
    this._legL.position.set(-(LEG_W / 2 + 0.01), LEG_H, 0);
    this._legL.add(new THREE.Mesh(legGeo, legMats));
    this.group.add(this._legL);

    this._legR = new THREE.Group();
    this._legR.position.set(LEG_W / 2 + 0.01, LEG_H, 0);
    this._legR.add(new THREE.Mesh(legGeo, legMats));
    this.group.add(this._legR);

    // -- head (pivot at the neck so it can nod with pitch) --
    this._head = new THREE.Group();
    this._head.position.y = LEG_H + TORSO_H;
    const headFace = lambert(makePartTexture(24, 24, paintHeadFace));
    const headSide = lambert(makePartTexture(24, 24, paintHeadSide));
    const headTop = lambert(solid(HAIR, 8, 8));
    const headBottom = lambert(solid(SKIN));
    const headMesh = new THREE.Mesh(
      new THREE.BoxGeometry(HEAD, HEAD, HEAD),
      [headSide, headSide, headTop, headBottom, headSide, headFace]
    );
    headMesh.position.y = HEAD / 2;
    this._head.add(headMesh);
    this.group.add(this._head);

    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.matrixAutoUpdate = false;
      }
    });
    for (const m of [torsoMesh, headMesh, this._armL.children[0], this._armR.children[0], this._legL.children[0], this._legR.children[0]]) {
      m.updateMatrix();
    }
  }

  /**
   * Advance the animation. `dt` is render-frame seconds.
   */
  update(dt, player) {
    this._time += dt;

    // position + facing
    const crouchTarget = player.sneaking ? 0.15 : 0;
    this._crouch = lerp(this._crouch, crouchTarget, Math.min(1, dt * 10));
    this.group.position.set(player.pos.x, player.pos.y - this._crouch, player.pos.z);
    this.group.rotation.y = player.yaw;

    // walk cycle
    const ampTarget = clamp(player.horizontalSpeed / SPEED_SPRINT, 0, 1.2);
    this._amp = lerp(this._amp, ampTarget, Math.min(1, dt * 10));
    this._phase += player.horizontalSpeed * dt * 2.6;
    const swing = Math.sin(this._phase) * 0.95 * this._amp;

    let legL = swing;
    let legR = -swing;
    let armL = -swing * 0.85;
    let armR = swing * 0.85;
    let torsoLean = player.sneaking ? 0.35 : 0;

    if (!player.onGround) {
      // slight "in flight" pose blended over the walk cycle
      const t = 0.45;
      legL = lerp(legL, 0.5, t);
      legR = lerp(legR, -0.35, t);
      armL = lerp(armL, -0.55, t);
      armR = lerp(armR, 0.55, t);
    } else if (this._amp < 0.06) {
      // idle sway
      const sway = Math.sin(this._time * 1.4) * 0.06;
      armL += sway;
      armR -= sway;
    }

    const k = Math.min(1, dt * 14);
    this._legL.rotation.x = lerp(this._legL.rotation.x, legL, k);
    this._legR.rotation.x = lerp(this._legR.rotation.x, legR, k);
    this._armL.rotation.x = lerp(this._armL.rotation.x, armL, k);
    this._armR.rotation.x = lerp(this._armR.rotation.x, armR, k);
    this._torso.rotation.x = lerp(this._torso.rotation.x, torsoLean, k);

    // head nods with the camera pitch (slight lag for life)
    this._headPitch = lerp(this._headPitch, player.pitch, Math.min(1, dt * 12));
    this._head.rotation.x = this._headPitch - this._torso.rotation.x;
  }
}
