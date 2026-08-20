// Unit tests for the content pass: XP levels, game mode, TNT blast math,
// and the day/night cycle helpers. Pure modules only — no DOM.

import { XpBar, xpForBlock, xpForOre, XP_PER_LEVEL } from '../src/xp.js';
import { GameMode } from '../src/gamemode.js';
import { FuseTracker, blastStrength, blastBlocks, FUSE_SECONDS, BLAST_RADIUS } from '../src/tnt.js';
import { sunDirection, sunLight, moonLight, clockString } from '../src/sky.js';
import { COAL_ORE, DIAMOND_ORE, DEEPSLATE_COAL_ORE, TNT, BEDROCK, GRASS } from '../src/terrain.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// ---- XP ----
const xp = new XpBar();
check('xp starts at zero', xp.level === 0 && xp.points === 0 && xp.fraction === 0);
check('coal ore pays 2', xpForOre(COAL_ORE) === 2);
check('deepslate coal pays the same', xpForBlock(DEEPSLATE_COAL_ORE) === 2);
check('diamond pays 10', xpForBlock(DIAMOND_ORE) === 10);
check('grass pays nothing', xpForBlock(GRASS) === 0);
xp.add(99);
check('99 points is no level', xp.level === 0 && xp.points === 99);
const gained = xp.add(3);
check('crossing 100 gains a level', gained === 1 && xp.level === 1 && xp.points === 2);
const roundtrip = new XpBar();
roundtrip.fromJSON(xp.toJSON());
check('xp save/restore', roundtrip.level === 1 && roundtrip.points === 2);
check('XP_PER_LEVEL is 100', XP_PER_LEVEL === 100);

// ---- game mode ----
const gm = new GameMode();
check('starts in survival', !gm.isCreative && gm.name === 'Survival');
check('toggling goes creative', gm.toggle() === 1 && gm.isCreative);
check('flight needs creative', gm.toggleFlying() === true && gm.flying);
gm.toggle();
check('leaving creative lands you', !gm.isCreative && !gm.flying);
check('survival refuses flight', gm.toggleFlying() === false && !gm.flying);
check('creative is invulnerable', gm.setCreative(true) && gm.invulnerable());
check('creative breaks instantly', gm.instantBreak() && gm.infiniteBlocks());

// ---- TNT ----
const fuses = new FuseTracker();
fuses.light(1, 2, 3);
check('fuse lights', fuses.isLit(1, 2, 3));
check('fuse fraction at start', fuses.fraction(1, 2, 3) === 0);
const booms = fuses.tick(FUSE_SECONDS / 2);
check('half fuse, no boom yet', booms.length === 0 && fuses.isLit(1, 2, 3));
const booms2 = fuses.tick(FUSE_SECONDS / 2 + 0.01);
check('full fuse booms', booms2.length === 1 && booms2[0].x === 1);
check('fuse cleared after boom', !fuses.isLit(1, 2, 3));

// Blast strength: the block holding the charge (0.5 away) goes almost
// always, a block near the edge (2.5 away) sometimes survives, and anything
// past the radius never does.
let centre = 0, edge = 0;
for (let i = 0; i < 200; i++) {
  if (blastStrength(5.5, 5.5, 5.5, 5, 5, 5) > 0) centre++;
  if (blastStrength(5.5, 5.5, 5.5, 7, 5, 5) > 0) edge++;
}
check('charge block destroyed (almost always)', centre >= 180);
check('edge sometimes survives', edge > 0 && edge < 200);
check('outside radius never destroyed', blastStrength(5.5, 5.5, 5.5, 9, 5, 5) === 0);
check('fuse is 4 seconds', FUSE_SECONDS === 4);
check('blast radius is 3', BLAST_RADIUS === 3);

// ---- day/night helpers ----
const noon = sunDirection(0.25);
check('noon sun is overhead', noon.y > 0.9 && Math.abs(noon.x) < 0.2);
const midnight = sunDirection(0.75);
check('midnight sun is below', midnight.y < -0.9);
const dawn = sunDirection(0);
check('dawn sun is on the horizon', Math.abs(dawn.y) < 0.05);
check('sunlight peaks at noon', sunLight(0.25) > 0.9);
check('sunlight dies at night', sunLight(0.75) < 0.05);
check('moonlight is dim', moonLight(0.75) > 0 && moonLight(0.75) < 0.2);
check('clock reads six at dawn', clockString(0) === '06:00' || clockString(0) === '06:00');

// ---- blastBlocks actually reaches the blocks around the charge ----
// It takes the charge's block coordinates and adds the half itself; feeding
// it a world-space centre made the loop walk half-blocks and return nothing.
const stone = new Map();
const fakeWorld = {
  inBounds: () => true,
  get: (x, y, z) => stone.get(`${x},${y},${z}`) ?? 0,
};
// a 7x7x7 cube of stone centred on the charge
for (let y = 2; y <= 8; y++) for (let z = 2; z <= 8; z++) for (let x = 2; x <= 8; x++) {
  stone.set(`${x},${y},${z}`, 3);
}
const hit = blastBlocks(fakeWorld, 5, 5, 5);
check('blast finds the blocks around the charge', hit.length > 20);
check('blast includes the charge cell itself',
  hit.some((h) => h.x === 5 && h.y === 5 && h.z === 5));
// The edge of a blast is a lottery by design, so this counts rather than
// asserting: a neighbour one block out has a ~78% chance each time, and over
// 200 blasts it must come up most of the time and not every time.
let neighbourHits = 0;
for (let i = 0; i < 200; i++) {
  const h = blastBlocks(fakeWorld, 5, 5, 5);
  if (h.some((c) => c.x === 6 && c.y === 5 && c.z === 5)) neighbourHits++;
}
check('the immediate neighbours are usually taken', neighbourHits > 120);
check('...but not always', neighbourHits < 200);
check('blast returns whole block coordinates',
  hit.every((h) => Number.isInteger(h.x) && Number.isInteger(h.y) && Number.isInteger(h.z)));
check('blast never reaches past its radius',
  hit.every((h) => Math.hypot(h.x + 0.5 - 5.5, h.y + 0.5 - 5.5, h.z + 0.5 - 5.5) <= BLAST_RADIUS));
check('blast is sorted from the charge outward', hit[0].strength >= hit[hit.length - 1].strength);

// air and bedrock are not in the list
stone.set('6,5,5', 8); // bedrock
stone.set('4,5,5', 0); // air
const hit2 = blastBlocks(fakeWorld, 5, 5, 5);
check('blast leaves bedrock alone', !hit2.some((h) => h.x === 6 && h.y === 5 && h.z === 5));
check('blast skips air', !hit2.some((h) => h.x === 4 && h.y === 5 && h.z === 5));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
