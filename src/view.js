// Camera perspectives, like Minecraft's F5: first person, third person from
// behind, and third person from the front (the camera swings around and looks
// back at you).
//
// Third-person cameras are pulled in when a block is in the way, and the
// pulled-in distance is smoothed — snapping the camera to the raw collision
// distance every frame makes walking past a wall corner strobe horribly.
// The camera also sits slightly off the player's shoulder so the avatar is
// not parked exactly on top of the crosshair.

import {
  VIEW_FIRST, VIEW_THIRD_BACK, VIEW_THIRD_FRONT, VIEW_NAMES,
  THIRD_PERSON_DISTANCE, THIRD_PERSON_MIN, THIRD_PERSON_MAX,
  SHOULDER_OFFSET,
} from './constants.js';
import { clamp } from './utils.js';

const CAM_RADIUS = 0.15; // half-size of the camera's collision box
const STEP = 0.1;
/** How fast the camera may move back out after an obstacle clears (blk/s). */
const EXTEND_SPEED = 9;

/** Look direction from yaw/pitch (matches the camera's YXZ rotation). */
export function lookVector(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Horizontal right-hand vector for a yaw (used for the shoulder offset). */
export function rightVector(yaw) {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

function boxBlocked(world, x, y, z) {
  for (let i = 0; i < 8; i++) {
    const px = x + (i & 1 ? CAM_RADIUS : -CAM_RADIUS);
    const py = y + (i & 2 ? CAM_RADIUS : -CAM_RADIUS);
    const pz = z + (i & 4 ? CAM_RADIUS : -CAM_RADIUS);
    if (world.isSolid(Math.floor(px), Math.floor(py), Math.floor(pz))) return true;
  }
  return false;
}

/** How far the camera can back off from `eye` along `dir` before hitting a block. */
export function freeDistance(world, eye, dir, maxDist) {
  let last = 0;
  for (let t = STEP; t <= maxDist; t += STEP) {
    if (boxBlocked(world, eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t)) {
      return Math.max(0, last - 0.05);
    }
    last = t;
  }
  return maxDist;
}

/**
 * Ease the camera distance: snap inwards immediately (never clip through a
 * wall) but ease outwards, so the view doesn't jerk when an obstacle clears.
 */
export function smoothDistance(current, target, dt) {
  if (target <= current) return target;
  return Math.min(target, current + EXTEND_SPEED * dt);
}

export class ViewController {
  constructor(mode = VIEW_FIRST) {
    this.mode = mode;
    /** Distance the player has zoomed to (before collision). */
    this.distance = THIRD_PERSON_DISTANCE;
    /** Distance actually in use after collision + smoothing. */
    this.currentDistance = THIRD_PERSON_DISTANCE;
    /** 0..1 — how much to fade the avatar when the camera is close to it. */
    this.avatarOpacity = 1;
  }

  get isFirstPerson() {
    return this.mode === VIEW_FIRST;
  }

  get name() {
    return VIEW_NAMES[this.mode];
  }

  cycle() {
    this.mode = (this.mode + 1) % VIEW_NAMES.length;
    // Start each third-person view at the player's chosen distance.
    this.currentDistance = Math.min(this.currentDistance, this.distance);
    return this.mode;
  }

  set(mode) {
    this.mode = clamp(mode, 0, VIEW_NAMES.length - 1) | 0;
  }

  /** Shift+scroll (or pinch) zooms the third-person camera in and out. */
  zoom(dir) {
    this.distance = clamp(this.distance - dir * 0.5, THIRD_PERSON_MIN, THIRD_PERSON_MAX);
    return this.distance;
  }

  /**
   * Position and orient the camera for this frame.
   * `eye` is the (bobbed) first-person eye position.
   */
  apply(camera, world, eye, yaw, pitch, dt = 0.016) {
    if (this.mode === VIEW_FIRST) {
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      this.avatarOpacity = 0;
      this.currentDistance = 0;
      return;
    }

    const back = this.mode === VIEW_THIRD_BACK;
    const look = lookVector(yaw, pitch);
    const dir = back ? { x: -look.x, y: -look.y, z: -look.z } : look;

    // Offset the orbit centre sideways so the avatar sits off-centre and
    // doesn't cover the crosshair.
    const right = rightVector(yaw);
    const side = back ? SHOULDER_OFFSET : -SHOULDER_OFFSET;
    const pivot = {
      x: eye.x + right.x * side,
      y: eye.y,
      z: eye.z + right.z * side,
    };

    const wanted = freeDistance(world, pivot, dir, this.distance);
    this.currentDistance = smoothDistance(this.currentDistance, wanted, dt);
    const d = this.currentDistance;

    camera.position.set(pivot.x + dir.x * d, pivot.y + dir.y * d, pivot.z + dir.z * d);
    if (back) {
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    } else {
      // front view: look back at the player
      camera.rotation.y = yaw + Math.PI;
      camera.rotation.x = -pitch;
    }

    // Fade the avatar out when the camera is squeezed up against it, so you
    // never end up staring at the inside of your own head.
    this.avatarOpacity = clamp((d - 0.6) / 1.1, 0, 1);
  }
}

export { VIEW_FIRST, VIEW_THIRD_BACK, VIEW_THIRD_FRONT };
