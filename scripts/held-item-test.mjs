// The three-dimensional held item: the extruder, the box models, the pose
// tables and the item registry that feeds them.
//
// Everything here is pure — arrays of numbers in, arrays of numbers out — so
// the whole of the geometry can be checked in Node without a WebGL context.
// That matters more than usual for this feature, because the failure mode of
// a mesher is not an exception, it is a shape that is subtly wrong in a way
// you only notice from one angle: a face wound backwards is invisible from
// outside and visible from within, a run merged twice z-fights, a sprite one
// character short comes out with a transparent stripe down its edge.
//
// So the tests are mostly invariants rather than golden values:
//
//   * every triangle's winding agrees with its stated normal
//   * no two faces occupy the same place pointing the same way
//   * every model is genuinely three-dimensional (this is the whole point —
//     the old sprites were 0.02 thick and vanished edge-on)
//   * every model is inside the unit cube it claims to be scaled to
//   * every item that can be held has a model, a pose and a grip
//   * the mesher is a *mesher* — it merges runs, so a solid rectangle costs
//     far fewer triangles than one box per pixel would

import {
  buildExtrudedSprite, buildBoxModel, buildBucketModel, bucketBoxes,
  buildSolidModel, spriteCells, parseHex, meshBounds, coincidentFaces,
  windingErrors, MeshBuilder, shade, SPRITE_DEPTH, SPRITE_SIZE, FACE_SHADE,
} from '../src/held-geometry.js';
import {
  modelSpec, poseKind, firstPersonPose, thirdPersonPose,
  FIRST_PERSON_POSES, THIRD_PERSON_POSES, GRIP_HEIGHT, MODELLED_ITEMS,
  SHAPE_SPRITES, SHAPE_DEPTH, TIER_PALETTES, swingsLikeTool,
  POSE_KIND_BLOCK, POSE_KIND_TOOL, POSE_KIND_BUCKET, POSE_KIND_FLAT,
} from '../src/item-models.js';
import {
  BUCKET, WATER_BUCKET, PICKAXE, SHOVEL, STICKS,
  WOOD_PICKAXE, STONE_PICKAXE, DIAMOND_PICKAXE,
  WOOD_AXE, STONE_AXE, IRON_AXE, DIAMOND_AXE,
  WOOD_SWORD, STONE_SWORD, IRON_SWORD, DIAMOND_SWORD,
  DIAMOND_SHOVEL, COAL, RAW_IRON, IRON_INGOT, DIAMOND,
  RAW_GOLD, GOLD_INGOT, REDSTONE,
  ITEM_IDS, ITEM_NAMES, ITEM_SHAPES, TOOL_KINDS, isItem, itemShape,
  isSword, isAxe, isMaterial, toolKind, oreDrop, MATERIALS,
  SHAPE_PICKAXE, SHAPE_SHOVEL, SHAPE_AXE, SHAPE_SWORD, SHAPE_BUCKET,
  SHAPE_STICK, SHAPE_LUMP,
  TIER_WOOD, TIER_STONE, TIER_IRON, TIER_DIAMOND, ITEM_BASE,
} from '../src/items.js';
import {
  HAFT, HEAD_IRON, HEAD_WOOD, HEAD_STONE, HEAD_DIAMOND,
  PICKAXE_PX, SHOVEL_PX, AXE_PX, SWORD_PX, STICK_PX,
  COAL_PX, RAW_IRON_PX, IRON_INGOT_PX, DIAMOND_PX, ALL_SPRITES,
  COAL_PALETTE, DIAMOND_PALETTE, BUCKET_PALETTE, BUCKET_PX,
} from '../src/item-sprites.js';
import { MAX_DURABILITY, TIER_DURABILITY, isTool } from '../src/durability.js';

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** Build whatever model an id calls for, the way held-item.js does. */
function meshFor(id) {
  const spec = modelSpec(id);
  if (!spec) return null;
  if (spec.kind === 'bucket') return buildBucketModel(spec.full);
  if (spec.kind === 'solid') return buildSolidModel(spec.parts);
  return buildExtrudedSprite(spec.rows, spec.palette, spec);
}

// --------------------------------------------------------------- primitives
{
  assert('hex parses', near(parseHex('#ff8000')[0], 1) && near(parseHex('#ff8000')[2], 0));
  assert('...to the right green', near(parseHex('#008000')[1], 128 / 255));
  let threw = false;
  try { parseHex('nope'); } catch { threw = true; }
  assert('a bad colour throws rather than coming out black', threw);
  threw = false;
  try { parseHex('#fff'); } catch { threw = true; }
  assert('...and so does a three-digit one', threw);

  assert('shade darkens', shade([1, 1, 1], 0.5)[0] === 0.5);
  assert('shade clamps at white', shade([1, 1, 1], 2)[0] === 1);

  const mb = new MeshBuilder();
  mb.quad([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [0, 0, 1], [1, 0, 0]);
  assert('a quad is two triangles', mb.triangles === 2);
  const built = mb.build();
  assert('...with three vertices each', built.positions.length === 18);
  assert('...each carrying a normal and a colour',
    built.normals.length === 18 && built.colors.length === 18);
  assert('a quad is wound to face its normal', windingErrors(built) === 0);
}

// ------------------------------------------------------------- sprite cells
{
  const { size, cells } = spriteCells(PICKAXE_PX, { ...HAFT, ...HEAD_IRON });
  assert('a sprite is 16 wide', size === SPRITE_SIZE);
  assert('...and 256 cells', cells.length === 256);
  const opaque = cells.filter(Boolean).length;
  assert('the pickaxe has a sensible number of opaque cells',
    opaque > 40 && opaque < 200, opaque);

  // The mirror is the thing that puts a tool's handle in the hand rather
  // than out in space, so it had better actually mirror.
  const plain = spriteCells(STICK_PX, HAFT);
  const flipped = spriteCells(STICK_PX, HAFT, { mirrorX: true });
  let mirrored = true;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const a = plain.cells[y * 16 + x];
      const b = flipped.cells[y * 16 + (15 - x)];
      if (Boolean(a) !== Boolean(b)) mirrored = false;
    }
  }
  assert('mirrorX flips the map left to right', mirrored);
  assert('...and keeps the same number of pixels',
    plain.cells.filter(Boolean).length === flipped.cells.filter(Boolean).length);

  // A letter with no colour is a hole, not a crash — same as Minecraft's
  // own behaviour with an incomplete texture.
  const holey = spriteCells(PICKAXE_PX, HAFT); // no head colours at all
  assert('a missing palette entry is a hole, not an exception',
    holey.cells.filter(Boolean).length < opaque);

  let threw = false;
  try { spriteCells(['....'], HAFT); } catch { threw = true; }
  assert('a sprite of the wrong height throws', threw);
  threw = false;
  try { spriteCells([...STICK_PX.slice(0, 15), '...'], HAFT); } catch { threw = true; }
  assert('...and so does a short row', threw);
}

// ------------------------------------------------------- the extruder itself
{
  // The simplest possible case, checked exactly: a single opaque pixel is a
  // cube, which is six faces, which is twelve triangles.
  const one = [
    'X...............',
    ...Array(15).fill('................'),
  ];
  const cube = buildExtrudedSprite(one, { X: '#ffffff' });
  assert('one pixel extrudes to one cube', cube.triangles === 12, cube.triangles);
  assert('...wound correctly', windingErrors(cube) === 0);
  assert('...with no doubled faces', coincidentFaces(cube) === 0);

  // Two neighbouring pixels of the same colour must NOT be two cubes. The
  // face between them is interior and never generated, and every remaining
  // face merges with its twin, so the pair costs exactly what one pixel
  // does: six faces. Two cubes would be 24 triangles.
  const two = [
    'XX..............',
    ...Array(15).fill('................'),
  ];
  const pair = buildExtrudedSprite(two, { X: '#ffffff' });
  assert('two pixels are one box, not two cubes', pair.triangles === 12, pair.triangles);
  assert('...and no wall is left between them', coincidentFaces(pair) === 0);

  // A 4x4 block of one colour is still just a box: 6 faces if the greedy
  // merge is working in both directions. Row-merging alone would give 4
  // strips on the front, 4 on the back, and 24 triangles.
  const square = [
    ...Array(4).fill('XXXX............'),
    ...Array(12).fill('................'),
  ];
  const slab = buildExtrudedSprite(square, { X: '#ffffff' });
  assert('a 4x4 square merges to six faces', slab.triangles === 12, slab.triangles);

  // Two colours side by side must not merge, because the colour is what the
  // merge is keyed on — but they are still one solid, so the wall between
  // them is not drawn. Front 2, back 2, top 2, bottom 2, one cap each end:
  // ten quads, where two separate cubes would be twelve.
  const striped = [
    'XY..............',
    ...Array(15).fill('................'),
  ];
  const stripes = buildExtrudedSprite(striped, { X: '#ffffff', Y: '#000000' });
  assert('different colours do not merge', stripes.triangles === 20, stripes.triangles);
  assert('...and still leave no interior wall', coincidentFaces(stripes) === 0);
  assert('...and the two halves keep their own colours',
    stripes.colors.some((c) => c > 0.9) && stripes.colors.some((c) => c < 0.1));

  // A hole in the middle of a slab: the interior silhouette has to be walled.
  const donut = [
    'XXX.............',
    'X.X.............',
    'XXX.............',
    ...Array(13).fill('................'),
  ];
  const ring = buildExtrudedSprite(donut, { X: '#ffffff' });
  assert('a hole in the middle gets its own walls', ring.triangles > 12, ring.triangles);
  assert('...wound outward from the solid', windingErrors(ring) === 0);
  assert('...with nothing doubled', coincidentFaces(ring) === 0);

  // Depth and scale.
  const thick = buildExtrudedSprite(one, { X: '#ffffff' }, { depth: 0.5 });
  const tb = meshBounds(thick);
  assert('depth is honoured', near(tb.size[2], 0.5), tb.size[2]);
  const scaled = buildExtrudedSprite(one, { X: '#ffffff' }, { scale: 2 });
  const sb = meshBounds(scaled);
  assert('scale is honoured', near(sb.size[0], 2 / 16), sb.size[0]);

  // The default depth is Minecraft's one texel.
  const dflt = meshBounds(buildExtrudedSprite(one, { X: '#ffffff' }));
  assert('the default depth is one texel', near(dflt.size[2], SPRITE_DEPTH), dflt.size[2]);

  // Face shading: the bottom is darker than the top, always, so the shape
  // survives being lit from an unhelpful direction.
  assert('the bottom face is darkest', FACE_SHADE.bottom < FACE_SHADE.left);
  assert('the front face is full brightness', FACE_SHADE.front === 1);
  const colours = new Set();
  for (let i = 0; i < cube.colors.length; i += 3) colours.add(cube.colors[i].toFixed(4));
  assert('one white pixel comes out in several shades', colours.size >= 4, colours.size);

  // An empty sprite is an empty mesh, not a crash.
  const empty = buildExtrudedSprite(Array(16).fill('................'), {});
  assert('an empty sprite makes no triangles', empty.triangles === 0);
  assert('...and has no bounds', meshBounds(empty) === null);
}

// --------------------------------------------------------------- box models
{
  const one = buildBoxModel([{ from: [0, 0, 0], to: [16, 16, 16], color: '#ffffff' }]);
  assert('a full box is six faces', one.triangles === 12);
  assert('...wound outward', windingErrors(one) === 0);
  const b = meshBounds(one);
  assert('a 16-texel box fills the unit cube',
    near(b.size[0], 1) && near(b.size[1], 1) && near(b.size[2], 1), JSON.stringify(b.size));
  assert('...centred on the origin', near(b.min[0], -0.5) && near(b.max[0], 0.5));

  const partial = buildBoxModel([
    { from: [0, 0, 0], to: [8, 8, 8], color: '#ffffff', faces: ['top'] },
  ]);
  assert('a box can be given only the faces it needs', partial.triangles === 2);

  let threw = false;
  try { buildBoxModel([{ from: [4, 0, 0], to: [4, 8, 8], color: '#fff000' }]); } catch { threw = true; }
  assert('a zero-width box throws rather than making a nothing', threw);
  threw = false;
  try { buildBoxModel([{ from: [0, 0, 0], to: [8, 8, 8], color: '#ffffff', faces: ['sideways'] }]); } catch { threw = true; }
  assert('an unknown face name throws', threw);
}

// ------------------------------------------------------------------ buckets
{
  const empty = buildBucketModel(false);
  const full = buildBucketModel(true);
  assert('the empty bucket is a solid', empty.triangles > 60, empty.triangles);
  assert('the full one has more in it than the empty one',
    full.triangles > empty.triangles, `${full.triangles} vs ${empty.triangles}`);
  assert('neither has a doubled face',
    coincidentFaces(empty) === 0 && coincidentFaces(full) === 0);
  assert('neither has a backwards one',
    windingErrors(empty) === 0 && windingErrors(full) === 0);

  // A bucket is a *vessel*: the pail has to be as deep as it is wide, or it
  // is a picture of a bucket again — which is exactly what it used to be.
  // (The overall bounds are wider than they are deep because the handle
  // stands out to the sides, so the pail is measured from the boxes.)
  const b = meshBounds(full);
  const pail = bucketBoxes(true).filter((box) => box.from[0] >= 3 && box.to[0] <= 13);
  const spanX = Math.max(...pail.map((x) => x.to[0])) - Math.min(...pail.map((x) => x.from[0]));
  const spanZ = Math.max(...pail.map((x) => x.to[2])) - Math.min(...pail.map((x) => x.from[2]));
  assert('the pail is as deep as it is wide', spanX === spanZ, `${spanX} vs ${spanZ}`);
  assert('the bucket has real depth', b.size[2] > 0.5, b.size[2]);
  assert('...and fits inside its unit cube',
    b.min.every((v) => v >= -0.501) && b.max.every((v) => v <= 0.501), JSON.stringify(b));

  // The water sits *inside* the walls, which is the whole reason it is a box
  // model rather than a sprite.
  const boxes = bucketBoxes(true);
  const water = boxes.filter((box) => box.color.startsWith('#4d86') || box.color.startsWith('#2a4f'));
  assert('a full bucket has water boxes in it', water.length >= 1, water.length);
  const wall = boxes.find((box) => box.from[0] === 3 && box.to[0] === 4);
  assert('the wall is one texel thick', wall && wall.to[0] - wall.from[0] === 1);
  for (const w of water) {
    assert('the water is inside the walls',
      w.from[0] >= 4 && w.to[0] <= 12 && w.from[2] >= 4 && w.to[2] <= 12,
      JSON.stringify(w.from));
    assert('...and below the rim', w.to[1] <= 11, w.to[1]);
  }
  assert('an empty bucket has no water in it',
    bucketBoxes(false).every((box) => !box.color.startsWith('#4d86') && !box.color.startsWith('#2a4f')));

  // The handle stands proud of the walls, which is what makes it read as a
  // handle rather than as a stripe.
  const handles = bucketBoxes(false).filter((box) => box.from[0] < 3 || box.to[0] > 13);
  assert('the bucket has a handle outside its walls', handles.length >= 2, handles.length);

  // ...and the bucket is *open*, which is the one thing about it that is not
  // decoration and the one thing nothing above was checking.
  //
  // A box model has no holes, so the mouth is whatever the boxes leave
  // uncovered — and a rim written as one slab across the whole footprint
  // draws a top face straight over it. That is a lid: the inner walls, the
  // floor and the water plane are all still built, all still correct, and
  // none of them can ever be seen. Nothing else here catches it, because a
  // lid is not a doubled face, a backwards face or an out-of-bounds one.
  //
  // So: drop a ray down each cell of the mouth and ask what stops it. The
  // handle bar legitimately crosses the middle (z 7..9) — a bucket handle
  // does — so the test asks about the cells beside it.
  const ALL_SIX = ['front', 'back', 'left', 'right', 'top', 'bottom'];
  const topSurfaceAt = (boxes, x, z, above) => {
    let best = null;
    for (const box of boxes) {
      const [fx, , fz] = box.from;
      const [tx, ty, tz] = box.to;
      if (x < fx || x > tx || z < fz || z > tz) continue;
      if (ty <= above) continue;
      if (!(box.faces ?? ALL_SIX).includes('top')) continue;
      if (!best || ty > best.to[1]) best = box;
    }
    return best;
  };
  const mouth = [];
  for (let x = 4.5; x < 12; x++) {
    for (let z = 4.5; z < 12; z++) {
      if (z > 6.9 && z < 9.1) continue; // the handle crosses here
      mouth.push([x, z]);
    }
  }
  const litFull = mouth.filter(([x, z]) => {
    const hit = topSurfaceAt(bucketBoxes(true), x, z, 10);
    return hit === null;
  });
  assert('nothing roofs over the mouth of a full bucket', litFull.length === mouth.length,
    `${litFull.length} of ${mouth.length} cells open`);
  const litEmpty = mouth.filter(([x, z]) => topSurfaceAt(bucketBoxes(false), x, z, 2) === null);
  assert('...nor over an empty one, so you can see its floor',
    litEmpty.length === mouth.length, `${litEmpty.length} of ${mouth.length} cells open`);
  // And what you see through it is the water, not the underside of a rim.
  const seen = topSurfaceAt(bucketBoxes(true), 5.5, 5.5, 2);
  assert('looking into a full bucket you see water',
    seen && (seen.color.startsWith('#4d86') || seen.color.startsWith('#2a4f')),
    seen && seen.color);
}

// ------------------------------------------------- every held item, in bulk
{
  for (const id of MODELLED_ITEMS) {
    const name = ITEM_NAMES[id] ?? id;
    const spec = modelSpec(id);
    assert(`${name} has a model spec`, Boolean(spec));
    if (!spec) continue;

    const mesh = meshFor(id);
    assert(`${name} builds triangles`, mesh.triangles > 8, mesh.triangles);
    assert(`${name} is wound correctly`, windingErrors(mesh) === 0, windingErrors(mesh));
    assert(`${name} has no doubled faces`, coincidentFaces(mesh) === 0, coincidentFaces(mesh));

    const b = meshBounds(mesh);
    // The point of the whole exercise: nothing you can hold is flat any more.
    // The old sprites were 0.02 deep and disappeared when seen edge-on.
    assert(`${name} has real thickness`, b.size[2] >= 1 / 16 - 1e-9, b.size[2]);
    assert(`${name} fits its unit cube`,
      b.min.every((v) => v >= -0.51) && b.max.every((v) => v <= 0.51),
      JSON.stringify(b.size));
    assert(`${name} is not a sliver`, b.size[0] > 0.1 && b.size[1] > 0.1,
      `${b.size[0]}x${b.size[1]}`);

    // Poses and grips.
    assert(`${name} has a first-person pose`, Boolean(firstPersonPose(id)));
    assert(`${name} has a third-person pose`, Boolean(thirdPersonPose(id)));
    const shape = itemShape(id);
    assert(`${name} has a grip height`, GRIP_HEIGHT[shape] !== undefined, shape);
  }
}

// ----------------------------------------------------------- the solid tools
{
  // The tools are built from cuboids and hexahedra now, not extruded from
  // their icons, and the shape facts are three-dimensional: a sword blade
  // tapers to a point, an axe head ends in a cutting edge, a pickaxe head
  // curves down over its haft, a shovel flares toward the ground. Each is
  // pinned from the vertex data directly.

  const sword = meshFor(IRON_SWORD);
  const pick = meshFor(PICKAXE);
  const axe = meshFor(IRON_AXE);
  const shovel = meshFor(SHOVEL);
  const pos = (m) => m.positions;

  /** The x-span of vertices above `y` (model units). */
  const spanAbove = (mesh, y) => {
    const p = pos(mesh);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] < y) continue;
      min = Math.min(min, p[i]);
      max = Math.max(max, p[i]);
    }
    return max - min;
  };

  /** Whether some vertex sits inside the given |x| / y window. */
  const hasVertex = (mesh, test) => {
    const p = pos(mesh);
    for (let i = 0; i < p.length; i += 3) {
      if (test(p[i], p[i + 1], p[i + 2])) return true;
    }
    return false;
  };

  const extremes = (mesh) => {
    const p = pos(mesh);
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      minZ = Math.min(minZ, p[i + 2]);
      maxZ = Math.max(maxZ, p[i + 2]);
      minX = Math.min(minX, p[i]);
      maxX = Math.max(maxX, p[i]);
    }
    return { minZ, maxZ, minX, maxX };
  };

  // The sword blade narrows to nearly nothing at the tip and is broad at
  // the guard.
  assert('a sword blade tapers to a point',
    spanAbove(sword, 0.35) < 0.04 && spanAbove(sword, -0.2) > 0.3,
    `${spanAbove(sword, 0.35).toFixed(3)} at tip vs ${spanAbove(sword, -0.2).toFixed(3)} at guard`);

  // The axe's cutting edge: in front of the poll (z), and hanging below
  // the poll's own bottom so the blade visibly slopes down to it.
  const axeExt = extremes(axe);
  assert('an axe head ends in a cutting edge in front of its poll',
    axeExt.maxZ > 0.08 && axeExt.minZ < -0.1,
    `z ${axeExt.minZ.toFixed(3)}..${axeExt.maxZ.toFixed(3)}`);
  assert('...and the edge hangs below the poll',
    hasVertex(axe, (x, y, z) => z > 0.08 && y < 0.1),
    'no low front vertex');

  // The pickaxe head curves down past the haft's top and out past its
  // sides — the arch is the whole of a pickaxe.
  assert('a pickaxe head reaches below the top of the haft',
    hasVertex(pick, (x, y, z) => Math.abs(x) > 0.35 && y < 0.21),
    'no low tip vertex');
  const pickExt = extremes(pick);
  assert('...and out past the haft on both sides',
    pickExt.maxX - pickExt.minX > 0.5, (pickExt.maxX - pickExt.minX).toFixed(3));

  // The shovel flares toward the digging edge: wider at the bottom than at
  // the neck.
  const widthNear = (mesh, y, tol) => {
    const p = pos(mesh);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i + 1] - y) > tol) continue;
      min = Math.min(min, p[i]);
      max = Math.max(max, p[i]);
    }
    return max - min;
  };
  assert('a shovel blade flares toward the ground',
    widthNear(shovel, -0.48, 0.01) > widthNear(shovel, 0.19, 0.01) + 0.15,
    `${widthNear(shovel, -0.48, 0.01).toFixed(3)} vs ${widthNear(shovel, 0.19, 0.01).toFixed(3)}`);

  // The whole point of building from parts: every face is solid, nothing
  // is doubled, nothing is wound backwards — even the blade points where
  // two faces meet at a single vertex.
  for (const [name, mesh] of [['sword', sword], ['pickaxe', pick], ['axe', axe], ['shovel', shovel]]) {
    assert(`the ${name} is wound correctly`, windingErrors(mesh) === 0, windingErrors(mesh));
    assert(`...with nothing doubled`, coincidentFaces(mesh) === 0, coincidentFaces(mesh));
  }
}

// ---------------------------------------------------------- the item registry
{
  assert('every atlas id is above the block range', ITEM_IDS.every((id) => id >= ITEM_BASE));
  assert('no duplicate item ids', new Set(ITEM_IDS).size === ITEM_IDS.length);
  assert('every item has a name', ITEM_IDS.every((id) => Boolean(ITEM_NAMES[id])));
  assert('every item is recognised as one', ITEM_IDS.every(isItem));
  assert('no block id is mistaken for an item',
    [0, 1, 3, 13, 21, 36, 199].every((id) => !isItem(id)));

  // Four shapes, four tiers, and every combination present.
  const shapes = [SHAPE_PICKAXE, SHAPE_SHOVEL, SHAPE_AXE, SHAPE_SWORD];
  const tiers = [TIER_WOOD, TIER_STONE, TIER_IRON, TIER_DIAMOND];
  for (const shape of shapes) {
    for (const tier of tiers) {
      const found = Object.entries(TOOL_KINDS)
        .find(([, k]) => k.shape === shape && k.tier === tier);
      assert(`there is a ${tier} ${shape}`, Boolean(found));
    }
  }
  assert('sixteen tools in all', Object.keys(TOOL_KINDS).length === 16,
    Object.keys(TOOL_KINDS).length);

  assert('a sword knows it is one',
    isSword(IRON_SWORD) && isSword(DIAMOND_SWORD) && !isSword(IRON_AXE));
  assert('an axe knows it is one',
    isAxe(IRON_AXE) && isAxe(WOOD_AXE) && !isAxe(PICKAXE));
  assert('a material is not a tool',
    MATERIALS.every(isMaterial) && !isMaterial(PICKAXE) && !isMaterial(BUCKET));
  assert('toolKind reports both halves',
    toolKind(DIAMOND_AXE).shape === SHAPE_AXE && toolKind(DIAMOND_AXE).tier === TIER_DIAMOND);
  assert('a bucket has no tool kind', toolKind(BUCKET) === null);

  // Shapes and depths line up.
  for (const shape of shapes) {
    assert(`${shape} has a sprite`, Array.isArray(SHAPE_SPRITES[shape]));
    assert(`${shape} has a depth`, SHAPE_DEPTH[shape] > 0);
  }
  for (const tier of tiers) {
    assert(`${tier} has a head palette`, Boolean(TIER_PALETTES[tier]));
  }

  // Tiers of the same shape are the same *shape*: same triangles, different
  // colours. A stone pickaxe that is a different silhouette from an iron one
  // is a bug in the palette table.
  const woodPick = meshFor(WOOD_PICKAXE);
  const ironPick = meshFor(PICKAXE);
  const diaPick = meshFor(DIAMOND_PICKAXE);
  assert('every pickaxe tier is the same shape',
    woodPick.triangles === ironPick.triangles && ironPick.triangles === diaPick.triangles,
    `${woodPick.triangles}/${ironPick.triangles}/${diaPick.triangles}`);
  assert('...but not the same colours',
    woodPick.colors.some((c, i) => Math.abs(c - ironPick.colors[i]) > 0.02));
  assert('an axe is a different shape from a pickaxe',
    meshFor(IRON_AXE).triangles !== ironPick.triangles);
  assert('a sword is a different shape again',
    meshFor(IRON_SWORD).triangles !== meshFor(IRON_AXE).triangles);
}

// ------------------------------------------------------------------- poses
{
  assert('a block poses as a block', poseKind(1) === POSE_KIND_BLOCK);
  assert('a tool poses as a tool',
    poseKind(PICKAXE) === POSE_KIND_TOOL && poseKind(DIAMOND_SWORD) === POSE_KIND_TOOL);
  assert('a bucket poses as a bucket',
    poseKind(BUCKET) === POSE_KIND_BUCKET && poseKind(WATER_BUCKET) === POSE_KIND_BUCKET);
  assert('a lump poses flat', poseKind(COAL) === POSE_KIND_FLAT
    && poseKind(IRON_INGOT) === POSE_KIND_FLAT);
  assert('sticks pose flat too', poseKind(STICKS) === POSE_KIND_FLAT);

  for (const table of [FIRST_PERSON_POSES, THIRD_PERSON_POSES]) {
    for (const [kind, pose] of Object.entries(table)) {
      assert(`${kind} pose has three positions`, pose.pos.length === 3);
      assert(`${kind} pose has three rotations`, pose.rot.length === 3);
      assert(`${kind} pose has a positive scale`, pose.scale > 0, pose.scale);
      assert(`${kind} pose is not absurd`,
        pose.pos.every((v) => Math.abs(v) < 2) && pose.rot.every((v) => Math.abs(v) < Math.PI));
    }
  }

  // The avatar holds things at a believable size next to a 1.8-block body:
  // a held block is Minecraft's ~0.4, and nothing is bigger than half a
  // block, which would be a pickaxe the size of the player's torso.
  for (const [kind, pose] of Object.entries(THIRD_PERSON_POSES)) {
    assert(`the avatar's ${kind} is a sensible size`,
      pose.scale > 0.2 && pose.scale <= 0.85, pose.scale);
  }
  assert('a held block is about Minecraft\'s 0.4',
    Math.abs(THIRD_PERSON_POSES[POSE_KIND_BLOCK].scale - 0.4) < 0.1);
  assert('a tool is held bigger than a block, being longer',
    THIRD_PERSON_POSES[POSE_KIND_TOOL].scale > THIRD_PERSON_POSES[POSE_KIND_BLOCK].scale);

  // Grips: a tool is held low on its haft, a bucket high by its handle.
  for (const shape of [SHAPE_PICKAXE, SHAPE_SHOVEL, SHAPE_AXE, SHAPE_SWORD]) {
    assert(`a ${shape} is gripped near its bottom`, GRIP_HEIGHT[shape] < 0.4, GRIP_HEIGHT[shape]);
  }
  assert('a bucket hangs from a grip near its top', GRIP_HEIGHT[SHAPE_BUCKET] > 0.6);

  assert('a tool swings like a tool', swingsLikeTool(PICKAXE) && swingsLikeTool(IRON_SWORD));
  assert('a block does not', !swingsLikeTool(1) && !swingsLikeTool(COAL));
}

// -------------------------------------------------------------- the sprites
{
  for (const [name, rows] of Object.entries(ALL_SPRITES)) {
    assert(`${name} is 16 rows`, rows.length === 16, rows.length);
    assert(`${name} rows are 16 wide`, rows.every((r) => r.length === 16),
      [...new Set(rows.map((r) => r.length))].join(','));
    const opaque = rows.join('').replace(/\./g, '').length;
    assert(`${name} is not blank`, opaque > 20, opaque);
    assert(`${name} is not solid`, opaque < 256, opaque);
  }

  // The two new tool shapes have to be *distinguishable* at hotbar size,
  // which is the only reason they exist. The cheapest proxy for that is
  // that they do not have the same silhouette.
  const silhouette = (rows) => rows.map((r) => r.replace(/[^.]/g, '#')).join('');
  assert('an axe does not look like a pickaxe',
    silhouette(AXE_PX) !== silhouette(PICKAXE_PX));
  assert('a sword does not look like a shovel',
    silhouette(SWORD_PX) !== silhouette(SHOVEL_PX));
  assert('a sword does not look like a stick',
    silhouette(SWORD_PX) !== silhouette(STICK_PX));

  // Every tool sprite shares the haft letters, so a wooden pickaxe is
  // visibly the same shaft as the stick it was made from.
  for (const [name, rows] of [['axe', AXE_PX], ['sword', SWORD_PX]]) {
    const haft = rows.join('').split('').filter((c) => 'ODMH'.includes(c));
    assert(`the ${name} has a wooden haft`, haft.length >= 4, haft.length);
    const head = rows.join('').split('').filter((c) => 'odmh'.includes(c));
    assert(`the ${name} has a head`, head.length >= 10, head.length);
  }

  // The lumps are lumps: no haft letters at all, or they would come out with
  // a stick growing from them.
  for (const [name, rows] of [['coal', COAL_PX], ['diamond', DIAMOND_PX],
    ['raw iron', RAW_IRON_PX], ['ingot', IRON_INGOT_PX]]) {
    const haft = rows.join('').split('').filter((c) => 'ODMH'.includes(c));
    assert(`${name} has no handle`, haft.length === 0, haft.length);
  }

  // An ingot is a bar: wider than it is tall. A lump is a blob: neither.
  const spanY = (rows) => {
    const ys = rows.map((r, y) => (r.includes('.') && r.replace(/\./g, '') === '' ? -1 : y))
      .filter((y) => y >= 0);
    return ys.length ? ys[ys.length - 1] - ys[0] + 1 : 0;
  };
  assert('an ingot is flatter than a diamond',
    spanY(IRON_INGOT_PX) < spanY(DIAMOND_PX), `${spanY(IRON_INGOT_PX)} vs ${spanY(DIAMOND_PX)}`);
}

// --------------------------------------------------------------- durability
{
  assert('every tool has durability', Object.keys(TOOL_KINDS).every((id) => isTool(Number(id))));
  assert('four tiers of durability', Object.keys(TIER_DURABILITY).length === 4);
  assert('Minecraft\'s numbers',
    TIER_DURABILITY[TIER_WOOD] === 59 && TIER_DURABILITY[TIER_STONE] === 131
    && TIER_DURABILITY[TIER_IRON] === 250 && TIER_DURABILITY[TIER_DIAMOND] === 1561);
  assert('durability rises with the tier',
    TIER_DURABILITY[TIER_WOOD] < TIER_DURABILITY[TIER_STONE]
    && TIER_DURABILITY[TIER_STONE] < TIER_DURABILITY[TIER_IRON]
    && TIER_DURABILITY[TIER_IRON] < TIER_DURABILITY[TIER_DIAMOND]);
  // Shape does not matter, only material — which is the reason the table is
  // generated rather than written out sixteen times.
  assert('a diamond axe and a diamond sword last the same',
    MAX_DURABILITY[DIAMOND_AXE] === MAX_DURABILITY[DIAMOND_SWORD]);
  assert('an iron pickaxe still lasts 250, as it always did',
    MAX_DURABILITY[PICKAXE] === 250);
  assert('a bucket is not a tool', !isTool(BUCKET) && !isTool(COAL));
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
