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

import * as THREE from '../vendor/three.module.min.js';
import {
  GRAVITY, JUMP_VELOCITY,
  SPEED_WALK, SPEED_SNEAK, AIR_WALK,
  DRAG_GROUND, DRAG_AIR, DRAG_ICE,
  PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_EYE,
  SWIM_HEIGHT, SWIM_EYE, SWIM_PITCH_GAIN,
  SWIM_FLOAT_RANGE, SWIM_FLOAT_PULL, SWIM_FLOAT_LIFT,
  WATER_CLIMB_SPEED, WATER_CLIMB_LIFT, WATER_CLIMB_REACH,
  WORLD_MIN_Y,
  DRAG_WATER, SPEED_SWIM, SPEED_SWIM_SPRINT, SINK_SPEED, SWIM_UP_SPEED,
  FLOW_PUSH_SPEED,
} from './constants.js';
import { lookVector } from './view.js';
import { isWater, waterHeight, isIce, AIR } from './terrain.js';
import { fluidFlow } from './water-mesh.js';

const HALF = PLAYER_WIDTH / 2;
const EPS = 1e-4;
const TERMINAL_FALL = 78.4; // blocks/s (Minecraft's fall terminal velocity)
/** How far up a column the buoyancy looks for the open surface, in blocks. */
const SURFACE_SEARCH = 24;
/**
 * Backstop for falling out of the world. It must sit *below* the bedrock
 * floor, never at a depth the player can legitimately dig to — this was a
 * hard-coded -32 from when the world bottomed out at y = 0, which meant that
 * mining down past -32 teleported you back to the surface.
 */
const FALL_RESPAWN_Y = WORLD_MIN_Y - 16;
/** The four corners of the hitbox, as signed half-widths. */
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

export class Player {
  constructor(world) {
    this.world = world;
    const spawn = world.spawnPoint();
    this.spawn = new THREE.Vector3(spawn.x, spawn.y + 0.01, spawn.z);
    this.pos = this.spawn.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // facing -Z at yaw 0; start facing +Z toward world center
    this.pitch = 0;

    this.onGround = false;
    /**
     * Standing on ice, which keeps the same top speed and takes five times
     * as long to lose it: the slide is the whole of what ice feels like.
     */
    this.onIce = false;
    this.sprinting = false;
    this.sneaking = false;
    /**
     * Swimming: the flat-out crawl you get by sprinting in water, not the
     * bobbing about you do by walking into it. While it is on the hitbox is a
     * 0.6 cube, the eye is at 0.4, and the direction you are looking is the
     * direction you go — including up and down.
     */
    this.swimming = false;
    /** The height of the hitbox right now; swimming shrinks it. */
    this.height = PLAYER_HEIGHT;
    /**
     * Hop single blocks automatically (Minecraft Bedrock's "auto jump", on by
     * default there too). Generated terrain steps up a block every few paces,
     * and without this you spend the whole time tapping space. It triggers a
     * perfectly ordinary jump — no teleporting, no bespoke step physics.
     */
    this.autoJump = true;

    this.horizontalSpeed = 0; // for head bob + HUD
    /** True while the player's feet are in water. */
    this.inWater = false;
    /** True while the head is under too — no air, and no jumping out. */
    this.submerged = false;
    /** The current where the player is standing, as a unit vector + speed. */
    this.flow = new Float64Array(2);
    this.flowSpeed = 0;
    /** Where the open surface of the water above us is, or -Infinity. */
    this.waterTop = -Infinity;
    // Bound once: the fluid maths takes a sampler, and rebuilding the closure
    // every physics step would allocate 120 of them a second.
    this._get = (x, y, z) => this.world.get(x, y, z);
  }

  get eyeHeight() {
    return this.swimming ? SWIM_EYE : PLAYER_EYE;
  }

  /** Camera position (eye). */
  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  /** Back to the spawn point. */
  respawn() {
    this.pos.copy(this.spawn);
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.onIce = false;
  }

  /** Horizontal forward vector from yaw (camera forward projected on XZ). */
  forwardVector() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Horizontal right vector from yaw. */
  rightVector() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Full look direction (yaw + pitch) — what the crosshair points at. */
  lookDirection() {
    return lookVector(this.yaw, this.pitch);
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
    this._sampleWater();

    // ---- sprint bookkeeping ----
    // Sprinting requires forward intent; releasing W or sneaking cancels it.
    if (input.sneak || !input.forward) {
      this.sprinting = false;
      this.sneaking = input.sneak;
    } else {
      this.sneaking = false;
      // On the ground you have to be standing on something to break into a
      // run. In water there is nothing to push off, so being *in* it is
      // enough — otherwise you could never start swimming out of your depth,
      // which is the only place swimming is any use.
      if (input.sprint && !this.sprinting && (this.onGround || this.inWater)) {
        this.sprinting = true;
      }
    }

    // ---- swimming ----
    //
    // Minecraft asks two different questions here and I had only implemented
    // one of them, which is why sprinting through an ankle-deep puddle threw
    // you flat on your face in it.
    //
    // To *start*, your eyes have to be under: `updateSwimming` tests
    // `isUnderWater`, not `isInWater`. That is the whole puddle fix — a
    // one-block puddle stands 8/9 high and your eye is at 1.62, so it never
    // qualifies, and you run straight through it. Wading into the sea, on the
    // other hand, takes you deeper until your head goes under, and that is
    // the moment the crawl begins.
    //
    // To *keep going*, merely being in it is enough. Without that asymmetry a
    // swimmer at the surface — where the float holds them, head out — would
    // stand bolt upright every time they came up for air, and a flooded
    // one-block tunnel could never be swum down at all.
    this._setSwimming(this.sprinting && (this.swimming ? this.inWater : this.submerged));

    const moveDir = this._inputDirection(input);

    // ---- horizontal acceleration (Minecraft recurrence, dt-scaled) ----
    // Water replaces both the drag and the target speed: it is thicker than
    // air, so you accelerate to a third of walking pace and coast to a stop
    // much faster.
    const grounded = this.onGround;
    this.onIce = grounded && !this.inWater && isIce(this._groundBlock());
    const k = this.inWater
      ? DRAG_WATER
      : (grounded ? (this.onIce ? DRAG_ICE : DRAG_GROUND) : DRAG_AIR);
    const f = Math.exp(-k * dt); // per-step velocity retention factor

    // Base target speed; sprint multiplies acceleration by 1.3 (like MC),
    // so the terminal speed becomes 5.612 (ground) / 5.778 (air).
    let target;
    if (this.inWater) target = this.sprinting ? SPEED_SWIM_SPRINT : SPEED_SWIM;
    else if (grounded) target = this.sneaking ? SPEED_SNEAK : SPEED_WALK;
    else target = AIR_WALK;

    const hasInput = moveDir.lengthSq() > 0;
    if (hasInput) {
      // Swimming has no separate sprint multiplier — the sprint speed above
      // already is Minecraft's swim-sprint terminal.
      const a = target * (1 - f) * (this.sprinting && !this.inWater ? 1.3 : 1);
      this.vel.x = this.vel.x * f + moveDir.x * a;
      this.vel.z = this.vel.z * f + moveDir.z * a;
    } else {
      this.vel.x *= f;
      this.vel.z *= f;
    }

    // A current carries you whether you are swimming with it or not, and it
    // settles at the same terminal speed the same drag gives everything else
    // in water. Standing in a stream and being pushed downhill is most of
    // what tells you the water is moving.
    if (this.inWater && this.flowSpeed > 0) {
      const push = FLOW_PUSH_SPEED * (1 - f);
      this.vel.x += this.flow[0] * push;
      this.vel.z += this.flow[1] * push;
    }

    const wasGrounded = this.onGround;
    this.onGround = false;

    // ---- vertical ----
    if (this.inWater) {
      // Sinking, rising and jumping all settle to their Minecraft terminal
      // speeds under the same water drag, so the numbers below are the
      // speeds themselves rather than accelerations.
      const rising = input.jump;
      let settle = rising ? SWIM_UP_SPEED : -SINK_SPEED;
      if (this.swimming && !rising && hasInput) {
        // A swimmer goes where they are pointed. moveDir is the full look
        // vector here, so aiming down dives and aiming up surfaces, at the
        // same speed the same stroke would have carried you forwards, and
        // level means level.
        settle = moveDir.y * target * SWIM_PITCH_GAIN + this._buoyancy();
      }
      this.vel.y = settle + (this.vel.y - settle) * f;
      // Breaking the surface with jump held turns the swim into a real jump,
      // which is what gets you out onto the bank.
      if (rising && !this.submerged && wasGrounded) this.vel.y = JUMP_VELOCITY;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -TERMINAL_FALL) this.vel.y = -TERMINAL_FALL;
      if (input.jump && wasGrounded) this.vel.y = JUMP_VELOCITY;
    }

    // ---- integrate + collide (axis separated, with auto-step) ----
    const moved = this._moveWithCollision(dt);

    // Climbing out. Swimming up cannot do it — it tops out at the surface,
    // and the bank is above the surface — so pushing against the edge is its
    // own move, exactly as it is in Minecraft. No jump key: you swim at the
    // shore and you haul yourself onto it.
    if (this.inWater && moved.blockedHorizontal && this._canClimbOut(moveDir)) {
      this.vel.y = WATER_CLIMB_SPEED;
    }

    // Auto jump: bumped a block while walking, and a single hop clears it.
    // In water the climb above handles it, so it stays out of the way.
    if (this.autoJump && !this.inWater
        && moved.blockedHorizontal && this.onGround && moveDir.lengthSq() > 0
        && this._canHopOver(moveDir)) {
      this.vel.y = JUMP_VELOCITY;
      this.onGround = false;
    } else if (this.sprinting && moved.blockedHorizontal && this.onGround) {
      // Sprinting into a wall you cannot hop cancels the sprint (like Minecraft)
      this.sprinting = false;
    }

    // The world is infinite: no border to clamp against. Falling out is
    // still impossible (bedrock seals WORLD_MIN_Y), but keep the respawn as
    // a backstop in case anything ever puts the player under the floor.
    if (this.pos.y < FALL_RESPAWN_Y) {
      this.respawn();
    }

    this.horizontalSpeed = Math.hypot(this.vel.x, this.vel.z);
  }

  /**
   * Is the player in water, and how deep? Feet decide the physics; the head
   * decides whether a jump can still launch you out.
   *
   * The test is against the fluid *surface*, not the cell: the last block of a
   * spread is a ninth of a block deep and you walk through it, while the same
   * cell full to the brim is water you swim in. Minecraft compares the
   * surface height to the bottom of your hitbox, and so does this.
   */
  /**
   * Enter or leave the swimming pose.
   *
   * Leaving is the half that can fail. The swimming hitbox is 0.6 tall, so
   * you can be somewhere a 1.8-tall one does not fit — under an overhang, in
   * a flooded tunnel — and standing up there would put your head inside a
   * block. Minecraft keeps you swimming until there is room, and so does
   * this: without the check, letting go of sprint in a submerged corridor
   * teleports you through the ceiling.
   */
  _setSwimming(want) {
    if (want === this.swimming) return;
    if (!want && !this._canStand()) return;
    this.swimming = want;
    this.height = want ? SWIM_HEIGHT : PLAYER_HEIGHT;
  }

  /**
   * The pull that keeps a swimmer at the waterline, in blocks/second.
   *
   * It is a spring, and it only exists within SWIM_FLOAT_RANGE of the
   * surface. That matters both ways round: near the top it holds you there,
   * so cruising along level does not slowly drown you; a metre and a half
   * down it is gone, so aiming into a dive takes you down and *keeps* you
   * down instead of being reeled back up by a buoyancy that never lets go.
   */
  _buoyancy() {
    if (this.waterTop === -Infinity) return 0;
    const toSurface = this.waterTop - SWIM_EYE + SWIM_FLOAT_LIFT - this.pos.y;
    const near = Math.max(0, 1 - Math.abs(toSurface) / SWIM_FLOAT_RANGE);
    return toSurface * SWIM_FLOAT_PULL * near;
  }

  /**
   * Would the hitbox fit if it were moved by this offset, and was `height`
   * tall? Every "is there room to..." question in here is this question.
   */
  _boxFree(ox, oy, oz, height) {
    const x = this.pos.x + ox;
    const y = this.pos.y + oy;
    const z = this.pos.z + oz;
    const maxX = Math.floor(x + HALF - 1e-9);
    const maxZ = Math.floor(z + HALF - 1e-9);
    const top = Math.floor(y + height - 1e-9);
    for (let cy = Math.floor(y); cy <= top; cy++) {
      for (let cx = Math.floor(x - HALF); cx <= maxX; cx++) {
        for (let cz = Math.floor(z - HALF); cz <= maxZ; cz++) {
          if (this.world.isSolid(cx, cy, cz)) return false;
        }
      }
    }
    return true;
  }

  /** Is there room for the full-height hitbox where we are standing? */
  _canStand() {
    return this._boxFree(0, 0, 0, PLAYER_HEIGHT);
  }

  /**
   * Are we pushing against something we could climb onto?
   *
   * Two probes, because one is not enough either way round. Straight up,
   * because a boost into an overhang is a knock on the head rather than a way
   * out. And forward, because the point of the boost is to land on the thing
   * being pushed against — the reach is a little more than the hitbox's half
   * width, so the probe straddles the edge and sits over the bank rather than
   * over the water it came from.
   */
  _canClimbOut(moveDir) {
    const len = Math.hypot(moveDir.x, moveDir.z);
    if (len === 0) return false;
    const h = this.height;
    if (!this._boxFree(0, WATER_CLIMB_LIFT, 0, h)) return false;
    const ax = (moveDir.x / len) * WATER_CLIMB_REACH;
    const az = (moveDir.z / len) * WATER_CLIMB_REACH;
    return this._boxFree(ax, WATER_CLIMB_LIFT, az, h);
  }

  _sampleWater() {
    const x = Math.floor(this.pos.x);
    const z = Math.floor(this.pos.z);
    const feet = this.pos.y;
    const eye = this.pos.y + this.eyeHeight;
    this.inWater = this._fluidTop(x, Math.floor(feet), z) >= feet;
    this.submerged = this._fluidTop(x, Math.floor(eye), z) >= eye;

    this.flowSpeed = 0;
    this.flow[0] = 0;
    this.flow[1] = 0;
    this.waterTop = -Infinity;
    if (this.inWater) {
      const fy = Math.floor(feet);
      const id = this.world.get(x, fy, z);
      this.flowSpeed = fluidFlow(this._get, x, fy, z, id, this.flow);
      this.waterTop = this._surfaceAbove(x, fy, z);
    }
  }

  /**
   * The open surface of the column we are in: climb until the water runs out.
   * Capped, because a swimmer under a hundred blocks of ocean does not care
   * where the top is — nothing that uses this reaches that far.
   */
  _surfaceAbove(x, y, z) {
    for (let i = 0; i < SURFACE_SEARCH; i++) {
      const top = this._fluidTop(x, y + i, z);
      if (top !== -Infinity && top < y + i + 1) return top; // the free surface
      if (!isWater(this.world.get(x, y + i, z))) return y + i; // ran out of water
    }
    return y + SURFACE_SEARCH;
  }

  /** How high the water stands in a cell, or -Infinity if it holds none. */
  _fluidTop(x, y, z) {
    const id = this.world.get(x, y, z);
    if (!isWater(id)) return -Infinity;
    return y + waterHeight(id, isWater(this.world.get(x, y + 1, z)));
  }

  _inputDirection(input) {
    const dir = new THREE.Vector3();
    // Swimming steers in three dimensions: forward is wherever the crosshair
    // is pointing, pitch included. Walking only ever uses the flattened
    // version of it, or looking at your feet would slow you down.
    const forward = this.swimming ? this.lookDirection() : this.forwardVector();
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
      if (hit !== null) { this.pos.x = hit; this.vel.x = 0; blockedX = true; }
    }
    // Z axis
    if (dz !== 0) {
      this.pos.z += dz;
      const hit = this._collideZ(dz);
      if (hit !== null) { this.pos.z = hit; this.vel.z = 0; blockedZ = true; }
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

    // Sliding along a wall falls out of the axis-separated resolve above:
    // the blocked axis stops, the free axis keeps moving.
    return { blockedHorizontal: blockedX || blockedZ };
  }

  /**
   * What we are standing on, which on ice is the whole difference between
   * walking and sliding.
   *
   * The centre answers it almost always; the corners are there for the case
   * it gets wrong, which is standing on the lip of a block with your middle
   * out over the drop. Minecraft asks the same question the same way round.
   */
  _groundBlock() {
    const feet = Math.floor(this.pos.y + EPS) - 1;
    const middle = this.world.get(Math.floor(this.pos.x), feet, Math.floor(this.pos.z));
    if (middle !== AIR) return middle;
    for (const [ox, oz] of CORNERS) {
      const id = this.world.get(
        Math.floor(this.pos.x + ox * (HALF - EPS)), feet, Math.floor(this.pos.z + oz * (HALF - EPS))
      );
      if (id !== AIR) return id;
    }
    return AIR;
  }

  /**
   * Is the thing we just walked into exactly one block tall, with room above
   * for us to land on it? Probes just beyond the player's box in the
   * direction of travel.
   */
  _canHopOver(moveDir) {
    const feet = Math.floor(this.pos.y + 1e-4);
    // Head room for the jump itself: nothing directly above us.
    if (this.world.isSolid(Math.floor(this.pos.x), feet + 2, Math.floor(this.pos.z))) return false;

    // Check straight ahead, and each axis on its own, so hopping still works
    // when sliding along a wall at an angle.
    const dirs = [[moveDir.x, moveDir.z], [moveDir.x, 0], [0, moveDir.z]];
    for (const [dx, dz] of dirs) {
      if (dx === 0 && dz === 0) continue;
      const len = Math.hypot(dx, dz);
      const ax = this.pos.x + (dx / len) * (HALF + 0.2);
      const az = this.pos.z + (dz / len) * (HALF + 0.2);
      const cx = Math.floor(ax);
      const cz = Math.floor(az);
      const blocked = this.world.isSolid(cx, feet, cz);
      const clearAbove = !this.world.isSolid(cx, feet + 1, cz)
        && !this.world.isSolid(cx, feet + 2, cz);
      if (blocked && clearAbove) return true;
    }
    return false;
  }

  /** Returns the AABB min/max as {minX, maxX, minY, maxY, minZ, maxZ}. */
  _aabb() {
    return {
      minX: this.pos.x - HALF, maxX: this.pos.x + HALF,
      minY: this.pos.y, maxY: this.pos.y + this.height,
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
            resolved = cy - this.height - EPS;
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

  // There is deliberately no auto-step here.
  //
  // Every block in this world is a full 1.0 cube and Minecraft's step height
  // is 0.6, so a step-up can never succeed anyway — you jump onto a block,
  // exactly like the real game. The previous attempt at one was also the
  // source of a nasty bug: it moved the player 10 blocks down to "fall back
  // to the surface", but the downward resolve only inspects the cells the
  // player's own box overlaps. Ten blocks below the surface that box is
  // under the world, where every cell reports solid (the world is sealed
  // from below), so the player was planted at y = -3 — inside the void.
  // It fired whenever one axis was blocked and the other was free, i.e.
  // every time you ran along a wall at an angle.
  //
  // When partial blocks (slabs, stairs) arrive, a step-up will be needed
  // again: raise by the step height, retry the horizontal move, then resolve
  // downward by *at most* the step height — never by an unbounded drop.
}
