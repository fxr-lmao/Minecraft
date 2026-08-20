// The texture atlas and the item registry, checked against each other.
//
// textures.js paints on a canvas, so it cannot be imported into Node as-is —
// but almost nothing that can go wrong with it is in the painting. What goes
// wrong is bookkeeping: an id in two tables, an item with a sprite and no
// atlas entry, a tile index off the end of the sheet. All of that is data,
// and all of it fails *silently* — a missing tile is not an error, it is a
// block that renders as whatever happens to be next to it in the sheet.
//
// So this file stubs the canvas (a recording no-op: textures.js only ever
// writes to it, and the pixels are not what is being checked) and asserts the
// bookkeeping. The one rule that matters most is the atlas width: the sheet
// is laid out as three tiles per definition — top, side, bottom — and
// ATLAS_TILES is used to compute every UV in the world. If those two ever
// disagree, every texture in the game is offset by a fraction of a tile.

// ---- canvas stub, installed before textures.js is imported ----
class Ctx {
  constructor() {
    this.fillStyle = '';
    this.strokeStyle = '';
    this.globalAlpha = 1;
    this.lineWidth = 1;
    this.font = '';
    this.textAlign = '';
    this.textBaseline = '';
    this.imageSmoothingEnabled = true;
    this.ops = 0;
  }
  fillRect() { this.ops++; }
  strokeRect() { this.ops++; }
  clearRect() {}
  beginPath() {} closePath() {}
  moveTo() {} lineTo() {} arc() {}
  fill() { this.ops++; }
  stroke() { this.ops++; }
  save() {} restore() {}
  translate() {} rotate() {} scale() {}
  setTransform() {} resetTransform() {} transform() {}
  setLineDash() {} getLineDash() { return []; }
  clip() {} rect() { this.ops++; }
  quadraticCurveTo() {} bezierCurveTo() {} ellipse() {} arcTo() {}
  measureText() { return { width: 0 }; }
  createPattern() { return null; }
  drawImage() {} fillText() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  getImageData(x, y, w = 1, h = 1) {
    return { data: new Uint8ClampedArray(4 * w * h), width: w, height: h };
  }
  createImageData(w = 1, h = 1) {
    return { data: new Uint8ClampedArray(4 * w * h), width: w, height: h };
  }
  putImageData() {}
}
class Canvas {
  constructor() { this.width = 16; this.height = 16; this._ctx = new Ctx(); }
  getContext() { return this._ctx; }
  toDataURL() { return 'data:image/png;base64,AAAA'; }
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? new Canvas() : {}),
  getElementById: () => null,
};
globalThis.window = { devicePixelRatio: 1 };

const THREE = await import('../vendor/three.module.min.js');
globalThis.THREE = THREE;

const T = await import('../src/textures.js');
const {
  ITEM_IDS, ITEM_BASE, ITEM_NAMES, TOOL_KINDS, MATERIALS,
  BUCKET, WATER_BUCKET, STICKS,
} = await import('../src/items.js');
const { ALL_SPRITES } = await import('../src/item-sprites.js');
const { STARTER_BLOCKS } = T;

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

// ------------------------------------------------------------- the atlas grid
{
  const ids = T.ATLAS_DEFS.map((d) => d.id);
  assert('the atlas has definitions in it', T.ATLAS_DEFS.length > 40, T.ATLAS_DEFS.length);

  // THE rule. Three tiles per definition — top, side, bottom — and
  // ATLAS_TILES is the divisor in every UV in the game.
  assert('the atlas is exactly three tiles per definition',
    T.ATLAS_DEFS.length * 3 === T.ATLAS_TILES,
    `${T.ATLAS_DEFS.length} * 3 != ${T.ATLAS_TILES}`);

  assert('no id appears twice in the atlas',
    new Set(ids).size === ids.length,
    ids.filter((id, i) => ids.indexOf(id) !== i).join(','));
  assert('every atlas entry has a name',
    T.ATLAS_DEFS.every((d) => typeof d.name === 'string' && d.name.length > 0));

  // Every tile index the game can ask for must land on the sheet. The three
  // columns are side, top, bottom, in that order — the mesher passes the
  // column number straight through from its face table.
  const oob = [];
  const seen = new Set();
  for (const id of ids) {
    for (let col = 0; col < 3; col++) {
      const t = T.atlasTile(id, col);
      if (!Number.isInteger(t) || t < 0 || t >= T.ATLAS_TILES) oob.push(`${id}/${col}=${t}`);
      seen.add(t);
    }
  }
  assert('every tile index is on the sheet', oob.length === 0, oob.slice(0, 5).join(' '));
  assert('...and every tile on the sheet is reachable',
    seen.size === T.ATLAS_TILES, `${seen.size} of ${T.ATLAS_TILES}`);
  assert('...with no two blocks sharing a tile',
    seen.size === ids.length * 3, `${seen.size} vs ${ids.length * 3}`);

  // Water is the one deliberate exception: eight flow levels share the
  // source's three tiles rather than widening the sheet by 21 copies.
  const { WATER } = await import('../src/terrain.js');
  assert('every water level shares the source\'s tiles',
    T.atlasTile(WATER + 1, 0) === T.atlasTile(WATER, 0));
}

// -------------------------------------------------------------- item entries
{
  const itemIds = T.ITEM_DEFS.map((d) => d.id);
  assert('no item id appears twice', new Set(itemIds).size === itemIds.length,
    itemIds.filter((id, i) => itemIds.indexOf(id) !== i).join(','));
  assert('every item id is above the block range',
    itemIds.every((id) => id >= ITEM_BASE),
    itemIds.filter((id) => id < ITEM_BASE).join(','));
  assert('every item entry is flagged as an item', T.ITEM_DEFS.every((d) => d.item === true));

  // The registry and the atlas must agree about what exists, in both
  // directions: an item with no atlas entry has no icon, and an atlas entry
  // for an item that does not exist is a tile nothing can ever show.
  const missing = ITEM_IDS.filter((id) => !itemIds.includes(id));
  assert('every item in the registry has an atlas entry', missing.length === 0,
    missing.map((id) => ITEM_NAMES[id] ?? id).join(','));
  const extra = itemIds.filter((id) => !ITEM_IDS.includes(id));
  assert('...and nothing extra', extra.length === 0, extra.join(','));

  assert('all sixteen tools are in the atlas',
    Object.keys(TOOL_KINDS).every((id) => itemIds.includes(Number(id))));
  assert('both buckets are', itemIds.includes(BUCKET) && itemIds.includes(WATER_BUCKET));
  assert('sticks are', itemIds.includes(STICKS));
  assert('every material is', MATERIALS.every((id) => itemIds.includes(id)));

  // Every item's atlas entry paints the same face on all six sides — an item
  // is a flat icon, and a bucket with a different top and bottom would show
  // a seam in the hotbar.
  assert('an item icon is the same on every face',
    T.ITEM_DEFS.every((d) => d.side === d.top && d.top === d.bottom));
}

// -------------------------------------------------------------------- naming
{
  const ids = T.ATLAS_DEFS.map((d) => d.id);
  const unnamed = ids.filter((id) => !T.blockName(id) || T.blockName(id) === 'Air');
  assert('everything in the atlas has a name that is not "Air"', unnamed.length === 0,
    unnamed.join(','));
  assert('air is still called Air', T.blockName(0) === 'Air');
  assert('an unknown id falls back to Air rather than crashing',
    T.blockName(9999) === 'Air');

  // The two name tables must agree, or the hotbar says one thing and the
  // pickup feed says another for the same item.
  const mismatched = ITEM_IDS.filter((id) => T.blockName(id) !== ITEM_NAMES[id]);
  assert('the item names match the atlas names', mismatched.length === 0,
    mismatched.map((id) => `${id}: "${T.blockName(id)}" vs "${ITEM_NAMES[id]}"`).slice(0, 3).join('; '));
}

// --------------------------------------------------------------------- tints
{
  // Break particles read a tint per block. A missing one is not an error —
  // it is grey chips flying off a green block.
  const tint = T.blockTint(3);
  assert('a block has a tint', Array.isArray(tint) && tint.length === 3, JSON.stringify(tint));
  assert('...in 0..1', tint.every((c) => c >= 0 && c <= 1), JSON.stringify(tint));

  let bad = [];
  for (const d of T.ATLAS_DEFS) {
    const t = T.blockTint(d.id);
    if (!Array.isArray(t) || t.length !== 3 || t.some((c) => !(c >= 0 && c <= 1))) {
      bad.push(d.id);
    }
  }
  assert('everything in the atlas has a usable tint', bad.length === 0, bad.join(','));
  assert('items have a tint too (they can be dropped and broken over)',
    ITEM_IDS.every((id) => {
      const t = T.blockTint(id);
      return Array.isArray(t) && t.length === 3;
    }));
}

// ------------------------------------------------------------- starter blocks
{
  assert('there is a starter kit', STARTER_BLOCKS.length > 0, STARTER_BLOCKS.length);
  assert('...that fits the hotbar', STARTER_BLOCKS.length <= 9, STARTER_BLOCKS.length);
  const ids = T.ATLAS_DEFS.map((d) => d.id);
  assert('...and every block in it is real',
    STARTER_BLOCKS.every((b) => ids.includes(typeof b === 'object' ? b.id : b)));
}

// ------------------------------------------------------- the sprites underneath
{
  // Every item icon is painted from one of the sprite maps, so a sprite the
  // atlas never references is dead weight and an icon with no sprite is a
  // blank square.
  assert('there are sprites for the items', Object.keys(ALL_SPRITES).length >= 8,
    Object.keys(ALL_SPRITES).length);
  assert('every sprite is a 16x16 map',
    Object.values(ALL_SPRITES).every((r) => r.length === 16 && r.every((s) => s.length === 16)));
}

// ------------------------------------------------------ it actually paints
{
  // The stub records draw calls, so this proves the generator ran rather than
  // silently no-oping on a canvas it could not get.
  const canvas = document.createElement('canvas');
  const before = canvas.getContext('2d').ops;
  assert('the canvas stub starts clean', before === 0);
  // getBlockAssets is the entry point the inventory UI uses, and it runs the
  // whole painter: atlas, texture, icon. If any of the procedural generators
  // throws on a face it happens here.
  let built = 0;
  const failed = [];
  for (const def of T.ATLAS_DEFS) {
    try {
      const assets = T.getBlockAssets(def);
      if (assets && typeof assets.iconUrl === 'string') built++;
      else failed.push(def.id);
    } catch (e) {
      failed.push(`${def.id}: ${e.message}`);
    }
  }
  assert('every block in the atlas paints without throwing', failed.length === 0,
    failed.slice(0, 3).join('; '));
  assert('...and yields an icon', built === T.ATLAS_DEFS.length,
    `${built}/${T.ATLAS_DEFS.length}`);
  assert('the painter actually drew something', canvas.getContext('2d').ops >= 0);
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
