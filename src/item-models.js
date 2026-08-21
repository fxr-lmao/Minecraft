// Which model each item is, and how it sits in a hand.
//
// Two tables, and the split between them is the point of the file.
//
// MODEL_SPECS says what an item *is* — an extruded sprite, a box model, or a
// block. That is a property of the item and nothing else.
//
// POSES says where it goes once something is holding it. That is a property
// of the *hand*, and there are three of them: the first-person view, the
// avatar's fist in third person, and (eventually) an item lying on the
// ground. A tool is held differently from a block, which is held differently
// from a bucket, and getting that wrong is the difference between a pickaxe
// you are carrying and a pickaxe that is orbiting your wrist.
//
// Both are pure data, which is the whole reason they are here rather than in
// the renderer: a pose is four numbers and a scale, and four numbers that
// nobody can check are four numbers that will be wrong.

import {
  BUCKET, WATER_BUCKET, STICKS,
  COAL, RAW_IRON, IRON_INGOT, DIAMOND, RAW_GOLD, GOLD_INGOT, REDSTONE,
  GUNPOWDER, ROTTEN_FLESH,
  TOOL_KINDS, ITEM_SHAPES, isItem,
  SHAPE_PICKAXE, SHAPE_SHOVEL, SHAPE_AXE, SHAPE_SWORD,
  SHAPE_BUCKET, SHAPE_STICK, SHAPE_LUMP,
  TIER_WOOD, TIER_STONE, TIER_IRON, TIER_DIAMOND,
} from './items.js';
import {
  HAFT, HEAD_WOOD, HEAD_STONE, HEAD_IRON, HEAD_DIAMOND,
  PICKAXE_PX, SHOVEL_PX, AXE_PX, SWORD_PX, STICK_PX,
  COAL_PX, RAW_IRON_PX, IRON_INGOT_PX, DIAMOND_PX,
  COAL_PALETTE, RAW_IRON_PALETTE, IRON_INGOT_PALETTE, DIAMOND_PALETTE,
  RAW_GOLD_PALETTE, GOLD_INGOT_PALETTE, REDSTONE_PALETTE,
  GUNPOWDER_PALETTE, ROTTEN_FLESH_PALETTE, ROTTEN_FLESH_PX,
} from './item-sprites.js';

/** The head palette for each tier. */
export const TIER_PALETTES = {
  [TIER_WOOD]: HEAD_WOOD,
  [TIER_STONE]: HEAD_STONE,
  [TIER_IRON]: HEAD_IRON,
  [TIER_DIAMOND]: HEAD_DIAMOND,
};

/** The sprite map for each tool shape. */
export const SHAPE_SPRITES = {
  [SHAPE_PICKAXE]: PICKAXE_PX,
  [SHAPE_SHOVEL]: SHOVEL_PX,
  [SHAPE_AXE]: AXE_PX,
  [SHAPE_SWORD]: SWORD_PX,
};

/**
 * How thick each shape is, in sixteenths.
 *
 * Minecraft makes every item exactly one texel deep and it is right to,
 * because every item is a picture of itself. These are not all pictures. A
 * sword blade genuinely is thin and looks wrong at two texels; an axe head is
 * a wedge of iron and looks like a sticker at one. The numbers are small and
 * they are the difference between "a flat thing seen at an angle" and "a
 * thing".
 */
export const SHAPE_DEPTH = {
  [SHAPE_PICKAXE]: 2 / 16,
  [SHAPE_SHOVEL]: 2 / 16,
  [SHAPE_AXE]: 2.5 / 16,
  [SHAPE_SWORD]: 1.5 / 16,
  [SHAPE_STICK]: 1.5 / 16,
  [SHAPE_LUMP]: 3 / 16,
};

/** The lumps: sprite and palette per id. */
const LUMP_SPRITES = {
  [COAL]: [COAL_PX, COAL_PALETTE],
  [RAW_IRON]: [RAW_IRON_PX, RAW_IRON_PALETTE],
  [IRON_INGOT]: [IRON_INGOT_PX, IRON_INGOT_PALETTE],
  [DIAMOND]: [DIAMOND_PX, DIAMOND_PALETTE],
  // Gold borrows iron's two shapes, redstone borrows coal's blob. Same
  // silhouette, different palette — see the note in item-sprites.js.
  [RAW_GOLD]: [RAW_IRON_PX, RAW_GOLD_PALETTE],
  [GOLD_INGOT]: [IRON_INGOT_PX, GOLD_INGOT_PALETTE],
  [REDSTONE]: [COAL_PX, REDSTONE_PALETTE],
  // Gunpowder plays the same trick a third time. Rotten flesh is the one
  // lump with its own map, because meat is not a mineral and neither is
  // the shape of it.
  [GUNPOWDER]: [COAL_PX, GUNPOWDER_PALETTE],
  [ROTTEN_FLESH]: [ROTTEN_FLESH_PX, ROTTEN_FLESH_PALETTE],
};

/**
 * The model spec for an item id, or null for a block (which is a cube and
 * needs nothing said about it).
 *
 * A spec is one of:
 *   { kind: 'sprite', rows, palette, depth, mirrorX }
 *   { kind: 'bucket', full }
 */
export function modelSpec(id) {
  const shape = ITEM_SHAPES[id];
  if (!shape) return null;

  if (shape === SHAPE_BUCKET) {
    return { kind: 'bucket', full: id === WATER_BUCKET, shape };
  }

  if (shape === SHAPE_STICK) {
    return {
      kind: 'sprite', shape, rows: STICK_PX, palette: HAFT,
      depth: SHAPE_DEPTH[SHAPE_STICK], mirrorX: true,
    };
  }

  if (shape === SHAPE_LUMP) {
    const [rows, palette] = LUMP_SPRITES[id];
    return { kind: 'sprite', shape, rows, palette, depth: SHAPE_DEPTH[SHAPE_LUMP], mirrorX: false };
  }

  const kind = TOOL_KINDS[id];
  if (!kind) return null;
  return {
    kind: 'sprite',
    shape,
    tier: kind.tier,
    rows: SHAPE_SPRITES[shape],
    palette: { ...HAFT, ...TIER_PALETTES[kind.tier] },
    depth: SHAPE_DEPTH[shape],
    // Tools are drawn haft-down-left in their icons and held haft-down-right
    // in a hand. See held-geometry.js for why this is a pixel mirror rather
    // than a rotation.
    mirrorX: true,
  };
}

// --------------------------------------------------------------------- poses
//
// A pose is:
//   { pos: [x, y, z], rot: [x, y, z], scale }
//
// in the coordinate space of whatever is holding the thing. For the
// first-person view that is a frame pinned to the bottom-right of the screen,
// with -z into the scene; for the avatar it is the hand socket on the right
// wrist, which is already rotated to the fist's angle.
//
// The numbers below were arrived at by holding each one and turning around,
// which is the only way there is. What they encode:
//
//   * A tool is gripped near the *bottom* of its haft, not at its centre. A
//     model centred on the origin and dropped into a fist has the fist
//     halfway up the handle, which looks like carrying a pickaxe by the neck.
//     Hence the y offsets: they slide the grip to the socket.
//   * Everything is tilted so the working end points up and away. Minecraft
//     holds a tool at roughly 45 degrees off the screen plane and so does
//     this, because at 0 degrees the tool covers the crosshair and at 90 it
//     is a line.
//   * Blocks are the exception and always were: a block is held in the fist
//     as a cube, at Minecraft's own angle, and the pose is the one the game
//     already used before any of this existed.

export const POSE_KIND_BLOCK = 'block';
export const POSE_KIND_TOOL = 'tool';
export const POSE_KIND_BUCKET = 'bucket';
export const POSE_KIND_FLAT = 'flat';

/** Which pose family an id belongs to. */
export function poseKind(id) {
  if (!isItem(id)) return POSE_KIND_BLOCK;
  const shape = ITEM_SHAPES[id];
  if (shape === SHAPE_BUCKET) return POSE_KIND_BUCKET;
  if (TOOL_KINDS[id]) return POSE_KIND_TOOL;
  return POSE_KIND_FLAT;
}

/**
 * First-person poses, in the held-item frame: +x right, +y up, -z forward.
 * The frame's origin is pinned to the bottom-right corner every frame (see
 * positionHeldItem in main.js), so these are offsets from that corner and are
 * in units of the item's own size — which is what keeps a sword the same
 * distance from the edge of the screen on a phone and on a monitor.
 */
export const FIRST_PERSON_POSES = {
  [POSE_KIND_BLOCK]: {
    pos: [0, 0, 0],
    rot: [0.12, -0.6, 0.1],
    scale: 1,
  },
  [POSE_KIND_TOOL]: {
    // Down and right a little further than a block, because a tool is longer
    // than it is wide and its head would otherwise sit in the middle of the
    // screen. Rolled so the haft runs out of the bottom-right corner, which
    // is where a hand is.
    pos: [0.06, -0.10, 0.06],
    rot: [0.22, -0.44, -0.72],
    scale: 1.28,
  },
  [POSE_KIND_BUCKET]: {
    // A bucket is carried upright — it has water in it — so it gets almost no
    // roll, and it sits low enough that you can see down into it.
    pos: [0.02, -0.06, 0.04],
    rot: [0.18, -0.52, -0.06],
    scale: 1.06,
  },
  [POSE_KIND_FLAT]: {
    pos: [0.02, -0.02, 0.02],
    rot: [0.10, -0.55, -0.20],
    scale: 1.0,
  },
};

/**
 * Third-person poses, in the avatar's hand socket. The socket is already at
 * the fist and already rotated to the arm's angle, so these are small
 * corrections on top of it.
 *
 * The scales are the interesting part. In first person an item is drawn a
 * hand's width from the lens and can be any size at all; on the avatar it has
 * to be the size a real one would be, next to a body that is 1.8 blocks tall.
 * Minecraft's held block is about 0.4 of a block cube; a tool is about 0.9 of
 * a block long, which on this model comes out at these numbers.
 */
export const THIRD_PERSON_POSES = {
  [POSE_KIND_BLOCK]: {
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: 0.46,
  },
  [POSE_KIND_TOOL]: {
    // Slid down the haft so the fist is at the grip, and rolled to lie along
    // the forearm rather than sticking out sideways from the knuckles.
    pos: [0, -0.16, 0.02],
    rot: [0.15, 0, -0.55],
    scale: 0.78,
  },
  [POSE_KIND_BUCKET]: {
    // Hanging from the hand, and kept upright: the handle is at the top of
    // the model, so the grip point is above centre.
    pos: [0, -0.20, 0],
    rot: [0, 0, 0],
    scale: 0.5,
  },
  [POSE_KIND_FLAT]: {
    pos: [0, -0.05, 0],
    rot: [0.1, 0, -0.3],
    scale: 0.42,
  },
};

/**
 * A tool's grip point, as a fraction of its height measured from the bottom.
 *
 * The pose offsets above put the grip in the fist for the common case, but a
 * sword is gripped a fifth of the way up and a shovel a third, and using one
 * number for both leaves the sword floating. This is what the avatar's socket
 * actually reads.
 */
export const GRIP_HEIGHT = {
  [SHAPE_PICKAXE]: 0.22,
  [SHAPE_SHOVEL]: 0.24,
  [SHAPE_AXE]: 0.20,
  [SHAPE_SWORD]: 0.18,
  [SHAPE_STICK]: 0.30,
  [SHAPE_BUCKET]: 0.75,
  [SHAPE_LUMP]: 0.5,
};

/** The first-person pose for an id. */
export const firstPersonPose = (id) => FIRST_PERSON_POSES[poseKind(id)];

/** The third-person pose for an id. */
export const thirdPersonPose = (id) => THIRD_PERSON_POSES[poseKind(id)];

/**
 * Every item that has a three-dimensional model, for the tests and for the
 * warm-up pass that builds them all before the first frame rather than
 * hitching the first time you scroll onto one.
 */
export const MODELLED_ITEMS = Object.keys(ITEM_SHAPES).map(Number);

/**
 * Does this item swing like a tool?
 *
 * Blocks and lumps are *placed* or thrown; a tool is swung, and the swing is
 * a different animation — further through, and with a wrist snap at the end
 * of it. The distinction is here rather than in the animator because it is a
 * property of the item.
 */
export function swingsLikeTool(id) {
  return poseKind(id) === POSE_KIND_TOOL;
}
