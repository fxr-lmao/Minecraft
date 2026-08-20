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
};
