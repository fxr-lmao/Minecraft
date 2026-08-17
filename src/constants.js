// Minecraft-accurate movement constants.
// Reference model (Minecraft Java): 20 ticks/second, per-tick values from the wiki:
//   walk acceleration 0.098, sprint x1.3, ground drag 0.546, air drag 0.91,
//   gravity 0.08 blocks/tick^2, jump velocity 0.42 blocks/tick.
// We run physics at a fixed 120 Hz and convert per-tick constants to per-second
// equivalents that reproduce the same terminal speeds and the same response time.

export const TICK_RATE = 20; // Minecraft reference tick rate
export const PHYSICS_HZ = 120; // our fixed physics rate
export const PHYSICS_DT = 1 / PHYSICS_HZ;

export const GRAVITY = 0.08 * TICK_RATE * TICK_RATE; // 32 blocks/s^2

// Jump height target: Minecraft's ~1.2522 blocks
export const JUMP_VELOCITY = 8.95; // blocks/s

// Horizontal speeds (blocks/s) — Minecraft wiki values
export const SPEED_WALK = 4.317;
export const SPEED_SPRINT = 5.612;
export const SPEED_SNEAK = 1.295;
// Airborne terminal speeds (walk/sprint)
export const AIR_WALK = 4.444;
export const AIR_SPRINT = 5.778;

// Drag coefficients (per second), derived from per-tick factors:
//   k = -20 * ln(factor)
export const DRAG_GROUND = -TICK_RATE * Math.log(0.546); // ~12.1 /s
export const DRAG_AIR = -TICK_RATE * Math.log(0.91); // ~1.89 /s

// Water. Minecraft's per-tick water model is drag 0.8 (against 0.546 on the
// ground), acceleration 0.02 — 0.026 sprinting — gravity 0.02, and +0.04 a
// tick while jump is held. Those give the terminal speeds below, which is
// what the continuous model here is tuned to reproduce:
//
//   swim      0.02 / (1 - 0.8)  = 0.10 blocks/tick = 2.0 blocks/s
//   sprint    0.026 / (1 - 0.8) = 0.13             = 2.6
//   sink      0.02 / (1 - 0.8)  = 0.10             = 2.0   (78.4 in air)
//   swim up   (0.8*0.04 - 0.02) / (1 - 0.8) = 0.06 = 1.2
export const DRAG_WATER = -TICK_RATE * Math.log(0.8); // ~4.46 /s
export const SPEED_SWIM = 2.0;
export const SPEED_SWIM_SPRINT = 2.6;
export const SINK_SPEED = 2.0; // terminal fall in water
export const SWIM_UP_SPEED = 1.2; // holding jump under water
/**
 * How fast a current carries you. Minecraft adds 0.014 blocks/tick along the
 * flow every tick, which the same water drag settles at
 * 0.014 / (1 - 0.8) = 0.07 blocks/tick = 1.4 blocks/s — a third of walking
 * pace, enough to notice in a stream and not enough to sweep you away.
 */
export const FLOW_PUSH_SPEED = 1.4;

// Player dimensions (blocks)
export const PLAYER_WIDTH = 0.6; // x/z extent of the AABB
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
/**
 * Swimming. Sprinting in water lays the player out flat, and Minecraft
 * changes the hitbox to match: a 0.6 cube with the eye at 0.4, instead of a
 * 1.8-tall column with the eye at 1.62. It is not cosmetic — it is why you
 * can swim through a one-block gap you could never walk through, and why
 * your view drops to just under the surface the moment you start.
 */
export const SWIM_HEIGHT = 0.6;
export const SWIM_EYE = 0.4;
/**
 * How much of the swim speed goes into climbing or diving when you aim up or
 * down. One: look straight down and you descend as fast as you would have
 * swum forwards, which is Minecraft's behaviour and the reason swimming
 * feels like flying rather than like treading water.
 */
export const SWIM_PITCH_GAIN = 1;
/**
 * Floating. A swimmer settles with their eye on the waterline, and the pull
 * that puts them there fades out over SWIM_FLOAT_RANGE blocks so that it
 * cannot follow you down a dive. SWIM_FLOAT_PULL is per block of error, per
 * second, so half a block under the surface it is worth 1.1 blocks/s.
 */
export const SWIM_FLOAT_RANGE = 1.5;
export const SWIM_FLOAT_PULL = 2.2;
/**
 * How far above the waterline the swimmer's eye settles. Aiming for exactly
 * the surface leaves the camera on the boundary, flickering in and out of the
 * blue; a finger's width above it puts the head out of the water where a
 * swimmer's head belongs, and looking down still dips you under.
 */
export const SWIM_FLOAT_LIFT = 0.15;
/**
 * Hauling yourself out of the water.
 *
 * Swimming up gets you to the surface and no further: at 1.2 blocks/s you
 * leave the water with 1.2 still on the clock, gravity takes 1.2²/64 = 0.022
 * blocks off it, and the bank you are trying to reach is 0.111 above the
 * surface. You are ninety millimetres short, every time, forever — which is
 * why swimming at a shore just bumps you against it.
 *
 * Minecraft's answer is a separate move, in LivingEntity.travel: in water,
 * colliding horizontally, with the hitbox free 0.6 higher, the vertical
 * velocity is *set* to 0.3 blocks/tick. That is the boost that pops you out
 * of a pool, and it needs no jump key — you swim at the edge and you climb
 * out. 0.3 × 20 ticks is the 6 blocks/s below, which carries you half a block
 * clear of the water: comfortably over the lip, and nowhere near a jump.
 *
 * The 0.6 is load-bearing too. Against a cliff the space 0.6 up is solid, so
 * nothing fires and you stay in the water; it is only at the *top* of a wall
 * that the check passes, which is exactly when climbing out is what you meant.
 */
export const WATER_CLIMB_SPEED = 6.0;
export const WATER_CLIMB_LIFT = 0.6;
/** How far ahead the climb looks for somewhere to land, in blocks. */
export const WATER_CLIMB_REACH = 0.35;
// Minecraft's step height. Unused while every block is a full cube (0.6 is
// too low to climb one, so you jump); it is here for slabs and stairs.
export const STEP_HEIGHT = 0.6;

// FOV
export const FOV_BASE = 70;
export const FOV_SPRINT = 84;
export const FOV_SNEAK = 60;

// World — infinite in x/z, streamed as chunks
export const CHUNK_SIZE = 32; // blocks per chunk side
/**
 * Vertical range, Minecraft-style: the world extends well below y = 0 for
 * caves, and well above the terrain for building. Bedrock seals the floor at
 * WORLD_MIN_Y and nothing can be placed above WORLD_MAX_Y.
 *
 * Block arrays and mesh vertices are indexed by *layer* (y - WORLD_MIN_Y,
 * always 0..WORLD_HEIGHT-1) so they stay non-negative and still fit in a
 * byte; `y` on its own always means the world coordinate the player sees.
 */
export const WORLD_MIN_Y = -64; // Minecraft's floor
/**
 * 255 layers, and that number is a hard ceiling rather than a preference:
 * mesh vertex positions are packed into single bytes, and a block at the top
 * layer needs a vertex one above it, so layer + 1 must still fit in 255.
 * Going higher means widening every position attribute — 3 bytes a vertex to
 * 6 — for headroom nobody builds into.
 */
export const WORLD_HEIGHT = 255;
export const WORLD_MAX_Y = WORLD_MIN_Y + WORLD_HEIGHT - 1; // 190, the build limit
/** Convert a world y to its layer index, and back. */
export const toLayer = (y) => y - WORLD_MIN_Y;
export const fromLayer = (layer) => layer + WORLD_MIN_Y;
export const WORLD_SEED = 1337;
// Render distance in chunks (a chunk is CHUNK_SIZE blocks across).
export const RENDER_DISTANCE_MIN = 2;
export const RENDER_DISTANCE_MAX = 40;
export const RENDER_DISTANCE_DEFAULT = 4;
/**
 * How far block data is kept in memory, in chunks. Meshes reach out to the
 * render distance, but the *voxel data* behind them is only needed for
 * collision and for meshing, both of which happen near the player. Keeping
 * data on a small radius is what stops a 40-chunk render distance from
 * holding 300 MB of block arrays: regenerating a chunk costs 0.03 ms, so
 * dropping and rebuilding them is far cheaper than keeping them.
 */
export const DATA_RADIUS = 6;
/**
 * How close a chunk must be for its caves to be meshed at all. Beyond this
 * only the terrain shell is built — the underside of the world is sealed, so
 * there is nothing down there anyone can see. This is what stops caves from
 * doubling the geometry at every render distance.
 *
 * A cave chunk costs ~16 ms to mesh against a shell chunk's ~5, so this
 * radius is deliberately small: 4 chunks is still 128 blocks of cave around
 * you, further than you can see underground.
 */
export const DEEP_RADIUS = 4;

export const BLOCK_SIZE = 1;

// Interaction
export const REACH = 5; // blocks the player can break/place at (creative reach)

// Camera perspectives (F5 / V cycles through these, like Minecraft)
export const VIEW_FIRST = 0;
export const VIEW_THIRD_BACK = 1;
export const VIEW_THIRD_FRONT = 2;
export const VIEW_NAMES = ['First person', 'Third person (back)', 'Third person (front)'];
export const THIRD_PERSON_DISTANCE = 4; // blocks behind/in front of the head
export const THIRD_PERSON_MIN = 1.5;
export const THIRD_PERSON_MAX = 8;
export const SHOULDER_OFFSET = 0.45; // camera sits off to the side of the head
