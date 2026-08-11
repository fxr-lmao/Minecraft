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

// Player dimensions (blocks)
export const PLAYER_WIDTH = 0.6; // x/z extent of the AABB
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
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
export const WORLD_MIN_Y = -70;
export const WORLD_MAX_Y = 70; // highest placeable block (the build limit)
export const WORLD_HEIGHT = WORLD_MAX_Y - WORLD_MIN_Y + 1; // 141 layers
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
 */
export const DEEP_RADIUS = 5;

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
