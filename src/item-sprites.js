// 16×16 item pixel maps, hand-drawn.
//
// The previous sprites were drawn as blobs and smears with a paintbrush of
// doubt — a pickaxe was a wonky arch, an ingot was a lump. These are drawn
// the way Minecraft's own item icons are drawn: every texel placed on
// purpose, an outline rim provided by the painter (pixelart.js adds it, the
// maps stay clean fills), shading that runs dark on the bottom-right and
// light on the top-left so every item reads as lit from above.
//
// `.` is transparent. The maps are pure data — no canvas, no THREE — so the
// tests load them in Node and check every cell.
//
// Letter conventions:
//
//   Haft (tool handles), light on the upper-left:
//     O darkest → D → M → H lightest
//   Tool heads, tier palettes (HEAD_WOOD etc.), same O/D/M/H run plus
//     l = the bright edge that catches the light on the top-left.
//   Food and misc maps define their letters locally; every map's palette is
//     exported right above it.

export const HAFT = {
  O: '#2c1c0c',
  D: '#4c2f12',
  M: '#7a4c1e',
  H: '#a86e2c',
  L: '#c8883e',
};

// ---- tool tier palettes ---------------------------------------------------
// Four tiers of the same four letters, so a wooden pickaxe is the same
// silhouette as an iron one with different paint — the property the tests
// lean on, and the property Minecraft itself has.

export const HEAD_WOOD = {
  o: '#3a2410', d: '#5c3c1a', m: '#8a5c28', h: '#b08038', l: '#d8a048',
};

export const HEAD_STONE = {
  o: '#1e1e1e', d: '#3c3c3c', m: '#666666', h: '#8f8f8f', l: '#b8b8b8',
};

export const HEAD_IRON = {
  o: '#262c32', d: '#454e58', m: '#7a8791', h: '#b6c4cd', l: '#e8f2f8',
};

export const HEAD_DIAMOND = {
  o: '#144c48', d: '#1c6e68', m: '#2a9a90', h: '#48d4c4', l: '#8cf2e2',
};

// ------------------------------------------------------------------- stick

export const STICK_PX = [
  '................',
  '..............OD',
  '.............ODM',
  '............ODMH',
  '...........ODMH.',
  '..........ODMH..',
  '.........ODMH...',
  '........ODMH....',
  '.......ODMH.....',
  '......ODMH......',
  '.....ODMH.......',
  '....ODMH........',
  '...ODMH.........',
  '..ODMH..........',
  '.ODMH...........',
  '.ODM............',
];

// ----------------------------------------------------------------- pickaxe
//
// The haft runs from the bottom-left corner to the middle of the tile; the
// head is the arch over it — two arms curving up from the haft's top, each
// ending in a tip that hangs down. That arch is the whole icon: it is what
// a pickaxe is from across a hotbar.

export const PICKAXE_PX = [
  '.....ooooo......',
  '....odmmmmdo....',
  '...odmm..mmdo...',
  '..odmm....mmdo..',
  '..odm......mdo..',
  '..odo......odo..',
  '...oo..OO..oo...',
  '....o.OD...o....',
  '....oOMH..o.....',
  '....oOMH........',
  '...oOMH.........',
  '..oOMH..........',
  '.oOD............',
  'oOD.............',
  '.OD.............',
  '................',
];

// ------------------------------------------------------------------ shovel
//
// The spade blade: a shallow scoop with a flat top edge and a rounded
// bottom, socketed onto the haft. The highlight runs down the left of the
// blade and the haft, one light source for the whole tool.

export const SHOVEL_PX = [
  '..........ooo...',
  '.........odhlo..',
  '........odhhhlo.',
  '........odhhmdo.',
  '........odhmmdo.',
  '.........odmdo..',
  '..........odo...',
  '...........o....',
  '..........OH....',
  '.........OMH....',
  '........OMH.....',
  '.......OMH......',
  '......OMH.......',
  '.....OMH........',
  '....OMH.........',
  '....OD..........',
];

// --------------------------------------------------------------------- axe

export const AXE_PX = [
  '.....ooooo......',
  '....odhhhlo.....',
  '....odhmmhlo....',
  '....odhmmhlo....',
  '....odhmmhlo....',
  '....odhmmhlo....',
  '....odhmmhlo....',
  '....odhmhlo.....',
  '.....odmlo......',
  '......odo.......',
  '.......oO.......',
  '......oOM.......',
  '.....oOM........',
  '....oOM.........',
  '...oOM..........',
  '...oOD..........',
];

// ------------------------------------------------------------------- sword
//
// Blade to the upper-right, guard across the middle, grip and pommel to the
// lower-left — the diagonal every Minecraft sword sits on.

export const SWORD_PX = [
  '.............lm.',
  '............lm..',
  '...........lm...',
  '..........lm....',
  '.........lm.....',
  '........lm......',
  '.......lm.......',
  '......lm........',
  '...oommmmo......',
  '...oommmmo......',
  '....oOD.........',
  '...oOD..........',
  '..oOD...........',
  '..oOO...........',
  '..oOO...........',
  '.oooo...........',
];

// ------------------------------------------------------------------ bucket

export const BUCKET_PALETTE = {
  o: '#33383e',
  d: '#545c64',
  m: '#828c96',
  h: '#b6c0ca',
  l: '#e2eaf0',
  s: '#7eb4f0',
  w: '#4a86d8',
  b: '#2a5cb8',
};

export const BUCKET_PX = [
  '......o..o......',
  '.....o....o.....',
  '....o......o....',
  '...ohhhhhhhho...',
  '...ohmmmmmmdo...',
  '..oohmmmmmmdo...',
  '..oohmmmmmmdo...',
  '..oohmmmmmmdo...',
  '..oohmmmmmmdo...',
  '..oohmmmmmmdo...',
  '...ohmmmmmmdo...',
  '...ohmmmmmmdo...',
  '....oddddddo....',
  '....oooooooo....',
  '................',
  '................',
];

export const WATER_BUCKET_PX = [
  '......o..o......',
  '.....o....o.....',
  '....o......o....',
  '...ohhhhhhhho...',
  '...ohssssssdo...',
  '..oohwwwwwwdo...',
  '..oohwwwwwwdo...',
  '..oohwwwwwwdo...',
  '..oohwwwwwwdo...',
  '..oohbbbbbbdo...',
  '...ohbbbbbbdo...',
  '...ohbbbbbbdo...',
  '....oddddddo....',
  '....oooooooo....',
  '................',
  '................',
];

// ------------------------------------------------------------- raw materials

export const COAL_PALETTE = {
  o: '#0c0c0e', d: '#18181c', m: '#26262c', h: '#3a3a42', l: '#54545e',
};

export const COAL_PX = [
  '................',
  '................',
  '.....ooooo......',
  '...oohhmmmdo....',
  '..ohhmmmmmmdo...',
  '.ohhmmmmmmmmdo..',
  '.ohhmmmmmmmmdo..',
  '.ohhmmmmmmmmdo..',
  '.ohhmmmmmmmmdo..',
  '..ohhmmmmmmdo...',
  '...oohhmmmdo....',
  '.....ohhmmdo....',
  '......ohdo......',
  '.......odo......',
  '................',
  '................',
];

export const RAW_IRON_PALETTE = {
  o: '#5c3a22', d: '#7c5230', m: '#a06c3e', h: '#c08a50', l: '#e0a868',
};

export const RAW_IRON_PX = [
  '................',
  '.......ooooo....',
  '.....odmmmhoo...',
  '...odmmmmmmho...',
  '..odmmmmmmmmhho.',
  '.odmmmmmmmmmhho.',
  '.odmmmmmmmmmhho.',
  '..odmmmmmmmmhho.',
  '...odmmmmmmhho..',
  '....odmmmmhho...',
  '.....odmmhho....',
  '......odhho.....',
  '.......odo......',
  '........oo......',
  '................',
  '................',
];

export const IRON_INGOT_PALETTE = {
  o: '#4a4e52', d: '#7a8086', m: '#b0b6bc', h: '#e0e4e8', l: '#ffffff',
};

/** The classic ingot: a bevel-edged slab, light edge upper-left. */
export const IRON_INGOT_PX = [
  '................',
  '................',
  '....oolllll.....',
  '...ohlllllll....',
  '..ohhllllllll...',
  '.ohhllllllllll..',
  '.odhhlllllllll..',
  '..odhhhhhlllll..',
  '...odhhhddddl...',
  '....odhhdddd....',
  '.....oddddd.....',
  '......oodo......',
  '.......oo.......',
  '................',
  '................',
  '................',
];

export const DIAMOND_PALETTE = {
  o: '#0e3c44', d: '#1c6474', m: '#2e94a8', h: '#48c8e0', l: '#94f0ff',
};

/** A gem: a flat crown and a pointed pavilion, two-tier facets. */
export const DIAMOND_PX = [
  '......oo........',
  '.....ohho.......',
  '.....ohho.......',
  '....ohhho.......',
  '....ohhho.......',
  '...ohhho........',
  '...ohho.oo......',
  '..ohho.ohho.....',
  '..ohho.ohho.....',
  '..ohhoohhho.....',
  '..ohhohhho......',
  '...oohhho.......',
  '....ohho........',
  '....ohho........',
  '.....oo.........',
  '................',
];

/** Gold borrows iron's shapes; only the paint differs. */
export const RAW_GOLD_PALETTE = {
  o: '#6e5410', d: '#94720e', m: '#c0980c', h: '#e8bc10', l: '#ffdc3c',
};

export const GOLD_INGOT_PALETTE = {
  o: '#6e5410', d: '#a88214', m: '#d8ac18', h: '#f8d030', l: '#fff0a0',
};

export const REDSTONE_PALETTE = {
  o: '#5c080c', d: '#7c0c10', m: '#a01418', h: '#c81c1c', l: '#f04840',
};

/** A redstone pile: three small crystals sharing a nest of dust. */
export const REDSTONE_PX = [
  '................',
  '................',
  '.....o....o.....',
  '....oho..oho....',
  '....oho..oho....',
  '....oho..oho....',
  '.....o....o.....',
  '..o...oooo...o..',
  '.oho.oddddo.oho.',
  '.oho.oddddo.oho.',
  '.oho.oddddo.oho.',
  '..o...oooo...o..',
  '.....o....o.....',
  '....oho..oho....',
  '.....o....o.....',
  '................',
];

export const GUNPOWDER_PALETTE = {
  o: '#18181a', d: '#2a2a2e', m: '#404046', h: '#5a5a62', l: '#7a7a84',
};

/** A grey mound: fine dust with a lit upper edge. */
export const GUNPOWDER_PX = [
  '................',
  '................',
  '.......oo.......',
  '.....odmmdo.....',
  '....odmmmdo.....',
  '...odmmmmdo.....',
  '...odmmmmhdo....',
  '..odmmmmmhdo....',
  '..odmmmmmhhdo...',
  '..odmmmmmhhdo...',
  '...odmmmmhdo....',
  '....odmmmdo.....',
  '.....odddo......',
  '......ooo.......',
  '................',
  '................',
];

export const ROTTEN_FLESH_PALETTE = {
  o: '#4c1010', d: '#701818', m: '#942020', h: '#b43030', l: '#d04840',
  w: '#c8c0b0', b: '#8a8274',
};

/** Rotten flesh: a slab of red meat with a knuckle of bone. */
export const ROTTEN_FLESH_PX = [
  '................',
  '................',
  '................',
  '................',
  '.......oo.......',
  '.....oodhdo.....',
  '...oodmmmmdo....',
  '..odmmmmmmmmdo..',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '..odmmmmmmmmdo..',
  '...odmmmmmmdo...',
  '....oddmmmdo....',
  '......ooooo.....',
  '................',
];

// -------------------------------------------------------------------- food

export const RAW_MEAT_PALETTE = {
  o: '#701210', d: '#8c1a14', m: '#a82a1c', h: '#c44028', l: '#d85838',
  f: '#e8b8a0', w: '#f0e4d4',
};

export const COOKED_MEAT_PALETTE = {
  o: '#3c2412', d: '#523018', m: '#6e4220', h: '#8c582c', l: '#a86c38',
  f: '#c89060', w: '#e0c4a0',
};

/**
 * The raw steak: a slab of meat with a pale fat seam and a glint of bone at
 * the narrow end — marbled, which is what says "cut of meat" in a 16-pixel
 * square.
 */
export const STEAK_PX = [
  '................',
  '................',
  '................',
  '......ooww......',
  '.....odwwwo.....',
  '...oodmmmmdo....',
  '..odmmmmmmmmdo..',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmmmffmdo.',
  '.odmmmmmfffmmdo.',
  '.odmmmmffmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '..odmmmmmmmmdo..',
  '...oddmmmmmdo...',
  '.....ooddddo....',
  '.......oooo.....',
];

/** Raw porkchop: wider than the steak, one clean cut end. */
export const PORKCHOP_PX = [
  '................',
  '................',
  '.....oooo.......',
  '...oodmmmdo.....',
  '..odmmmmmmdo....',
  '.odmmmmmmmmdo...',
  '.odmmmmmmmmmdo..',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmffmmmdo.',
  '.odmmmmffmmmmdo.',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmmmmmdo..',
  '..odmmmmmmmdo...',
  '...odmmmmmdo....',
  '....oddmmmdo....',
  '.....oooooo.....',
];

/** Mutton: a chop on a short bone, pinker than the beef. */
export const MUTTON_PX = [
  '................',
  '................',
  '................',
  '.......ww.......',
  '......owwo......',
  '.....owwwo......',
  '...oodmmmmdo....',
  '..odmmmmmmmmdo..',
  '.odmmmmmmmmmmdo.',
  '.odmmmmmmffmmdo.',
  '.odmmmmmffmmmdo.',
  '.odmmmmmmmmmmdo.',
  '..odmmmmmmmmdo..',
  '...oddmmmmmdo...',
  '.....ooddddo....',
  '.......oooo.....',
];

export const CHICKEN_RAW_PALETTE = {
  o: '#7c4c38', d: '#966050', m: '#b07a64', h: '#c89880', l: '#e0b498',
  w: '#f0e0d0',
};

export const CHICKEN_COOKED_PALETTE = {
  o: '#4c3418', d: '#64441e', m: '#7c5826', h: '#986e30', l: '#b4883c',
  w: '#e8d8b8',
};

/** The drumstick: meat up top, the two bone nubs below — the shape that has
 *  meant "hunger" in every Minecraft HUD ever drawn. */
export const CHICKEN_PX = [
  '................',
  '................',
  '......ooo.......',
  '....oodmmdo.....',
  '...odmmmmmmdo...',
  '..odmmmmmmmmdo..',
  '..odmmmmmmmmdo..',
  '..odmmmmmmmmdo..',
  '..odmmmmmmmdo...',
  '...odmmmmmdo....',
  '....odmmmdo.....',
  '....odmmdo......',
  '....owwwo.......',
  '.....owo........',
  '.....owo........',
  '................',
];

export const APPLE_PALETTE = {
  o: '#6c0c0c', d: '#901414', m: '#b01c1c', h: '#d02828', l: '#e84040',
  w: '#ff9090', g: '#3f7a1a', G: '#5aa42a', b: '#4c2f12',
};

export const APPLE_PX = [
  '........b.......',
  '........b.......',
  '.......gbb......',
  '......gGb.......',
  '......ggg.......',
  '.....oommo......',
  '....odmmmdo.....',
  '...odmmmwmdo....',
  '..odmmmwwmmdo...',
  '..odmmmmwmmdo...',
  '..odmmmmmmmdo...',
  '..odmmmmmmmdo...',
  '...odmmmmmdo....',
  '....odmmmdo.....',
  '.....odddo......',
  '......ooo.......',
];

export const GOLDEN_APPLE_PALETTE = {
  o: '#8c6a10', d: '#b08814', m: '#d8a418', h: '#f0bc20', l: '#ffd84a',
  w: '#fff8c8', g: '#3f7a1a', G: '#5aa42a', b: '#4c2f12',
};

// -------------------------------------------------------------- ranged gear

export const BONE_PALETTE = {
  o: '#4c483e', d: '#6e685a', m: '#928a78', h: '#b6ac96', l: '#d8ccb4',
};

export const BONE_PX = [
  '....oooo........',
  '..oodmmmdo......',
  '.odmmmmmmmdo....',
  'odmmmmmmmmmdo...',
  'odmmmmmmmmmmdo..',
  'odmmmmmmmmmmdo..',
  'odmmmmmmmmmmdo..',
  '.odmmmmmmmmmdo..',
  '..odmmmmmmmdo...',
  '...odmmmmmdo....',
  '....odmmmdo.....',
  '.....odmdo......',
  '..oodmmmmdo.....',
  '.odmmmmmmmdo....',
  'odmmmmmmmmmdo...',
  'ooooooooooooo...',
];

export const ARROW_PALETTE = {
  o: '#3a3a3a', d: '#565656', m: '#7c7c7c', h: '#a6a6a6', l: '#d0d0d0',
  f: '#d8d0c0',
};

export const ARROW_PX = [
  '........oo......',
  '.......omm......',
  '......omm.......',
  '.....omm........',
  '....omm.........',
  '...omm..........',
  '..omm...........',
  '.omm............',
  'omm.............',
  'mm..............',
  'm...............',
  'm...oo..........',
  '...offfo........',
  '..offfffo.......',
  '.offffffo.......',
  '..oooffo........',
];

export const STRING_PALETTE = {
  o: '#8a826e', d: '#a49a80', m: '#c0b496', h: '#dcd0ac', l: '#f0e4c0',
};

export const STRING_PX = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '....hh..........',
  '...mm.mm........',
  '...mm..mm.......',
  '....mm..mm......',
  '.....mm..mm.....',
  '......mm..mm....',
  '.......mm..mm...',
  '........mm..mm..',
  '.........mm..oo.',
  '.............oo.',
  '................',
];

export const SPIDER_EYE_PALETTE = {
  o: '#4c3c50', d: '#6c5674', m: '#8c7098', h: '#a88ab4', l: '#c4a8ce',
  r: '#a01010', R: '#e02828', w: '#f0f0f0',
};

export const SPIDER_EYE_PX = [
  '................',
  '................',
  '................',
  '......ooo.......',
  '....oodhhdo.....',
  '...odhwwwhdo....',
  '..odhwwwwwdo....',
  '..odhwwRwwdo....',
  '..odhwwRwwdo....',
  '...odhwwwdo.....',
  '....oddhhdo.....',
  '.....ooddo......',
  '......oro.......',
  '.......oo.......',
  '................',
  '................',
];

export const BOW_PALETTE = {
  o: '#3a2410', d: '#5c3c1a', m: '#8a5c28', h: '#b08038', l: '#d8a048',
  D: '#5c3c1a', H: '#b08038', s: '#e8e2d8',
};

export const BOW_PX = [
  '............oo..',
  '............HDs.',
  '...........HDs..',
  '..........HDs...',
  '.........HDs....',
  '........HDs.....',
  '.......HDs......',
  '......HDs.......',
  '.....HDs........',
  '....HDs.........',
  '...HDs..........',
  '..HDs...........',
  '.HDs............',
  '.HDs............',
  '..oDo...........',
  '................',
];

export const FEATHER_PALETTE = {
  o: '#8a867e', d: '#b0aca2', m: '#d0ccc2', h: '#e8e4da', l: '#faf8f0',
  s: '#9c988e',
};

export const FEATHER_PX = [
  '..........oo....',
  '.........olh....',
  '........olhh....',
  '.......olhhh....',
  '......olhhhh....',
  '.....olhhhh.....',
  '....olhhhh......',
  '...olhhhh.......',
  '..olhhhh........',
  '.olhhhh.........',
  '.olhhh..........',
  '.olhh...........',
  '.olh............',
  '.os.............',
  '.os.............',
  '..o.............',
];

// ----------------------------------------------------------- farm and misc

export const CARROT_PALETTE = {
  o: '#6c3c08', d: '#8c4c0c', m: '#b06010', h: '#d47814', l: '#f09418',
  g: '#2c5c10', G: '#4c8f22', y: '#74c93a',
};

export const CARROT_PX = [
  '................',
  '.......gg.......',
  '......gGg.......',
  '.......g........',
  '......ggg.......',
  '.......g........',
  '.......o........',
  '......omo.......',
  '.....odmdo......',
  '....odmmdo......',
  '....odmmdo......',
  '....odmmdo......',
  '....odmmdo......',
  '....odmdo.......',
  '.....odo........',
  '......o.........',
];

export const POTATO_PALETTE = {
  o: '#5c3c1a', d: '#7c5226', m: '#9c6a34', h: '#b88444', l: '#d09c58',
  e: '#6e4420',
};

export const POTATO_PX = [
  '................',
  '................',
  '................',
  '......ooo.......',
  '....oodmmdo.....',
  '...odmmmmmmdo...',
  '..odmmmmmmmmdo..',
  '..odmmmmmmmmdo..',
  '..odmmemmhmdo...',
  '..odmmmmmmmdo...',
  '...odmmmmmdo....',
  '....odmmmdo.....',
  '.....odmdo......',
  '......odo.......',
  '.......o........',
  '................',
];

export const BAKED_POTATO_PALETTE = {
  o: '#3c2c14', d: '#54401c', m: '#705426', h: '#8c6832', l: '#a88040',
  e: '#c8985c', k: '#2c1e0c',
};

export const LEATHER_PALETTE = {
  o: '#4c2e14', d: '#6e441c', m: '#8c5c26', h: '#a87430', l: '#c48c3c',
  s: '#5c3a1a',
};

/** Leather: an irregular hide, punched with a stitch of darker marks. */
export const LEATHER_PX = [
  '................',
  '................',
  '................',
  '.....oooo.......',
  '...oodmmmdo.....',
  '..odmmmmmmdo....',
  '.odmmmmmmmmdo...',
  '.odmmmmmmmmdo...',
  '.odmmmmmmmmdo...',
  '.odmmssssmmdo...',
  '..odmmmmmmdo....',
  '...odmmmmdo.....',
  '....oddmmdo.....',
  '.....ooddo......',
  '......ooo.......',
  '................',
];

// ------------------------------------------------------------------ armour
//
// Four shapes drawn the way Minecraft draws them: a helmet as a dome with
// the face opening, a chestplate with shoulder straps, leggings as two
// legs, boots as two boots. The tier palettes are the tool palettes, so a
// diamond helmet matches a diamond pickaxe on the hotbar.

export const HELMET_PX = [
  '................',
  '......ooo.......',
  '.....ohhho......',
  '....ohhhhho.....',
  '....ohhhhho.....',
  '....ohhhhho.....',
  '....ohhhhho.....',
  '....ohhhhho.....',
  '....ohhhhho.....',
  '....ohhhhho.....',
  '....ohhhhho.....',
  '.....ohhho......',
  '.....ohhho......',
  '......ooo.......',
  '................',
  '................',
];

export const CHESTPLATE_PX = [
  '................',
  '.....o....o.....',
  '....oho..oho....',
  '....ohh..hho....',
  '....ohhhhhho....',
  '....ohhhhhho....',
  '.....ohhhho.....',
  '.....ohhhho.....',
  '.....ohhhho.....',
  '.....ohhhho.....',
  '.....ohhhho.....',
  '.....ohhhho.....',
  '.....ohhhho.....',
  '.....ohhhho.....',
  '.....ohhhho.....',
  '.....oooooo.....',
];

export const LEGGINGS_PX = [
  '................',
  '.....oooooo.....',
  '....ohhhhhho....',
  '....ohhhhhho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....ohh..hho....',
  '....oddo.ddo....',
  '....oooo.oooo...',
];

export const BOOTS_PX = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '....oo....oo....',
  '...ohho..ohho...',
  '...ohho..ohho...',
  '...ohho..ohho...',
  '...ohho..ohho...',
  '...oddo..oddo...',
  '...oooo..oooo...',
];

export const ARMOUR_LEATHER = {
  o: '#4c3014', d: '#6e441c', m: '#8c5c26', h: '#a87430', l: '#c48c3c',
};

/** The full sprite registry, for the tests and the atlas painter. */
export const ALL_SPRITES = {
  STICK: STICK_PX,
  PICKAXE: PICKAXE_PX,
  SHOVEL: SHOVEL_PX,
  AXE: AXE_PX,
  SWORD: SWORD_PX,
  BUCKET: BUCKET_PX,
  WATER_BUCKET: WATER_BUCKET_PX,
  COAL: COAL_PX,
  RAW_IRON: RAW_IRON_PX,
  IRON_INGOT: IRON_INGOT_PX,
  DIAMOND: DIAMOND_PX,
  REDSTONE: REDSTONE_PX,
  GUNPOWDER: GUNPOWDER_PX,
  ROTTEN_FLESH: ROTTEN_FLESH_PX,
  STEAK: STEAK_PX,
  PORKCHOP: PORKCHOP_PX,
  MUTTON: MUTTON_PX,
  CHICKEN: CHICKEN_PX,
  APPLE: APPLE_PX,
  BONE: BONE_PX,
  ARROW: ARROW_PX,
  STRING: STRING_PX,
  SPIDER_EYE: SPIDER_EYE_PX,
  BOW: BOW_PX,
  FEATHER: FEATHER_PX,
  CARROT: CARROT_PX,
  POTATO: POTATO_PX,
  LEATHER: LEATHER_PX,
  HELMET: HELMET_PX,
  CHESTPLATE: CHESTPLATE_PX,
  LEGGINGS: LEGGINGS_PX,
  BOOTS: BOOTS_PX,
};
