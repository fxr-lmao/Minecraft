// 16×16 item pixel maps. No canvas, no THREE — the tests can load this in
// Node and check every cell without spinning up a WebGL context.
//
// `.` is transparent. Handle letters O/D/M/H are oak. Head letters o/d/m/h
// are the tool's material. Bucket letters o/d/m/h are iron, s/w/b are water.

export const HAFT = {
  O: '#3a2410',
  D: '#5a3818',
  M: '#8a5728',
  H: '#c48642',
};

export const HEAD_WOOD = { o: '#4a3010', d: '#6e4820', m: '#b88848', h: '#e0b060' };
export const HEAD_STONE = { o: '#2a2a2a', d: '#4e4e4e', m: '#8c8c8c', h: '#d0d0d0' };
export const HEAD_IRON = { o: '#3a4046', d: '#6a727a', m: '#c4ccd4', h: '#f4f8fc' };

export const BUCKET_PALETTE = {
  o: '#4a5058',
  d: '#6a7078',
  m: '#9aa2aa',
  h: '#d0d6de',
  s: '#6aa0e8',
  w: '#3a68d0',
  b: '#2448b0',
};

export const STICK_PX = [
  '................',
  '.............OD.',
  '............OMH.',
  '...........OMH..',
  '..........OMH...',
  '.........OMH....',
  '........OMH.....',
  '.......OMH......',
  '......OMH.......',
  '.....OMH........',
  '....OMH.........',
  '...OMH..........',
  '..OMH...........',
  '.OMH............',
  '.OD.............',
  '................',
];

export const PICKAXE_PX = [
  '......oo..oo....',
  '.....odmoodmho..',
  '....odmh..hmmdo.',
  '...odmo....omdo.',
  '...odo......odo.',
  '....o......Odo..',
  '..........OMHo..',
  '.........OMH....',
  '........OMH.....',
  '.......OMH......',
  '......OMH.......',
  '.....OMH........',
  '....OMH.........',
  '...OMH..........',
  '..OD............',
  '................',
];

export const SHOVEL_PX = [
  '..........ooo...',
  '.........odmho..',
  '........odmmhho.',
  '........odmhhdo.',
  '........odmmmdo.',
  '.........oddo...',
  '..........OH....',
  '.........OMH....',
  '........OMH.....',
  '.......OMH......',
  '......OMH.......',
  '.....OMH........',
  '....OMH.........',
  '...OMH..........',
  '..OD............',
  '................',
];

export const BUCKET_PX = [
  '................',
  '.....o....o.....',
  '....o......o....',
  '...o........o...',
  '..ohhhhhhhhhho..',
  '..ohmmmmmmmmdo..',
  '..ohmmmmmmmmdo..',
  '..ohmmmmmmmmdo..',
  '..ohmmmmmmmmdo..',
  '..ohmmmmmmmmdo..',
  '...ohmmmmmmdo...',
  '...ohmmmmmmdo...',
  '....oooooooo....',
  '................',
  '................',
  '................',
];

export const WATER_BUCKET_PX = [
  '................',
  '.....o....o.....',
  '....o......o....',
  '...o........o...',
  '..ohhhhhhhhhho..',
  '..ohssssssssdo..',
  '..ohwwwwwwwwdo..',
  '..ohwwwwwwwwdo..',
  '..ohwwwwwwwwdo..',
  '..ohbbbbbbbbdo..',
  '...obbbbbbbdo...',
  '...obbbbbbbdo...',
  '....oooooooo....',
  '................',
  '................',
  '................',
];

// ---------------------------------------------------------------- new tools
//
// The pickaxe and the shovel above were the whole tool set for as long as
// there was nothing to build one out of. There is now — planks, cobblestone,
// iron out of the furnace and diamond out of the deep — so the other two
// Minecraft shapes are here as well, drawn in the same idiom: haft letters
// O/D/M/H for the oak, head letters o/d/m/h for whatever the head is made of,
// so one 16x16 map serves all four tiers and only the palette changes.

export const HEAD_DIAMOND = { o: '#146a5e', d: '#2aa898', m: '#5ce6d4', h: '#b8fff4' };

/**
 * An axe: the bit is a wedge hanging off the left of the haft's top, which is
 * what tells it apart from the pickaxe at hotbar size. Minecraft's own axe
 * icon is asymmetric for the same reason.
 */
export const AXE_PX = [
  '......oooo......',
  '.....ohhhmo.....',
  '....ohhhmmdo....',
  '....ohhmmmmdo...',
  '....ohmmmmmOHo..',
  '....odmmmmOMH...',
  '.....oddoOMH....',
  '.........OMH....',
  '........OMH.....',
  '.......OMH......',
  '......OMH.......',
  '.....OMH........',
  '....OMH.........',
  '...OMH..........',
  '..OD............',
  '................',
];

/**
 * A sword: a long diagonal blade, a short cross guard, and a stub of a grip.
 * The guard is drawn in haft colours because it is the part your hand knows
 * about — and because a guard in blade colours reads as a kink in the blade.
 */
export const SWORD_PX = [
  '............omh.',
  '...........omhh.',
  '..........omhhd.',
  '.........omhhd..',
  '........omhhd...',
  '.......omhhd....',
  '......omhhd.....',
  '.....omhhd......',
  '....omhhd.......',
  '...oMHMdo.......',
  '..oDMHDo........',
  '...OMHo.........',
  '..OMHo..........',
  '.OMHo...........',
  '.ODo............',
  '................',
];

// ------------------------------------------------------------- materials
//
// The things a tool is made *of*, which until now were blocks in the ground
// and nothing else. Coal comes out of coal ore, raw iron out of iron ore and
// turns into an ingot in the furnace, and a diamond comes out whole. All four
// are lumps rather than shapes, so they are drawn as blobs with a highlight
// on the upper left and the shadow opposite it — the same lighting every
// Minecraft item icon uses, and the reason they read as solid.

export const COAL_PALETTE = { o: '#0b0b0b', d: '#1b1b1b', m: '#2f2f2f', h: '#4d4d4d' };
export const RAW_IRON_PALETTE = { o: '#6b5540', d: '#a3805c', m: '#d4ad84', h: '#f2dcc0' };
export const IRON_INGOT_PALETTE = { o: '#6f6f6f', d: '#9a9a9a', m: '#cfcfcf', h: '#f2f2f2' };
export const DIAMOND_PALETTE = { o: '#12706a', d: '#2fb3a6', m: '#68efe0', h: '#c9fff9' };
// Gold reuses the iron shapes with its own colours, which is exactly what
// Minecraft does: a raw lump and an ingot are the same silhouette whatever
// they are made of, and drawing a second pair of maps to say the same thing
// in yellow would be two more places for the shape to drift.
export const RAW_GOLD_PALETTE = { o: '#7a5a12', d: '#b8891c', m: '#e8c040', h: '#fff0a0' };
export const GOLD_INGOT_PALETTE = { o: '#8a6410', d: '#c39420', m: '#f0cc48', h: '#fff4b0' };
// Redstone is a *dust*, so it takes the coal blob rather than the ingot bar,
// and it is the one material with a glow to it — the highlight is brighter
// than the mid tone by more than the others, which is as close to emissive
// as a vertex colour gets.
export const REDSTONE_PALETTE = { o: '#5a0808', d: '#9c1010', m: '#e02020', h: '#ff6a6a' };
// Gunpowder is a dust too, and takes coal's blob shape with a graphite
// palette — the third colour of the same trick redstone plays. A grey pile
// of it reads as what it is at hotbar size, which is the only size a lump
// is ever drawn at besides a hand.
export const GUNPOWDER_PALETTE = { o: '#2e2a24', d: '#4e463c', m: '#7a7062', h: '#b8ac9a' };
// Rotten flesh is the one material with a shape of its own, because it is
// the one material that is not a mineral: a slab of meat, ragged on every
// edge, red through the middle and brown at the rind.
export const ROTTEN_FLESH_PALETTE = { o: '#4a1208', d: '#7a2a10', m: '#a84a20', h: '#d08050' };

export const COAL_PX = [
  '................',
  '................',
  '.....oooo.......',
  '....ohhmmdo.....',
  '...ohmmmmmdo....',
  '..ohmmmmmmmdo...',
  '..ohmmmmmmmmdo..',
  '.ohmmmmmmmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmmmmmdo..',
  '..oddmmmmmmdo...',
  '...oddmmmmdo....',
  '....oddddo......',
  '.....oooo.......',
  '................',
  '................',
];

export const RAW_IRON_PX = [
  '................',
  '................',
  '......ooo.......',
  '.....ohhmo......',
  '....ohmmmdo.....',
  '...ohmmmmmdo....',
  '..ohmmmmmmmdo...',
  '..ohmmmmmmmmdo..',
  '.ohmmmdmmmmmdo..',
  '.odmmmmmmmmmdo..',
  '.odmmmmmmmmdo...',
  '..oddmmmmmdo....',
  '...oddmmmdo.....',
  '....oddddo......',
  '.....ooo........',
  '................',
];

export const IRON_INGOT_PX = [
  '................',
  '................',
  '................',
  '....oooooooo....',
  '...ohhhhhhhho...',
  '..ohmmmmmmmmho..',
  '..ohmmmmmmmmdo..',
  '.ohmmmmmmmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '.oddddddddddddo.',
  '..oooooooooooo..',
  '................',
  '................',
  '................',
  '................',
];

export const DIAMOND_PX = [
  '................',
  '................',
  '.....oooooo.....',
  '....ohhhhhho....',
  '...ohmmmmmmho...',
  '..ohmmmmmmmmho..',
  '.ohmmmmmmmmmmho.',
  '.odmmmmmmmmmmdo.',
  '..odmmmmmmmmdo..',
  '...odmmmmmmdo...',
  '....odmmmmdo....',
  '.....odmmdo.....',
  '......oddo......',
  '.......oo.......',
  '................',
  '................',
];

export const ROTTEN_FLESH_PX = [
  '................',
  '................',
  '................',
  '...ooo..oo......',
  '..ohhmdodddo....',
  '.ohmmmmmdddo....',
  '.odmmmmmmmmdo...',
  '..odmmmmmmmmdo..',
  '..odmmmmmmmmdo..',
  '..odmmmmmmmmdo..',
  '...odmmmmmmddo..',
  '...odmmmmdddo...',
  '....odddooo.....',
  '.....oddo.......',
  '................',
  '................',
];

// ------------------------------------------------------------------- food
//
// The things you eat. Meat is one slab, raw or cooked, whatever animal it
// came off — Minecraft's own raw porkchop and raw beef are near-identical
// pictures of the same pink slab, and so are these. Chicken is the one meat
// with a shape of its own, because a drumstick is not a steak and the
// difference is the whole reason a cooked chicken looks like a meal. An apple
// is a round fruit with a stem, the only food the trees give for free.

export const RAW_MEAT_PALETTE = { o: '#6a1410', d: '#96221a', m: '#c03a24', h: '#e87850' };
export const COOKED_MEAT_PALETTE = { o: '#4a2610', d: '#7a4420', m: '#b06a30', h: '#e0a058' };
export const CHICKEN_RAW_PALETTE = { o: '#7a2e20', d: '#aa5240', m: '#d6845c', h: '#f2bc9a' };
export const CHICKEN_COOKED_PALETTE = { o: '#5c3c1c', d: '#8a5a28', m: '#c0803e', h: '#eeb864' };
export const APPLE_PALETTE = {
  o: '#5c1006', d: '#a01e0c', m: '#d83a18', h: '#ff7a48', S: '#5a3818',
};

export const STEAK_PX = [
  '................',
  '................',
  '................',
  '....oooooooo....',
  '...ohmmmmmmho...',
  '..ohmmmmmmmmho..',
  '..ohmmmmmmmmho..',
  '.ohmmmmmmmmmmho.',
  '.odmmddmmmmmmdo.',
  '.odmmmmddmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '..odmmmmmmmmdo..',
  '...oddddddddo...',
  '....oooooooo....',
  '................',
];

export const CHICKEN_PX = [
  '................',
  '................',
  '................',
  '.....oooo.......',
  '....ohhhho......',
  '...ohmmmmho.....',
  '..ohmmmmmmho....',
  '..ohmmmmmmho....',
  '..ohmmmmmmdo....',
  '...odmmmmdo.....',
  '....odmmdo......',
  '.....oddo.......',
  '......oo........',
  '................',
  '................',
  '................',
];

export const APPLE_PX = [
  '................',
  '................',
  '................',
  '......SS........',
  '.....SS.........',
  '.....oooo.......',
  '....ohhhho......',
  '...ohmmmmho.....',
  '..ohmmmmmmho....',
  '..ohmmmmmmho....',
  '..ohmmmmmmho....',
  '...odmmmmdo.....',
  '....oddddo......',
  '.....oooo.......',
  '................',
  '................',
];

// -------------------------------------------------------------- ranged gear
//
// The skeleton's leftovers and the spider's, and the things you make from
// them. A bone is white and knobbed at both ends. An arrow is a grey head, a
// straight shaft and a red fletching. A bow is a bent arc. String is a wavy
// line. A spider eye is the one bit of the spider worth keeping — a pale orb
// with a red pupil, which is most of why it reads as an eye at hotbar size.

export const BONE_PALETTE = { o: '#4a4a4a', d: '#7a7a7a', m: '#b0b0b0', h: '#e8e8e8' };
export const BONE_PX = [
  '................',
  '................',
  '................',
  '..oooo...oooo...',
  '.ohhmo...omho...',
  '.ohmmo...omho...',
  '.odmmo...omdo...',
  '.oddooooooodo...',
  '..oooooooooo....',
  '.ohmmo...omho...',
  '.ohmmo...omho...',
  '.odmmo...omdo...',
  '..oooo...oooo...',
  '................',
  '................',
  '................',
];

export const ARROW_PALETTE = {
  o: '#2a2a2a', d: '#4a4a4a', m: '#8a8a8a', h: '#d8d8d8',
  F: '#c01818', W: '#f0d0d0',
};
export const ARROW_PX = [
  '..............mm',
  '.............mhh',
  '............mHdo',
  '...........mMdo.',
  '..........mMdo..',
  '.........mMdo...',
  '........mMdo....',
  '.......mMdo.....',
  '......mMdo......',
  '.....mMdo.......',
  '....mMdo........',
  '...mMdo.........',
  '..mMdo..........',
  '.WFdo...........',
  'Fo..............',
  '................',
];

export const STRING_PALETTE = { o: '#5a4a34', d: '#8a7450', m: '#b8a070', h: '#e8d8b0' };
export const STRING_PX = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..mm..mm..mm....',
  '.m..mm..mm..mm..',
  '................',
  '.mm..mm..mm.....',
  'm..mm..mm..mm...',
  '................',
  '................',
  '................',
  '................',
  '................',
];

export const SPIDER_EYE_PALETTE = { o: '#8a2020', d: '#c0a0a0', m: '#e8d0d0', h: '#f8f0f0', R: '#c01010' };
export const SPIDER_EYE_PX = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......oooo......',
  '.....ohhhho.....',
  '....ohhRRhho....',
  '...ohhRRRRhho...',
  '....ohhRRhho....',
  '.....ohhhho.....',
  '......oooo......',
  '................',
  '................',
  '................',
  '................',
];

export const BOW_PALETTE = { o: '#3a2410', d: '#5a3818', m: '#8a5728', h: '#c48642' };
export const BOW_PX = [
  '................',
  '................',
  '...hh...........',
  '..h.h...........',
  '..h..h..........',
  '.h...h..........',
  '.h...h..........',
  '.h...h..........',
  '.h...h..........',
  '.h...h..........',
  '..h..h..........',
  '..h.h...........',
  '...hh...........',
  '................',
  '................',
  '................',
];

export const FEATHER_PALETTE = { o: '#c8c8c8', d: '#e0e0e0', m: '#f2f2f2', h: '#ffffff', Q: '#8a8a8a' };
export const FEATHER_PX = [
  '................',
  '................',
  '................',
  '.....oooo.......',
  '....ohhhhh......',
  '...ohhhhhho.....',
  '..ohhhhhhhhh....',
  '.ohhhhhhhhhhh...',
  '..ohhhhhhhhh....',
  '...ohhhhhho.....',
  '....ohhhhhh.....',
  '.....oooo.......',
  '......Q.........',
  '......Q.........',
  '................',
  '................',
];

// ------------------------------------------------------------------ armour
//
// Four shapes, one per slot, drawn once and tinted per material the way the
// tools are: the palette letters o/d/m/h mean the same thing everywhere —
// outline, dark, mid, highlight — so a helmet is a helmet whether it is
// leather or diamond, and only the colour changes.

export const ARMOUR_LEATHER = { o: '#4a2c14', d: '#7a4a24', m: '#a86c38', h: '#d8a060' };

export const HELMET_PX = [
  '................',
  '....oooooooo....',
  '...ohhhhhhhho...',
  '..ohhhhhhhhhho..',
  '..ohhmmmmmmhho..',
  '..ohhmmmmmmhho..',
  '..ohhmmmmmmhho..',
  '..ohhhhhhhhhho..',
  '..oddddddddddo..',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

export const CHESTPLATE_PX = [
  '...oo......oo...',
  '..ohho....ohho..',
  '..ohhho..ohhho..',
  '..ohhhhoohhhho..',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhmmmmmmhho..',
  '..ohhmmmmmmhho..',
  '..ohhmmmmmmhho..',
  '..oddddddddddo..',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

export const LEGGINGS_PX = [
  '................',
  '..oo......oo....',
  '..ohho...ohho...',
  '..ohho...ohho...',
  '..ohho...ohho...',
  '..ohho...ohho...',
  '..ohho...ohho...',
  '..oddo...oddo...',
  '..oooo...oooo...',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

export const BOOTS_PX = [
  '................',
  '................',
  '...oooooo.......',
  '..ohhhhhho......',
  '..ohhhhhhhho....',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhhho.',
  '...odddddddddo..',
  '.....oooooooo...',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

// ------------------------------------------------------- the last few foods
//
// A carrot is orange with a green top, a potato is a brown lump (reusing the
// raw-iron blob shape, the same way gold reuses it), a baked potato the same
// lump in a cooked palette, and a golden apple is the apple sprite in gold.

export const CARROT_PALETTE = { o: '#7a2c08', d: '#b04a10', m: '#e06a18', h: '#ff9a40', g: '#3a7a20' };
export const CARROT_PX = [
  '................',
  '......gg........',
  '.....ggg........',
  '......gg........',
  '.....oooo.......',
  '....ohhhho......',
  '...ohmmmmho.....',
  '...ohmmmmho.....',
  '...ohmmmmho.....',
  '....odmmdo......',
  '.....oddo.......',
  '......oo........',
  '................',
  '................',
  '................',
  '................',
];

export const LEATHER_PALETTE = ARMOUR_LEATHER;
export const POTATO_PALETTE = { o: '#5a3a1c', d: '#8a5a2c', m: '#b08040', h: '#d8b060' };
export const BAKED_POTATO_PALETTE = { o: '#6a4420', d: '#9a6430', m: '#c08048', h: '#e8b878' };
export const GOLDEN_APPLE_PALETTE = { o: '#6a5a08', d: '#b8931c', m: '#e8c030', h: '#fff0a0', S: '#5a3818' };

/**
 * Every 16x16 map in this file, by name, so a test can walk the lot and check
 * that each one really is sixteen rows of sixteen characters. A map one
 * character short does not throw — it silently reads `undefined` for the last
 * column and the sprite comes out with a transparent stripe down its right
 * edge, which is exactly the kind of thing nobody notices until it ships.
 */
export const ALL_SPRITES = {
  STICK_PX, PICKAXE_PX, SHOVEL_PX, AXE_PX, SWORD_PX,
  BUCKET_PX, WATER_BUCKET_PX,
  COAL_PX, RAW_IRON_PX, IRON_INGOT_PX, DIAMOND_PX,
  ROTTEN_FLESH_PX,
  STEAK_PX, CHICKEN_PX, APPLE_PX,
  BONE_PX, ARROW_PX, STRING_PX, SPIDER_EYE_PX, BOW_PX, FEATHER_PX,
  HELMET_PX, CHESTPLATE_PX, LEGGINGS_PX, BOOTS_PX,
  CARROT_PX,
};
