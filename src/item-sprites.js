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
