// Minecraft-accurate player movement.
//
// The horizontal model reproduces Minecraft Java's per-tick recurrence
// (v_next = f*v + a*input) with the wiki constants, converted to run at
// our fixed 120 Hz physics rate:
//   ground drag k = -20*ln(0.546) ≈ 12.1/s  →  walk terminal 4.317 blk/s
//   air drag   k = -20*ln(0.91)  ≈ 1.89/s   →  air terminal  4.444 blk/s
//   sprint multiplies acceleration by 1.3    →  5.612 / 5.778 blk/s
//   sneak speed 1.295 blk/s
//   gravity 32 blk/s^2, jump velocity 8.95 blk/s (≈1.25 blk jump height)

import * as THREE from 'three';
import {
  GRAVITY, JUMP_VELOCITY,
  SPEED_WALK, SPEED_SNEAK, AIR_WALK,
  DRAG_GROUND, DRAG_AIR,
  PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_EYE, STEP_HEIGHT,
  WORLD_SIZE, SPAWN,
} from './constants.js';

const HALF = PLAYER_WIDTH / 2;
const EPS = 1e-4;
const TERMINAL_FALL = 78.4; // blocks/s (Minecraft's fall terminal velocity)
const FALL_RESPAWN_Y = -32;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // facing -Z at yaw 0; start facing +Z toward world center
    this.pitch = 0;

    this.onGround = false;
    this.sprinting = false;
    this.sneaking = false;

    this.horizontalSpeed = 0; // for head bob + HUD
  }

  get eyeHeight() {
    return PLAYER_EYE;
  }

  /** Camera position (eye). */
  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + PLAYER_EYE, this.pos.z);
  }

  /** Horizontal forward vector from yaw (camera forward projected on XZ). */
  forwardVector() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Horizontal right vector from yaw. */
  rightVector() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /**
   * Facing direction in Minecraft's convention: degrees clockwise from
   * +Z (south): 0 = South, 90 = West, 180 = North, 270 = East.
   */
  facingDegrees() {
    const deg = Math.atan2(Math.sin(this.yaw), -Math.cos(this.yaw)) * 180 / Math.PI;
    return (deg + 360) % 360;
  }

  /**
   * input: { forward: -1|0|1, strafe: -1|0|1, jump: bool, sprint: bool, sneak: bool }
   */
  update(dt, input) {
    const moveDir = this._inputDirection(input);

    // ---- sprint bookkeeping ----
    // Sprinting requires forward intent; releasing W or sneaking cancels it.
    if (input.sneak || !input.forward) {
      this.sprinting = false;
      this.sneaking = input.sneak;
    } else {
      this.sneaking = false;
      if (input.sprint && !this.sprinting && this.onGround) this.sprinting = true;
    }

    // ---- horizontal acceleration (Minecraft recurrence, dt-scaled) ----
    const grounded = this.onGround;
    const k = grounded ? DRAG_GROUND : DRAG_AIR;
    const f = Math.exp(-k * dt); // per-step velocity retention factor

    // Base target speed; sprint multiplies acceleration by 1.3 (like MC),
    // so the terminal speed becomes 5.612 (ground) / 5.778 (air).
    const target = grounded
      ? (this.sneaking ? SPEED_SNEAK : SPEED_WALK)
      : AIR_WALK;

    const hasInput = moveDir.lengthSq() > 0;
    if (hasInput) {
      const a = target * (1 - f) * (this.sprinting ? 1.3 : 1);
      this.vel.x = this.vel.x * f + moveDir.x * a;
      this.vel.z = this.vel.z * f + moveDir.z * a;
    } else {
      this.vel.x *= f;
      this.vel.z *= f;
    }

    // ---- vertical ----
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -TERMINAL_FALL) this.vel.y = -TERMINAL_FALL;

    const wasGrounded = this.onGround;
    this.onGround = false;

    if (input.jump && wasGrounded) {
      this.vel.y = JUMP_VELOCITY;
    }

    // ---- integrate + collide (axis separated, with auto-step) ----
    const moved = this._moveWithCollision(dt);

    // Sprinting into a wall cancels sprint (like Minecraft)
    if (this.sprinting && moved.blockedHorizontal && this.onGround) {
      this.sprinting = false;
    }

    // ---- world border (invisible, like Minecraft's barrier) ----
    const half = HALF;
    const lim = WORLD_SIZE - half - EPS;
    const limLow = half + EPS;
    if (this.pos.x > lim) { this.pos.x = lim; this.vel.x = Math.min(this.vel.x, 0); }
    if (this.pos.x < limLow) { this.pos.x = limLow; this.vel.x = Math.max(this.vel.x, 0); }
    if (this.pos.z > lim) { this.pos.z = lim; this.vel.z = Math.min(this.vel.z, 0); }
    if (this.pos.z < limLow) { this.pos.z = limLow; this.vel.z = Math.max(this.vel.z, 0); }

    // ---- fell out of the world -> respawn ----
    if (this.pos.y < FALL_RESPAWN_Y) {
      this.pos.set(SPAWN.x, SPAWN.y, SPAWN.z);
      this.vel.set(0, 0, 0);
      this.onGround = false;
    }

    this.horizontalSpeed = Math.hypot(this.vel.x, this.vel.z);
  }

  _inputDirection(input) {
    const dir = new THREE.Vector3();
    const forward = this.forwardVector();
    const right = this.rightVector();
    dir.addScaledVector(forward, input.forward);
    dir.addScaledVector(right, input.strafe);
    if (dir.lengthSq() > 1) dir.normalize(); // diagonals aren't faster
    return dir;
  }

  /**
   * Move by vel*dt with axis-separated AABB collision.
   * Returns { blockedHorizontal }.
   */
  _moveWithCollision(dt) {
    const dx = this.vel.x * dt;
    const dy = this.vel.y * dt;
    const dz = this.vel.z * dt;

    let blockedX = false;
    let blockedZ = false;

    // X axis
    if (dx !== 0) {
      this.pos.x += dx;
      const hit = this._collideX(dx);
      if (hit) { this.pos.x = hit; this.vel.x = 0; blockedX = true; }
    }
    // Z axis
    if (dz !== 0) {
      this.pos.z += dz;
      const hit = this._collideZ(dz);
      if (hit) { this.pos.z = hit; this.vel.z = 0; blockedZ = true; }
    }
    // Y axis
    if (dy !== 0) {
      this.pos.y += dy;
      const hit = this._collideY(dy);
      if (hit !== null) {
        this.pos.y = hit;
        if (dy < 0) {
          this.vel.y = 0;
          this.onGround = true;
        } else {
          this.vel.y = 0;
        }
      }
    }

    const blockedHorizontal = blockedX || blockedZ;

    // Auto-step: if we bumped a wall while on the ground, try stepping up.
    if (blockedHorizontal && (this.onGround || dy <= 0)) {
      this._tryStep(dx, dz, dt);
    }

    return { blockedHorizontal };
  }

  /** Returns the AABB min/max as {minX, maxX, minY, maxY, minZ, maxZ}. */
  _aabb() {
    return {
      minX: this.pos.x - HALF, maxX: this.pos.x + HALF,
      minY: this.pos.y, maxY: this.pos.y + PLAYER_HEIGHT,
      minZ: this.pos.z - HALF, maxZ: this.pos.z + HALF,
    };
  }

  _collideX(dx) {
    const b = this._aabb();
    const dir = dx > 0 ? 1 : -1;
    const wallX = dx > 0 ? b.maxX : b.minX;
    const cx = Math.floor(wallX);
    for (let cy = Math.floor(b.minY); cy <= Math.floor(b.maxY - 1e-9); cy++) {
      for (let cz = Math.floor(b.minZ); cz <= Math.floor(b.maxZ - 1e-9); cz++) {
        if (this.world.isSolid(cx, cy, cz)) {
          return dir > 0 ? cx - HALF - EPS : cx + 1 + HALF + EPS;
        }
      }
    }
    return null;
  }

  _collideZ(dz) {
    const b = this._aabb();
    const dir = dz > 0 ? 1 : -1;
    const wallZ = dz > 0 ? b.maxZ : b.minZ;
    const cz = Math.floor(wallZ);
    for (let cy = Math.floor(b.minY); cy <= Math.floor(b.maxY - 1e-9); cy++) {
      for (let cx = Math.floor(b.minX); cx <= Math.floor(b.maxX - 1e-9); cx++) {
        if (this.world.isSolid(cx, cy, cz)) {
          return dir > 0 ? cz - HALF - EPS : cz + 1 + HALF + EPS;
        }
      }
    }
    return null;
  }

  /** For vertical movement, returns the resolved Y (or null if no hit). */
  _collideY(dy) {
    const b = this._aabb();
    const dir = dy > 0 ? 1 : -1;
    let resolved = null;
    if (dir > 0) {
      const topY = b.maxY;
      const cy = Math.floor(topY);
      for (let cx = Math.floor(b.minX); cx <= Math.floor(b.maxX - 1e-9); cx++) {
        for (let cz = Math.floor(b.minZ); cz <= Math.floor(b.maxZ - 1e-9); cz++) {
          if (this.world.isSolid(cx, cy, cz)) {
            resolved = cy - PLAYER_HEIGHT - EPS;
            break;
          }
        }
      }
    } else {
      const bottomY = b.minY;
      // Falling: scan each column from the top of the AABB down and land on
      // the highest solid cell overlapped (resolves fast falls in one step).
      let highest = -Infinity;
      const topCell = Math.floor(b.maxY - 1e-9);
      for (let cx = Math.floor(b.minX); cx <= Math.floor(b.maxX - 1e-9); cx++) {
        for (let cz = Math.floor(b.minZ); cz <= Math.floor(b.maxZ - 1e-9); cz++) {
          for (let yy = topCell; yy >= Math.floor(bottomY); yy--) {
            if (this.world.isSolid(cx, yy, cz)) {
              if (yy + 1 > highest) highest = yy + 1;
              break;
            }
          }
        }
      }
      if (highest !== -Infinity) resolved = highest + EPS;
    }
    return resolved;
  }

  /** Try to walk up a ledge up to STEP_HEIGHT tall. */
  _tryStep(dx, dz, dt) {
    const saved = this.pos.clone();
    const savedVy = this.vel.y;
    const wasSprinting = this.sprinting;

    // headroom check
    this.pos.y += STEP_HEIGHT + 0.01;
    let headHit = false;
    const b = this._aabb();
    outer: for (let cy = Math.floor(b.minY); cy <= Math.floor(b.maxY - 1e-9); cy++) {
      for (let cx = Math.floor(b.minX); cx <= Math.floor(b.maxX - 1e-9); cx++) {
        for (let cz = Math.floor(b.minZ); cz <= Math.floor(b.maxZ - 1e-9); cz++) {
          if (this.world.isSolid(cx, cy, cz)) { headHit = true; break outer; }
        }
      }
    }
    if (headHit) { this.pos.copy(saved); return; }

    // try horizontal movement again
    this.vel.y = 0;
    if (dx !== 0) {
      this.pos.x += dx;
      const hit = this._collideX(dx);
      if (hit) { this.pos.x = hit; this.vel.x = 0; }
    }
    if (dz !== 0) {
      this.pos.z += dz;
      const hit = this._collideZ(dz);
      if (hit) { this.pos.z = hit; this.vel.z = 0; }
    }
    // fall back down
    const before = this.pos.y;
    this.pos.y -= 10;
    const hitY = this._collideY(-1);
    if (hitY !== null) {
      this.pos.y = hitY;
      this.onGround = true;
    } else {
      this.pos.y = before;
    }

    // only accept if we actually moved forward
    const movedX = Math.abs(this.pos.x - saved.x) > 1e-6;
    const movedZ = Math.abs(this.pos.z - saved.z) > 1e-6;
    if (!movedX && !movedZ) {
      this.pos.copy(saved);
      this.vel.y = savedVy;
      this.sprinting = wasSprinting;
    }
  }
}
