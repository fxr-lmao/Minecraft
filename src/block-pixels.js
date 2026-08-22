// Hand-authored 16×16 block face maps.
//
// The first version of this game generated every block texture as a noise
// field: a base colour, some speckles, some blotches, done. It ran fast and
// it looked like it ran fast — noise has no idea what a plank is, so the
// planks had no grain that meant anything, the cobblestone had no stones,
// and nothing a player recognised from Minecraft was actually there.
//
// These maps are the fix, and the fix is the opposite of noise: every texel
// is a decision. A stone is a stone-coloured tile with scattered chips; a
// log is bark with grooves that run *down* it; a brick wall is four courses
// of bricks offset the way bricks are. The maps are plain letter grids with
// a palette per face, painted by pixelart.js, so they are data — a test can
// check every row is the right width, and the painter cannot drift from the
// icon.
//
// Every literal row passes through B(), which throws if the row is not
// exactly 16 characters — a missing or extra texel is a defect you can see,
// so it fails loudly here instead of drawing a shifted row.
//
// Letter convention used across most faces (each face's palette defines the
// exact colours):
//
//   o  outline / darkest      d  dark          m  mid
//   h  highlight              l  lightest fleck
//   s  secondary tone (speck, streak, sparkle)

import { mulberry32 } from './utils.js';

/** Every literal row in this file is 16 texels; enforce it at import. */
function B(row) {
  if (typeof row !== 'string' || row.length !== 16) {
    throw new Error(`block pixel row must be 16 characters, got ${JSON.stringify(row)} (${row?.length})`);
  }
  return row;
}

/**
 * A grit tile: sixteen rows of letters drawn from `weights` by a seeded
 * RNG. The scatter is genuinely random — which is what grit is — but the
 * *weights* are chosen per material, which is the hand-authored part: sand
 * is mostly mid tones with light flecks, leaves are darks and lights with
 * no mid to speak of. Deterministic per seed, so the tile is identical
 * every load and in every test.
 *
 * @param {number} seed
 * @param {Record<string, number>} weights letter -> relative frequency
 */
function scatter(seed, weights) {
  const rand = mulberry32(seed);
  const letters = Object.keys(weights);
  const total = letters.reduce((a, k) => a + weights[k], 0);
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      let r = rand() * total;
      let pick = letters[0];
      for (const k of letters) {
        r -= weights[k];
        if (r <= 0) { pick = k; break; }
      }
      row += pick;
    }
    rows.push(row);
  }
  return rows.map(B);
}

// --------------------------------------------------------------------- dirt

export const DIRT_PALETTE = {
  o: '#4a3018',
  d: '#5c3d20',
  m: '#6f4a28',
  h: '#805734',
  l: '#91663f',
  s: '#9d7047',
};

export const DIRT_PX = scatter(0xd171, { o: 1, d: 5, m: 12, h: 5, l: 2, s: 1 });

// ---------------------------------------------------------------- grass top
//
// A turf: three greens with a few darker divots and light shoots, scattered
// so the block reads as lawn rather than as a green wash.

export const GRASS_TOP_PALETTE = {
  o: '#3f7a1a',
  d: '#4c8f22',
  m: '#5aa42a',
  h: '#66b832',
  l: '#74c93a',
  s: '#85d846',
};

export const GRASS_TOP_PX = scatter(0x6a55, { o: 1, d: 6, m: 12, h: 6, l: 3, s: 1 });

// --------------------------------------------------------------- grass side
//
// The classic grass block side: a green cap sitting on dirt with a ragged,
// toothy bottom edge — the join is the whole tile. The cap is 3-4 texels
// deep and every column ends on a different tooth, like Minecraft's own.
// The dirt body below reuses the dirt palette so the two faces never drift
// apart in hue.

export const GRASS_SIDE_PALETTE = {
  ...DIRT_PALETTE,
  G: '#3f7a1a',
  g: '#5aa42a',
  y: '#74c93a',
};

export const GRASS_SIDE_PX = [
  B('GgGgGgGgGgGgGgGg'),
  B('gGgyGgGgyGgGgyGg'),
  B('ggyggyggyggyggyg'),
  B('gGggygGggygGggyg'),
  B('omdmmdmmdmmhmmdm'),
  B('mdmhmmdmmhmdmmhm'),
  B('hmmdmmhmdmmhmmdm'),
  B('mmhmmdmmhmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
  B('mmdmmhmdmmhmmdmm'),
  B('mhmmdmmhmdmmhmmd'),
  B('mmhmdmmhmdmmhmdm'),
  B('mdmmhmmdmmhmdmmh'),
  B('hmmdmmhmdmmhmmdm'),
  B('mmhmmdmmhmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
];

// -------------------------------------------------------------------- stone

export const STONE_PALETTE = {
  o: '#545454',
  d: '#646464',
  m: '#747474',
  h: '#848484',
  l: '#929292',
  s: '#9c9c9c',
};

export const STONE_PX = scatter(0x5706, { o: 1, d: 4, m: 14, h: 5, l: 2, s: 1 });

// -------------------------------------------------------------- cobblestone
//
// Dark mortar with seven rounded stones laid into it, each stone shaded
// top-left light and bottom-right dark — which is the whole of reading a
// cobble as a cobble: stones, not noise.

export const COBBLE_PALETTE = {
  o: '#3f3f3f', // mortar, darkest
  d: '#4c4c4c', // mortar
  m: '#5a5a5a', // stone shadow
  h: '#7c7c7c', // stone body
  l: '#969696', // stone light
  s: '#a8a8a8', // stone highlight
  c: '#8a8a8a', // stone mid
};

export const COBBLE_PX = [
  B('dddddddsssssdddd'),
  B('dddddslcccssdddd'),
  B('dddddcchhhcssddd'),
  B('dddddsmhhmccsddd'),
  B('dddddsmmmmccdddd'),
  B('ddddddmmmmmddddd'),
  B('ddddssddddddsssd'),
  B('dddslcssddddsscc'),
  B('dddcchhcsdddscch'),
  B('dddsmhhmcdddscmh'),
  B('ddddsmmmcddddscm'),
  B('dddddmmmmdddddmm'),
  B('ssssdddddddddddd'),
  B('slccssddddddssss'),
  B('cchhcssddddslcch'),
  B('smhhccsddddsmmhc'),
];

// ------------------------------------------------------------------- planks
//
// Four oak boards, each four texels tall, with staggered butt joints, a dark
// seam between them, grain streaks running along the wood and the two nail
// dots per board Minecraft's planks carry.

export const PLANKS_PALETTE = {
  o: '#3a2a12', // seam
  d: '#5e3f1c', // grain dark
  m: '#8a5f2e', // grain mid
  h: '#a8763c', // board base
  l: '#bd8a48', // board light
  s: '#cf9c56', // board highlight
  n: '#4c3418', // nail
};

export const PLANKS_PX = [
  B('ooohhdddhhdddhoo'),
  B('ohhhhdddhhdddhhh'),
  B('ohhhdddhhdddhhhh'),
  B('oooohhddhhdddhoo'),
  B('ohhdddhhdddhhhoo'),
  B('ohhhhdddhhdddhhh'),
  B('ohhhdddhhdddhhhh'),
  B('oooohhddhhdddhoo'),
  B('ohhdddhhdddhhhoo'),
  B('ohhhhdddhhdddhhh'),
  B('ohhhdddhhdddhhhh'),
  B('oooohhddhhdddhoo'),
  B('ohhdddhhdddhhhoo'),
  B('ohhhhdddhhdddhhh'),
  B('ohhhdddhhdddhhhh'),
  B('oooohhddhhdddhoo'),
];

// --------------------------------------------------------------------- sand

export const SAND_PALETTE = {
  o: '#b8ad84',
  d: '#c6ba8e',
  m: '#d4c898',
  h: '#e0d5a4',
  l: '#ebe1b2',
  s: '#f5ecbe',
};

export const SAND_PX = scatter(0x5a7d, { o: 1, d: 3, m: 14, h: 6, l: 3, s: 1 });

// -------------------------------------------------------------------- bricks
//
// Four courses of two bricks, offset like real brickwork, on pale mortar.
// Each brick is shaded as a body with a lighter top-left and a darker rim,
// so the wall reads as courses of brick rather than a red grid.

export const BRICK_PALETTE = {
  o: '#a8a296', // mortar dark
  d: '#c2bcae', // mortar
  m: '#5e2416', // brick shadow
  h: '#7c3018', // brick body
  l: '#94381c', // brick light
  s: '#a84322', // brick highlight
  c: '#8c341c', // brick mid
};

export const BRICK_PX = [
  B('hhhshhshhshddddd'),
  B('hhlshhlshhlshhlh'),
  B('hhlshhlshhlshhlh'),
  B('mmcmmmcmmmcmmhhl'),
  B('dddddhhhshhhshhh'),
  B('hhhshhhshhhshhhs'),
  B('hhhshhhshhhshhhs'),
  B('mmmcmmmcmmmcmmmc'),
  B('hhlshhlshhlshhld'),
  B('hhlshhlshhlshhlh'),
  B('hhlshhlshhlshhlh'),
  B('mmcmmmcmmmcmmhhl'),
  B('dddddhhhshhhshhh'),
  B('hhhshhhshhhshhhs'),
  B('hhhshhhshhhshhhs'),
  B('mmmcmmmcmmmcmmmc'),
];

// ------------------------------------------------------------------ bedrock

export const BEDROCK_PALETTE = {
  o: '#101010',
  d: '#1d1d1d',
  m: '#2b2b2b',
  h: '#383838',
  l: '#454545',
  s: '#525252',
};

export const BEDROCK_PX = scatter(0xbe4d, { o: 4, d: 5, m: 7, h: 3, l: 1, s: 1 });

// --------------------------------------------------------------------- snow

export const SNOW_PALETTE = {
  o: '#b8c2cc',
  d: '#c6cfd8',
  m: '#d6dde4',
  h: '#e4e9ee',
  l: '#f0f4f7',
  s: '#ffffff',
};

export const SNOW_PX = scatter(0x5706, { o: 1, d: 2, m: 10, h: 5, l: 2, s: 1 });

// ------------------------------------------------------------------ log side
//
// Oak bark: vertical grooves. The dark lines wander a little rather than
// running ruler-straight, because bark is not corduroy — but the direction
// is always down the trunk, which is how a log reads as a log from any
// distance.

export const LOG_SIDE_PALETTE = {
  o: '#2c1f0c',
  d: '#3a2a12',
  m: '#4c3718',
  h: '#5e4520',
  l: '#6f5228',
  s: '#7d5f30',
};

export const LOG_SIDE_PX = [
  B('mmdmmoohhdmhhomm'),
  B('hmmdmmoohhdmhhom'),
  B('mmhmmdmmoohhdmhh'),
  B('dmmhmmdmmoohhdmh'),
  B('mdmmhmmdmmoohhdm'),
  B('mhmmdmmhmmdmmooh'),
  B('mmhmdmmhmmdmmooh'),
  B('hmmdmmhmdmmhmmdo'),
  B('mmhmmdmmhmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
  B('mdmmhmmdmmhmdmmh'),
  B('mhmmdmmhmmdmmhmd'),
  B('mmhmdmmhmmdmmhmd'),
  B('hmmdmmhmdmmhmmdm'),
  B('mmhmmdmmhmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
];

// ------------------------------------------------------------------ log top
//
// The cut end: annual rings stepping out from a slightly darker heart. The
// rings are pixel circles because a smooth stroked circle anti-aliases, and
// a texel is either bark or not.

export const LOG_TOP_PALETTE = {
  o: '#3a2a12',
  d: '#4c3718',
  m: '#6a4c20',
  h: '#82602c',
  l: '#987438',
  s: '#aa843f',
};

export const LOG_TOP_PX = [
  B('mmmhhmmmmmmmmhhm'),
  B('mmhdmmmhhmmmmhmm'),
  B('mhddddmmhmmmmmmh'),
  B('mdddoodddmmmmhmm'),
  B('hdddooddddmmmhmm'),
  B('mhdddddddmmmmmhm'),
  B('mmmdddodddmmmhmm'),
  B('mmmmddddddmmhmmm'),
  B('mmmmmddddddmhmmm'),
  B('mmmmmmdddodmmhmm'),
  B('mmmmmmmmmddmmmhm'),
  B('mmmmmmmmmmddmhmm'),
  B('mmmmmmmmmmmmmmmh'),
  B('mmhmmmmmmmmmmmhm'),
  B('mmmmmmhmmmmmmhmm'),
  B('mmmmmmmmmhmmmmhm'),
];

// ------------------------------------------------------------------- leaves

export const LEAVES_PALETTE = {
  o: '#16380a',
  d: '#204e10',
  m: '#2c6416',
  h: '#387a1c',
  l: '#458e23',
  s: '#54a42b',
};

export const LEAVES_PX = scatter(0x1ea5, { o: 3, d: 6, m: 6, h: 4, l: 2, s: 1 });

// ---------------------------------------------------------------- deepslate

export const DEEPSLATE_PALETTE = {
  o: '#16171a',
  d: '#1f2024',
  m: '#28292e',
  h: '#313238',
  l: '#3a3b42',
  s: '#43444c',
};

export const DEEPSLATE_PX = scatter(0xd51a, { o: 2, d: 5, m: 10, h: 4, l: 1, s: 1 });

// --------------------------------------------------------------------- water
//
// The inventory icon for water (the world's water is shader-drawn). Still
// blues with a couple of light ruffles so the tile reads as a surface.

export const WATER_ICON_PALETTE = {
  o: '#14306e',
  d: '#1c3e86',
  m: '#274ea0',
  h: '#3460b8',
  l: '#4574d0',
  s: '#5f8ee4',
};

export const WATER_ICON_PX = scatter(0x4a7e, { o: 1, d: 3, m: 11, h: 5, l: 3, s: 1 });

// ---------------------------------------------------------------------- ice
//
// Pale blue with white cracks. Ice cracks scatter light back at you, so they
// are drawn lighter than the body, not darker — a dark crack reads as a
// scratch in paint; a light one reads as a fracture full of light.

export const ICE_PALETTE = {
  o: '#5e8ab8',
  d: '#6f9cc6',
  m: '#82aed4',
  h: '#96c0e2',
  l: '#abd2ee',
  s: '#eef8ff',
};

export const ICE_PX = [
  B('mmhdmmmhmmdmmmhm'),
  B('mdmhmmdmmhmdmmhm'),
  B('hmmdmmhmdmmhmmdm'),
  B('mmhmmdmmhmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
  B('mmdmmhmdmmhmmdmm'),
  B('mhmmdmmhmdmmhmmd'),
  B('mmhmdmmhmdmmhmdm'),
  B('mdmmhmmdmmhmdmmh'),
  B('hmmdmmhmdmmhmmdm'),
  B('mmhmmdmmhmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
  B('mmdmmhmdmmhmmdmm'),
  B('mhmmdmmhmdmmhmmd'),
  B('mmhmdmmhmdmmhmdm'),
  B('mdmmhmmdmmhmdmmh'),
];

// ------------------------------------------------------------- crafting table
//
// Top: the 2×2 tool grid burned into the planks, with the saw cut lines —
// the markings that turn four boards into a workbench. Side: plain planks.

export const CRAFT_TOP_PALETTE = {
  ...PLANKS_PALETTE,
  b: '#2c1e0c', // burned grid line
};

export const CRAFT_TOP_PX = [
  B('bbbbbbbbbbbbbbbb'),
  B('bhhhdddhbdddhhhb'),
  B('bhhhdddhbdddhhhb'),
  B('bhhdddhhbddhhhdb'),
  B('bhhdddhhbddhhhdb'),
  B('bhhdddhhbddhhhdb'),
  B('bhhdddhhbddhhhdb'),
  B('bbbbbbbbbbbbbbbb'),
  B('bhhdddhhbddhhhdb'),
  B('bhhdddhhbddhhhdb'),
  B('bhhdddhhbddhhhdb'),
  B('bhhdddhhbddhhhdb'),
  B('bhhhdddhbdddhhhb'),
  B('bhhhdddhbdddhhhb'),
  B('bhhhdddhbdddhhhb'),
  B('bbbbbbbbbbbbbbbb'),
];

export const CRAFT_SIDE_PALETTE = {
  ...PLANKS_PALETTE,
  i: '#2c1e0c', // tool iron dark
  g: '#8a929a', // tool iron light
};

export const CRAFT_SIDE_PX = [
  B('ooohhdddhhdddhoo'),
  B('ohhhhdddhhdddhhh'),
  B('ohhhdddhhdddhhhg'),
  B('oooohhddhhdddhoo'),
  B('ohhdddhhdddhhhog'),
  B('ohhhhdddhhdddhho'),
  B('ohhhdddhhdddhhog'),
  B('oooohhddhhdddhoi'),
  B('ohhdddhhdddhhhog'),
  B('ohhhhdddhhdddhho'),
  B('ohhhdddhhdddhhhg'),
  B('oooohhddhhdddhoo'),
  B('ohhdddhhdddhhhgo'),
  B('ohhhhdddhhdddhhh'),
  B('ohhhdddhhdddhhhh'),
  B('oooohhddhhdddhoo'),
];

// ------------------------------------------------------------------- furnace
//
// Front: the dark mouth with the fire in it and a grey trim band. Side: the
// same stone with a pale edge. The fire is a two-colour flame — orange body,
// yellow heart — because a furnace is where the fire lives.

export const FURNACE_FRONT_PALETTE = {
  ...STONE_PALETTE,
  b: '#14100d', // mouth black
  k: '#0b0806', // mouth deep
  t: '#4a4a4a', // trim dark
  T: '#6e6e6e', // trim light
  f: '#7c3a10', // fire dark
  F: '#c06420', // fire body
  e: '#e89a30', // fire light
  E: '#ffd060', // fire heart
};

export const FURNACE_FRONT_PX = [
  B('mmhmdmmhmdmmhmmd'),
  B('mdmhmmdmmhmdmmhm'),
  B('hmmdmmhmdmmhmmdm'),
  B('mmmTTTTTTTTTTmmm'),
  B('mmTbbbbbbbbTmmdh'),
  B('mmTkkkkkkkkTmmmm'),
  B('mmTkkkkkkkkTmmmm'),
  B('mmTkkkkkkkkTmmmm'),
  B('mmTkkkFFkkkTmmmm'),
  B('mmTkkfFFFEkTmmmm'),
  B('mmTkffFFFEkTmmmm'),
  B('mmTkffFFFFfkTmmm'),
  B('mmTkkffFFFfkTmmm'),
  B('mmTkkkfffkkkTmmm'),
  B('mmmTTTTTTTTTTmmm'),
  B('mdmmhmmdmmhmdmmh'),
];

export const FURNACE_SIDE_PALETTE = {
  ...STONE_PALETTE,
  t: '#4a4a4a',
};

export const FURNACE_SIDE_PX = [
  B('tttttttttttttttt'),
  B('mmhmdmmhmdmmhmmd'),
  B('mdmhmmdmmhmdmmhm'),
  B('hmmdmmhmdmmhmmdm'),
  B('mmhmmdmmhmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
  B('mmdmmhmdmmhmmdmm'),
  B('mhmmdmmhmdmmhmmd'),
  B('mmhmdmmhmdmmhmdm'),
  B('mdmmhmmdmmhmdmmh'),
  B('hmmdmmhmdmmhmmdm'),
  B('mmhmmdmmhmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
  B('mmdmmhmdmmhmmdmm'),
  B('mhmmdmmhmdmmhmmd'),
  B('tttttttttttttttt'),
];

// --------------------------------------------------------------------- glass

export const GLASS_PALETTE = {
  f: '#cfe6ff', // frame
  F: '#a9c8e8', // frame shadow
  s: '#ffffff', // shine
  e: '#7ea4c8', // corner
};

export const GLASS_PX = [
  B('ffffffffffffffff'),
  B('f..............f'),
  B('f..............f'),
  B('f...s........s.f'),
  B('f...ss......ss.f'),
  B('f....ss....ss..f'),
  B('f.....ssssss...f'),
  B('f.....ssssss...f'),
  B('f......ssss....f'),
  B('f.......ss.....f'),
  B('f..............f'),
  B('f..............f'),
  B('f..............f'),
  B('f..............f'),
  B('f..............f'),
  B('ffffffffffffffff'),
];

// ---------------------------------------------------------------------- TNT

export const TNT_SIDE_PALETTE = {
  o: '#7c100c', // red shadow
  d: '#98140e', // red dark
  m: '#b01810', // red body
  h: '#c42014', // red light
  l: '#d22a18', // red highlight
  b: '#d8d0bc', // band
  B: '#b8b0a0', // band shadow
  n: '#33241c', // letters
};

export const TNT_SIDE_PX = [
  B('mmdmmhmdmmhmmdmh'),
  B('mdmhmmdmhmmhmmdm'),
  B('hmmdmmhmmdmmhmdm'),
  B('mmhmmdmhmmdmmhmm'),
  B('dmmhmmdmmhmdmmhm'),
  B('mmdmmhmdmmhmmdmm'),
  B('mbnnnbbnnnbbnnnb'),
  B('mbbnbbbnnbbbbnbb'),
  B('mbbnbbnbnbbbbnbb'),
  B('mbbbbbbbbbbbbbbm'),
  B('dmmhmmdmmhmdmmhm'),
  B('mmdmmhmdmmhmmdmm'),
  B('mhmmdmmhmdmmhmmd'),
  B('mmhmdmmhmdmmhmdm'),
  B('mdmmhmmdmmhmdmmh'),
  B('mdmmhmmdmmhmdmmh'),
];

export const TNT_TOP_PALETTE = {
  o: '#7c100c',
  d: '#98140e',
  m: '#b01810',
  h: '#c42014',
  l: '#d22a18',
};

export const TNT_TOP_PX = scatter(0x7a7a, { o: 1, d: 4, m: 12, h: 5, l: 2 });

// -------------------------------------------------------------------- ores
//
// Ore lumps are small hand-drawn stamps composited over stone or deepslate
// at seeded positions (textures.js does the compositing). Each lump is a
// blob with a darker rim and a bright facet on the upper-left — the two
// marks that read as "crystal in rock" at any scale.

export const ORE_PALETTES = {
  coal: { o: '#101014', d: '#1e1e24', m: '#2e2e36', h: '#42424c', l: '#5c5c68' },
  coalDeep: { o: '#0a0a0e', d: '#16161c', m: '#24242c', h: '#36363e', l: '#4a4a56' },
  iron: { o: '#6e4826', d: '#8c5c34', m: '#b07444', h: '#d09058', l: '#e8b070' },
  gold: { o: '#8c6a10', d: '#b08814', m: '#d8a418', h: '#f0bc20', l: '#ffd84a' },
  redstone: { o: '#7c0c10', d: '#9c1014', m: '#c01418', h: '#e01c1c', l: '#ff4a44' },
  diamond: { o: '#145e5c', d: '#1c7c78', m: '#249a94', h: '#2cb8b0', l: '#5cdcd2' },
};

/** A coal lump: an irregular black blob with a lit facet. */
export const LUMP_COAL_PX = [
  '..ooooo....',
  '.ommmhho...',
  'ommmmmhhho.',
  'ommmmmmmhho',
  'ommmmmmmhho',
  'ommmmmhhho.',
  '.ommmhho...',
  '..ooooo....',
  '....oo.....',
  '....ommo...',
  '.....oo....',
];

/** An iron lump: the warm tan of raw iron, same construction. */
export const LUMP_IRON_PX = LUMP_COAL_PX;

/** A redstone cluster: several small crystals sharing one nest. */
export const LUMP_REDSTONE_PX = [
  '..o...o....',
  '.ohho.o....',
  'ohhho.ohho.',
  'ohhhoohhho.',
  '.ohhohhho..',
  '..ooohho...',
  '....oo.....',
  '..o...oo...',
  '.ohho..oo..',
  '.ohhho.....',
  '..oo.......',
];

/** A diamond: a cut gem with two-tier facets, bright against the rock. */
export const LUMP_DIAMOND_PX = [
  '....oo....',
  '...ohho...',
  '...ohho...',
  '..ohhho...',
  '.ohhho.o..',
  '.ohhho.oo.',
  '.ohho.ohho',
  '..oo..ohho',
  '......ohho',
  '.......oo.',
];
