// Mining: how long a block takes, what it leaves behind, and where the ore is.
//
// Two halves that fail differently. The times are a formula and a table, and
// the way to get them wrong is to make the wrong tool merely slower instead of
// three and a third times slower — which is the difference between a pickaxe
// being worth carrying and being worth ignoring.
//
// The ore is generation, and the way to get *that* wrong is for the two paths
// through it to disagree: chunks are filled a column at a time, holding one
// vein for the eight layers it covers, while `generatedBlock` answers for one
// block on its own. A drift between them is a seam at a chunk border, which is
// exactly the class of bug the cave tests already exist to catch.
import { World } from '../src/world.js';
import {
  breakTime, dropsFrom, toolMatches, blockRule, canHarvest, destroySpeed,
  toolNeeded, wrongTool, toolFamily, toolAdvantage,
  HAND, PICK, SPADE, AXE, BLADE, TICK, TOOLS,
} from '../src/mining.js';
import {
  BUCKET, PICKAXE, SHOVEL, WOOD_AXE, STONE_AXE, IRON_AXE, DIAMOND_AXE,
  WOOD_SWORD, IRON_SWORD, DIAMOND_SWORD,
  DIAMOND_PICKAXE, DIAMOND_SHOVEL, WOOD_PICKAXE, STONE_PICKAXE,
  COAL, RAW_IRON, RAW_GOLD, REDSTONE, DIAMOND, oreDrop,
} from '../src/items.js';
import {
  STONE, DEEPSLATE, DIRT, GRASS, SAND, LOG, LEAVES, BEDROCK, AIR, WATER, ICE,
  COBBLESTONE, PLANKS,
  COAL_ORE, IRON_ORE, GOLD_ORE, REDSTONE_ORE, DIAMOND_ORE, ORES, ORE_BANDS,
  DEEPSLATE_ORES, DEEPSLATE_DIAMOND_ORE, ORE_IDS, deepslateOre,
  VEIN_CELL, isOre, oreAt, generatedBlock, surfaceHeight, deepslateTop,
} from '../src/terrain.js';
import { WORLD_SEED, CHUNK_SIZE, WORLD_MIN_Y } from '../src/constants.js';
import { STARTER_BLOCKS } from '../src/textures.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ------------------------------------------------------------------- times
{
  // The numbers the wiki lists, which is the point of doing the arithmetic in
  // ticks: an iron pickaxe on stone is 0.4 s and not 0.375, because seven and
  // a half ticks is eight ticks.
  const cases = [
    ['stone by hand', STONE, 0, {}, 7.5],
    ['stone, iron pickaxe', STONE, PICKAXE, {}, 0.4],
    ['stone, wrong tool', STONE, SHOVEL, {}, 7.5],
    ['cobblestone, iron pickaxe', 4, PICKAXE, {}, 0.5],
    ['deepslate, iron pickaxe', DEEPSLATE, PICKAXE, {}, 0.75],
    ['dirt by hand', DIRT, 0, {}, 0.75],
    ['dirt, iron shovel', DIRT, SHOVEL, {}, 0.15],
    ['grass by hand', GRASS, 0, {}, 0.9],
    ['grass, iron shovel', GRASS, SHOVEL, {}, 0.15],
    ['sand, iron shovel', SAND, SHOVEL, {}, 0.15],
    ['leaves by hand', LEAVES, 0, {}, 0.3],
    ['oak log by hand', LOG, 0, {}, 3.0],
    ['snow block by hand', 9, 0, {}, 1.0],
    ['snow block, iron shovel', 9, SHOVEL, {}, 0.05],
    ['ice, iron pickaxe', ICE, PICKAXE, {}, 0.15],
    // ...and the two Minecraft docks you for, which multiply.
    ['stone, iron pickaxe, in the air', STONE, PICKAXE, { onGround: false }, 1.9],
    ['stone, iron pickaxe, head under', STONE, PICKAXE, { underwater: true }, 1.9],
    ['stone, iron pickaxe, swimming', STONE, PICKAXE,
      { onGround: false, underwater: true }, 9.4],
    ['dirt by hand, in the air', DIRT, 0, { onGround: false }, 3.75],
  ];
  for (const [name, id, held, where, want] of cases) {
    assert(name, near(breakTime(id, held, where), want), breakTime(id, held, where));
  }

  // The penalty is a fifth, and it is a fifth of the *speed*, so it lands as
  // five times the time on anything whose tick count was not already rounded.
  assert('off the ground is five times the work',
    near(breakTime(DIRT, 0, { onGround: false }), breakTime(DIRT, 0) * 5));
  assert('...and so is being under the water',
    near(breakTime(DIRT, 0, { underwater: true }), breakTime(DIRT, 0) * 5));
  assert('...and together they are twenty-five times',
    near(breakTime(DIRT, 0, { onGround: false, underwater: true }),
      breakTime(DIRT, 0) * 25));
  assert('standing on the floor in the air is the default',
    near(breakTime(STONE, PICKAXE), breakTime(STONE, PICKAXE, { onGround: true })));

  // The 30-against-100 is *can you harvest it*, not *is it the right tool* —
  // which is the whole difference between a pickaxe being no use on dirt and
  // a pickaxe being a penalty on dirt. It is neither: it is merely no help.
  assert('a pickaxe is no help against dirt, and no hindrance either',
    near(breakTime(DIRT, PICKAXE), breakTime(DIRT, 0)), breakTime(DIRT, PICKAXE));
  assert('a shovel against stone is the long constant',
    near(breakTime(STONE, SHOVEL), breakTime(STONE, 0)));
  assert('and a bucket is not a tool at all',
    near(breakTime(STONE, BUCKET), breakTime(STONE, 0)));
  assert('the wrong tool is ten times the right one on stone, not three',
    near(breakTime(STONE, SHOVEL) / breakTime(STONE, PICKAXE), 18.75),
    breakTime(STONE, SHOVEL) / breakTime(STONE, PICKAXE));

  assert('every break time is a whole number of ticks',
    [STONE, DIRT, GRASS, LEAVES, LOG, DEEPSLATE, ...ORE_IDS].every((id) =>
      [0, PICKAXE, SHOVEL].every((h) => {
        const t = breakTime(id, h);
        return Math.abs(t / TICK - Math.round(t / TICK)) < 1e-9;
      })));
  assert('nothing takes less than one tick',
    breakTime(9, SHOVEL) === TICK, breakTime(9, SHOVEL));

  assert('bedrock never breaks', breakTime(BEDROCK, PICKAXE) === Infinity);
  assert('air takes no time', breakTime(AIR, 0) === 0);
  assert('and neither does water', breakTime(WATER, 0) === 0);

  // Every ore is the same three seconds of rock, so what separates them is
  // where they are and not how hard they are.
  const times = ORE_IDS.map((id) => breakTime(id, PICKAXE));
  assert('every ore takes the same time to cut out of the rock',
    times.every((t) => near(t, times[0])), times.join(' '));
  assert('...which is deepslate\'s, not stone\'s',
    near(times[0], breakTime(DEEPSLATE, PICKAXE)), times[0]);
}

// ------------------------------------------------------------------- drops
{
  // Stone breaks into cobblestone, which is Minecraft's oldest rule and the
  // one that gives the furnace a job: you cannot dig stone out of the ground,
  // you cook it out of cobble.
  assert('stone comes away as cobblestone', dropsFrom(STONE, PICKAXE) === COBBLESTONE);
  // Minecraft's rule, and a surprising one the first time: bare hands break
  // stone eventually and get nothing for it.
  assert('...and by hand it breaks and gives nothing', dropsFrom(STONE, 0) === 0);
  // Ore drops what is *in* it, not the block it was in. This is the change
  // that turns the mine into a supply chain rather than a quarry for
  // decorative ore blocks.
  for (const ore of ORE_IDS) {
    assert(`ore needs the pickaxe (${ore})`, dropsFrom(ore, PICKAXE) === oreDrop(ore));
  }
  assert('coal ore drops coal', dropsFrom(COAL_ORE, PICKAXE) === COAL);
  assert('iron ore drops raw iron, for the furnace',
    dropsFrom(IRON_ORE, PICKAXE) === RAW_IRON);
  assert('gold ore drops raw gold', dropsFrom(GOLD_ORE, PICKAXE) === RAW_GOLD);
  assert('redstone ore drops dust', dropsFrom(REDSTONE_ORE, PICKAXE) === REDSTONE);
  assert('diamond ore drops a diamond, finished',
    dropsFrom(DIAMOND_ORE, PICKAXE) === DIAMOND);
  assert('the deepslate twins drop exactly the same thing',
    DEEPSLATE_ORES.every((id, i) => dropsFrom(id, PICKAXE) === dropsFrom(ORES[i], PICKAXE)));
  assert('the deepslate twins are ore too', DEEPSLATE_ORES.every(isOre)
    && DEEPSLATE_ORES.every((id) => dropsFrom(id, 0) === 0));
  assert('...and break in exactly the same time',
    near(breakTime(DEEPSLATE_DIAMOND_ORE, PICKAXE), breakTime(DIAMOND_ORE, PICKAXE)));
  assert('ore mined without one gives nothing', dropsFrom(DIAMOND_ORE, 0) === 0);
  assert('...and a shovel is no better', dropsFrom(DIAMOND_ORE, SHOVEL) === 0);
  assert('bedrock gives nothing even if it could break',
    dropsFrom(BEDROCK, PICKAXE) === 0);
  assert('dirt does not care what you use', dropsFrom(DIRT, 0) === DIRT
    && dropsFrom(DIRT, SHOVEL) === DIRT && dropsFrom(DIRT, PICKAXE) === DIRT);

  assert('a snow block wants the shovel, and gives nothing without it',
    dropsFrom(9, 0) === 0 && dropsFrom(9, SHOVEL) === 9 && wrongTool(9, PICKAXE));
  assert('...and the message names the tool it wanted',
    toolNeeded(9) === 'shovel' && toolNeeded(STONE) === 'pickaxe'
    && toolNeeded(LOG) === 'axe' && toolNeeded(LEAVES) === 'sword');
  assert('harvesting is what the drop keys off',
    ORE_IDS.every((id) => canHarvest(id, PICKAXE) && !canHarvest(id, 0))
    && canHarvest(DIRT, 0) && canHarvest(DIRT, PICKAXE));
  assert('the speed penalty is on the speed, not the block',
    destroySpeed(STONE, PICKAXE) === 6
    && destroySpeed(STONE, PICKAXE, { onGround: false }) === 1.2
    && destroySpeed(STONE, 0) === 1);

  assert('a pickaxe is what stone answers to',
    toolMatches(STONE, PICKAXE) && !toolMatches(STONE, SHOVEL));
  assert('a shovel is what dirt answers to',
    toolMatches(DIRT, SHOVEL) && !toolMatches(DIRT, PICKAXE));
  // The axe. Until it existed, `tool: HAND` meant every wooden block in the
  // game ignored what you were carrying, and the forest was the one place a
  // full hotbar of tools bought you nothing.
  assert('logs answer to the axe', blockRule(LOG).tool === AXE);
  assert('an axe is what a log answers to',
    toolMatches(LOG, IRON_AXE) && !toolMatches(LOG, PICKAXE) && !toolMatches(LOG, SHOVEL));
  assert('leaves answer to the sword', blockRule(LEAVES).tool === BLADE);
  assert('cobblestone and bricks are stone, and want the pickaxe stone wants',
    blockRule(4).tool === PICK && blockRule(4).needsTool
    && blockRule(7).tool === PICK && blockRule(7).needsTool);
  assert('planks are wood and want the axe', blockRule(PLANKS).tool === AXE
    && !blockRule(PLANKS).needsTool && near(breakTime(PLANKS, 0), breakTime(LOG, 0)));
  assert('...and wood still comes away bare-handed, only slowly',
    dropsFrom(LOG, 0) === LOG && dropsFrom(PLANKS, 0) === PLANKS);
  // Anything with no entry at all — an id from a future block — is stone-ish
  // and harvestable, so a block nobody has written a rule for is diggable
  // rather than a thing you can destroy and never collect.
  assert('and an id nobody has a rule for falls back to something usable',
    blockRule(199).tool === PICK && !blockRule(199).needsTool
    && dropsFrom(199, 0) === 199);

  // The hotbar has to be able to do the job it is handed.
  assert('you start with the pickaxe the ore needs',
    STARTER_BLOCKS.includes(PICKAXE), STARTER_BLOCKS.join(','));
  assert('...and the shovel for everything soft', STARTER_BLOCKS.includes(SHOVEL));
  assert('...and still the bucket', STARTER_BLOCKS.includes(BUCKET));
  assert('nine slots and no more', STARTER_BLOCKS.length === 9, STARTER_BLOCKS.length);
}

// -------------------------------------------------------------- ore in the rock
{
  // Both paths through generation have to agree, block for block. The column
  // filler holds one vein across the eight layers of its box; `generatedBlock`
  // asks about one block on its own. If they drift, a chunk border shows it.
  const w = new World(WORLD_SEED);
  let mismatch = null;
  let oresFound = 0;
  for (let x = 40; x < 56 && !mismatch; x++) {
    for (let z = 40; z < 56 && !mismatch; z++) {
      const h = surfaceHeight(x, z, WORLD_SEED);
      for (let y = h - 6; y > h - 60; y--) {
        const chunked = w.get(x, y, z);
        const single = generatedBlock(x, y, z, WORLD_SEED);
        // Caves are carved into the chunk after the column is filled and
        // `generatedBlock` knows about them too, so air on both sides is fine;
        // what must not differ is the rock.
        if (chunked !== single) { mismatch = `${x},${y},${z}: ${chunked} vs ${single}`; break; }
        if (isOre(chunked)) oresFound++;
      }
    }
  }
  assert('the chunk filler and the single-block generator agree about the rock',
    mismatch === null, mismatch ?? '');
  assert('...and there is ore in there to disagree about', oresFound > 40, oresFound);
}

// where the bands are
{
  const sample = (yFrom, yTo) => {
    const counts = new Map();
    for (let x = 0; x < 48; x++) {
      for (let z = 0; z < 48; z++) {
        for (let y = yFrom; y <= yTo; y++) {
          const ore = oreAt(x, y, z, WORLD_SEED);
          if (ore) counts.set(ore, (counts.get(ore) ?? 0) + 1);
        }
      }
    }
    return counts;
  };

  const deep = sample(-64, -50);
  const shallow = sample(30, 60);
  assert('diamond is only down at the bottom',
    (deep.get(DIAMOND_ORE) ?? 0) > 0 && (shallow.get(DIAMOND_ORE) ?? 0) === 0,
    `${deep.get(DIAMOND_ORE) ?? 0} deep, ${shallow.get(DIAMOND_ORE) ?? 0} shallow`);
  assert('gold keeps it company', (deep.get(GOLD_ORE) ?? 0) > 0
    && (shallow.get(GOLD_ORE) ?? 0) === 0);
  assert('coal is the one you find near the surface',
    (shallow.get(COAL_ORE) ?? 0) > 0, shallow.get(COAL_ORE) ?? 0);
  // ...and only near it. The bottom of the world is for the things worth the
  // walk down, which is the whole reason to dig past the stone at all.
  assert('...and is not down at the bottom at all',
    (deep.get(COAL_ORE) ?? 0) === 0, deep.get(COAL_ORE) ?? 0);
  assert('what is down there is redstone and better',
    (deep.get(REDSTONE_ORE) ?? 0) > 0 && (deep.get(DIAMOND_ORE) ?? 0) > 0,
    `${deep.get(REDSTONE_ORE) ?? 0} redstone, ${deep.get(DIAMOND_ORE) ?? 0} diamond`);
  assert('iron sits between them', (sample(0, 30).get(IRON_ORE) ?? 0) > 0);

  // Rarity, in the order everyone expects.
  const all = sample(-64, 60);
  const n = (id) => all.get(id) ?? 0;
  assert('coal is commoner than iron, iron than gold, gold than diamond',
    n(COAL_ORE) > n(IRON_ORE) && n(IRON_ORE) > n(GOLD_ORE) && n(GOLD_ORE) > n(DIAMOND_ORE),
    [n(COAL_ORE), n(IRON_ORE), n(GOLD_ORE), n(REDSTONE_ORE), n(DIAMOND_ORE)].join('/'));
  // Sparse enough to be worth finding: a couple of percent of the rock.
  const total = 48 * 48 * 125;
  const share = [...all.values()].reduce((a, b) => a + b, 0) / total;
  assert('and ore is a small fraction of the rock', share > 0.005 && share < 0.06,
    share.toFixed(4));
}

// the rock the vein is in
{
  // The ore is one decision and the rock it sits in is another, and the
  // second one is not the vein's business: below the deepslate line the same
  // vein comes out as its deepslate twin, because a stone-backed ore there is
  // a bright grey patch in a near-black wall — you can see the block, which
  // is the one thing a block must never do.
  const w = new World(WORLD_SEED);
  let stoneInDeep = null;
  let deepInStone = null;
  let deepFound = 0;
  let shallowFound = 0;
  for (let x = 60; x < 76 && !stoneInDeep && !deepInStone; x++) {
    for (let z = 60; z < 76; z++) {
      const line = deepslateTop(x, z, WORLD_SEED);
      for (let y = WORLD_MIN_Y + 1; y < 60; y++) {
        const id = w.get(x, y, z);
        if (!isOre(id)) continue;
        const deep = DEEPSLATE_ORES.includes(id);
        if (y <= line) {
          deepFound++;
          if (!deep) stoneInDeep = `${id} at y=${y}, line ${line}`;
        } else {
          shallowFound++;
          if (deep) deepInStone = `${id} at y=${y}, line ${line}`;
        }
      }
    }
  }
  assert('ore below the deepslate line is drawn in deepslate',
    stoneInDeep === null, stoneInDeep ?? `${deepFound} checked`);
  assert('...and ore above it is not', deepInStone === null,
    deepInStone ?? `${shallowFound} checked`);
  assert('both rocks actually turned up in the sample',
    deepFound > 0 && shallowFound > 0, `${deepFound} deep, ${shallowFound} shallow`);
  assert('the twin is one addition away',
    ORES.every((id, i) => deepslateOre(id) === DEEPSLATE_ORES[i]));
}

// veins are blobs, and they stay inside their box
{
  let outside = null;
  for (let bx = 0; bx < 6 && !outside; bx++) {
    for (let by = -8; by < 0 && !outside; by++) {
      for (let bz = 0; bz < 6 && !outside; bz++) {
        // Every ore block in this box must belong to this box's vein, which
        // is what makes the two generation paths able to agree at all.
        for (let x = bx * VEIN_CELL; x < (bx + 1) * VEIN_CELL; x++) {
          for (let y = by * VEIN_CELL; y < (by + 1) * VEIN_CELL; y++) {
            for (let z = bz * VEIN_CELL; z < (bz + 1) * VEIN_CELL; z++) {
              const here = oreAt(x, y, z, WORLD_SEED);
              if (!here) continue;
              // A vein is one ore, never a mixture.
              for (let x2 = bx * VEIN_CELL; x2 < (bx + 1) * VEIN_CELL; x2++) {
                for (let z2 = bz * VEIN_CELL; z2 < (bz + 1) * VEIN_CELL; z2++) {
                  const other = oreAt(x2, y, z2, WORLD_SEED);
                  if (other && other !== here) outside = `${x},${y},${z} has ${here} and ${other}`;
                }
              }
            }
          }
        }
      }
    }
  }
  assert('a box holds one kind of ore or none', outside === null, outside ?? '');

  const bands = new Map(ORE_BANDS.map((b) => [b.id, b]));
  let strayed = null;
  for (let x = 0; x < 24 && !strayed; x++) {
    for (let z = 0; z < 24 && !strayed; z++) {
      for (let y = WORLD_MIN_Y; y < 80; y++) {
        const ore = oreAt(x, y, z, WORLD_SEED);
        if (!ore) continue;
        const band = bands.get(ore);
        if (y < band.min || y > band.max) { strayed = `${ore} at y=${y}`; break; }
      }
    }
  }
  assert('nothing is found outside the band it belongs to', strayed === null, strayed ?? '');
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
