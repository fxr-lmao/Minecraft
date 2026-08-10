// Camera perspectives, like Minecraft's F5: first person, third person from
// behind, and third person from the front (the camera swings around and looks
// back at you).
//
// Third-person camera positions are pulled in when a block is in the way, so
// the view never ends up inside terrain.

import {
  VIEW_FIRST, VIEW_THIRD_BACK, VIEW_THIRD_FRONT, VIEW_NAMES,
  THIRD_PERSON_DISTANCE,
} from './constants.js';

const CAM_RADIUS = 0.15; // half-size of the camera's collision box
const STEP = 0.1;

/** Look direction from yaw/pitch (matches the camera's YXZ rotation). */
export function lookVector(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
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

export class ViewController {
  constructor(mode = VIEW_FIRST) {
    this.mode = mode;
  }

  get isFirstPerson() {
    return this.mode === VIEW_FIRST;
  }

  get name() {
    return VIEW_NAMES[this.mode];
  }

  cycle() {
    this.mode = (this.mode + 1) % VIEW_NAMES.length;
    return this.mode;
  }

  /**
   * Position and orient the camera for this frame.
   * `eye` is the (bobbed) first-person eye position.
   */
  apply(camera, world, eye, yaw, pitch) {
    if (this.mode === VIEW_FIRST) {
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      return;
    }

    const back = this.mode === VIEW_THIRD_BACK;
    const look = lookVector(yaw, pitch);
    const dir = back ? { x: -look.x, y: -look.y, z: -look.z } : look;
    const dist = freeDistance(world, eye, dir, THIRD_PERSON_DISTANCE);

    camera.position.set(eye.x + dir.x * dist, eye.y + dir.y * dist, eye.z + dir.z * dist);
    if (back) {
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    } else {
      // front view: look back at the player
      camera.rotation.y = yaw + Math.PI;
      camera.rotation.x = -pitch;
    }
  }
}

export { VIEW_FIRST, VIEW_THIRD_BACK, VIEW_THIRD_FRONT };
