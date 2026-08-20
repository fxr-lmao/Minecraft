// Infinite chunked world.
//
// The world is a Map of 32x32x141 chunks (y from -70 to 70) generated on
// demand from a seed.
// There is no border: walk in any direction and chunks appear. Chunks far
// from the player are evicted to keep memory flat, which is safe because
// generation is deterministic and player edits live in a separate map keyed
// by absolute coordinate — a regenerated chunk replays its edits and comes
// back exactly as it was.
//
// Collision must never see a hole, so `get()` generates a missing chunk
// synchronously (a fraction of a millisecond). Rendering is separate and
// only meshes chunks inside the render distance.

import {
  CHUNK_SIZE, WORLD_HEIGHT, WORLD_MIN_Y, WORLD_MAX_Y, WORLD_SEED, toLayer,
} from './constants.js';
import {
  generateChunk, generateFlatChunk, findSpawn, biomeWeights, dominantBiome,
} from './terrain.js';

export {
  GRASS, DIRT, STONE, SAND, BEDROCK, DEEPSLATE, WATER, AIR, ICE,
  CRAFTING_TABLE, FURNACE, GLASS, TNT,
  isWater, isOpaque, isSolid, isIce, waterLevel, waterId,
} from './terrain.js';
import { BEDROCK, AIR, isOpaque, isSolid, isWater, isWaterSource, temperatureAt } from './terrain.js';

const AREA = CHUNK_SIZE * CHUNK_SIZE;
const CHUNK_CELLS = AREA * WORLD_HEIGHT;

export const chunkKey = (cx, cz) => `${cx},${cz}`;
/** Chunk coordinate containing a block coordinate (works for negatives). */
export const toChunk = (v) => Math.floor(v / CHUNK_SIZE);
/** Local 0..CHUNK_SIZE-1 offset inside a chunk (works for negatives). */
export const toLocal = (v) => ((v % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

class Chunk {
  constructor(cx, cz, seed, flat) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_CELLS);
    /**
     * Per column, the *layer* below which the column is guaranteed solid, so
     * the mesher can skip everything underneath without looking. Caves are
     * exactly what invalidates that, so generation lowers it to the deepest
     * carved layer. An edit that could punch a hole resets its column to 0,
     * forcing a full scan of that column only.
     */
    this.heights = new Uint8Array(AREA);
    /**
     * Layer of each column's terrain surface. The mesher uses it to build
     * only the terrain shell for distant chunks: caves never break through
     * to the sky, so their walls cannot be seen from outside and are not
     * worth the geometry until you are close enough to go in.
     */
    this.surface = new Uint8Array(AREA);
    /** Set once the player changes anything here — see `surface`. */
    this.edited = false;
    this.maxY = flat === null
      ? generateChunk(this.blocks, this.heights, this.surface, cx, cz, CHUNK_SIZE, WORLD_HEIGHT, seed)
      : generateFlatChunk(this.blocks, this.heights, this.surface, CHUNK_SIZE, WORLD_HEIGHT, flat);
    /** Bumped whenever the contents change, so meshes know they are stale. */
    this.revision = 0;
    this.lastUsed = 0;
  }

  /** `y` is a world coordinate; block arrays are indexed by layer. */
  index(lx, y, lz) {
    return toLayer(y) * AREA + lz * CHUNK_SIZE + lx;
  }
}

export class World {
  /**
   * @param {number} seed
   * @param {{flat?: number, temperature?: number}} [opts] `flat` generates a
   *   superflat world with its surface at that height, and `temperature`
   *   fixes the climate — deterministic ground and deterministic weather for
   *   the tests.
   */
  constructor(seed = WORLD_SEED, opts = {}) {
    this.seed = seed;
    this.flat = opts.flat ?? null;
    /**
     * A fixed temperature for the whole world, in place of the climate the
     * biomes would give it. Superflat has no biomes worth the name, so this
     * is how a test says "somewhere cold" and gets a deterministic answer.
     */
    this.temperature = opts.temperature ?? null;
    this.size = CHUNK_SIZE;
    this.chunkSize = CHUNK_SIZE;
    this.layers = WORLD_HEIGHT;
    this.height = WORLD_HEIGHT;
    this.minY = WORLD_MIN_Y;
    this.maxY = WORLD_MAX_Y;
    /** key -> Chunk */
    this.chunks = new Map();
    /** "x,y,z" -> block id, every edit the player has made. */
    this.edits = new Map();
    /** Chunk keys whose meshes are out of date. */
    this.dirtyChunks = new Set();
    /** Bumped on every edit so the save loop knows there is work to do. */
    this.revision = 0;
    /**
     * Called with each edit replayed into a freshly generated chunk. Flowing
     * water hangs off this: it is never saved, so a chunk that comes back into
     * memory comes back dry, and the channel someone dug through it has to be
     * poked before the sea notices the hole is still there.
     */
    this.onEditReplayed = null;
    this._tick = 0;
  }

  // ------------------------------------------------------------- chunks

  /** Fetch a chunk, generating it (and replaying its edits) if needed. */
  chunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = new Chunk(cx, cz, this.seed, this.flat);
      this.chunks.set(key, c);
      this._replayEdits(c);
    }
    c.lastUsed = this._tick;
    return c;
  }

  hasChunk(cx, cz) {
    return this.chunks.has(chunkKey(cx, cz));
  }

  /** Re-apply saved/placed edits after a chunk is (re)generated. */
  _replayEdits(c) {
    if (this.edits.size === 0) return;
    const x0 = c.cx * CHUNK_SIZE;
    const z0 = c.cz * CHUNK_SIZE;
    // Iterating the whole edit map per chunk would be O(edits * chunks), so
    // edits are also bucketed by chunk key.
    const bucket = this._editBuckets?.get(chunkKey(c.cx, c.cz));
    if (!bucket) return;
    for (const [packed, id] of bucket) {
      const { x, y, z } = unpack(packed);
      if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) continue;
      c.blocks[c.index(x - x0, y, z - z0)] = id;
      if (id !== AIR && y > c.maxY) c.maxY = y;
      c.heights[(z - z0) * CHUNK_SIZE + (x - x0)] = 0;
      c.edited = true;
      if (this.onEditReplayed) this.onEditReplayed(x, y, z);
    }
  }

  /** Drop chunks further than `radius` chunks from (cx, cz). */
  evictOutside(cx, cz, radius) {
    let dropped = 0;
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - cx) > radius || Math.abs(c.cz - cz) > radius) {
        this.chunks.delete(key);
        this.dirtyChunks.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  /** Called once per frame so eviction can prefer recently used chunks. */
  tick() {
    this._tick++;
  }

  // -------------------------------------------------------------- blocks

  get(x, y, z) {
    if (y < WORLD_MIN_Y) return BEDROCK; // sealed below, so you cannot dig out
    if (y > WORLD_MAX_Y) return AIR;
    const c = this.chunk(toChunk(x), toChunk(z));
    return c.blocks[c.index(toLocal(x), y, toLocal(z))];
  }

  /** True when the coordinate can hold a block at all. */
  inBounds(x, y, z) {
    return y >= WORLD_MIN_Y && y <= WORLD_MAX_Y;
  }

  /**
   * Solid means "you cannot walk through it". Water is a block but not an
   * obstacle, so everything that asks about collision, targeting or ground
   * height goes through here rather than comparing against AIR. Glass is
   * solid but not opaque, which is exactly the split `isSolid` captures.
   */
  isSolid(x, y, z) {
    return isSolid(this.get(x, y, z));
  }

  /** True when this cell is water of any level. */
  isWaterAt(x, y, z) {
    return isWater(this.get(x, y, z));
  }

  /**
   * True only for a *source* — the sea, and anything a bucket poured out.
   * The difference matters to anything that wants water that is really there
   * rather than water that is on its way somewhere: a bucket fills from this
   * and from nothing else.
   */
  isWaterSourceAt(x, y, z) {
    return isWaterSource(this.get(x, y, z));
  }

  /**
   * Place/remove a block, remember the edit, and mark the affected chunk
   * meshes dirty. Returns true if the world actually changed.
   */
  setBlock(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    const cx = toChunk(x);
    const cz = toChunk(z);
    const c = this.chunk(cx, cz);
    const i = c.index(toLocal(x), y, toLocal(z));
    if (c.blocks[i] === id) return false;
    c.blocks[i] = id;
    if (id !== AIR && y > c.maxY) c.maxY = y;
    // This column may now have a gap in it; make the mesher scan it in full.
    c.heights[toLocal(z) * CHUNK_SIZE + toLocal(x)] = 0;
    c.edited = true;
    c.revision++;

    this._recordEdit(x, y, z, id);
    this.revision++;

    this.markDirty(cx, cz);
    // A block on a chunk seam also changes the neighbour's hidden faces.
    const lx = toLocal(x);
    const lz = toLocal(z);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    return true;
  }

  /**
   * Change a block without recording it as a player edit.
   *
   * Flowing water uses this. It is a consequence of the terrain rather than a
   * decision anyone made, so it does not belong in the save file — and
   * keeping it out means a flooded cavern costs nothing to store and simply
   * refills from its source the next time anything disturbs it.
   *
   * Chunks that are not loaded are left alone rather than generated: water
   * has no business pulling the world into memory.
   */
  setBlockTransient(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    const cx = toChunk(x);
    const cz = toChunk(z);
    if (!this.hasChunk(cx, cz)) return false;
    const c = this.chunk(cx, cz);
    const lx = toLocal(x);
    const lz = toLocal(z);
    const i = c.index(lx, y, lz);
    if (c.blocks[i] === id) return false;
    c.blocks[i] = id;
    if (id !== AIR && y > c.maxY) c.maxY = y;
    // Keep the mesher's "solid below here" promise true, without throwing the
    // whole column's skip away the way an edit does.
    const layer = toLayer(y);
    const col = lz * CHUNK_SIZE + lx;
    if (layer < c.heights[col]) c.heights[col] = layer;
    c.revision++;

    this.markDirty(cx, cz);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    return true;
  }

  _recordEdit(x, y, z, id) {
    const packed = pack(x, y, z);
    this.edits.set(packed, id);
    if (!this._editBuckets) this._editBuckets = new Map();
    const key = chunkKey(toChunk(x), toChunk(z));
    let bucket = this._editBuckets.get(key);
    if (!bucket) {
      bucket = new Map();
      this._editBuckets.set(key, bucket);
    }
    bucket.set(packed, id);
  }

  /** Apply saved edits. Chunks already in memory are updated in place. */
  applyEdits(edits) {
    let applied = 0;
    for (const { x, y, z, id } of edits) {
      if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) continue;
      this._recordEdit(x, y, z, id);
      const key = chunkKey(toChunk(x), toChunk(z));
      const c = this.chunks.get(key);
      if (c) {
        c.blocks[c.index(toLocal(x), y, toLocal(z))] = id;
        if (id !== AIR && y > c.maxY) c.maxY = y;
        c.heights[toLocal(z) * CHUNK_SIZE + toLocal(x)] = 0;
        c.edited = true;
        this.dirtyChunks.add(key);
      }
      applied++;
    }
    return applied;
  }

  /** Every edit as {x, y, z, id} — what the save file stores. */
  *editList() {
    for (const [packed, id] of this.edits) {
      const { x, y, z } = unpack(packed);
      yield { x, y, z, id };
    }
  }

  markDirty(cx, cz) {
    if (this.chunks.has(chunkKey(cx, cz))) this.dirtyChunks.add(chunkKey(cx, cz));
  }

  /** Take (and clear) the set of chunks needing a re-mesh. */
  consumeDirtyChunks() {
    const list = [...this.dirtyChunks].map((key) => key.split(',').map(Number));
    this.dirtyChunks.clear();
    return list;
  }

  /** Height of the top solid block at (x, z); below the world if empty. */
  heightAt(x, z) {
    const c = this.chunk(toChunk(x), toChunk(z));
    const lx = toLocal(x);
    const lz = toLocal(z);
    for (let y = Math.min(c.maxY, WORLD_MAX_Y); y >= WORLD_MIN_Y; y--) {
      // The sea is not ground: heightAt is what spawning and the debug screen
      // mean by "the surface", and that is the sea floor, not the surface of
      // the water above it. Glass counts as ground here — weather stops on it.
      if (isSolid(c.blocks[c.index(lx, y, lz)])) return y;
    }
    return WORLD_MIN_Y - 1;
  }

  /** Which biome dominates a column — shown on the debug screen. */
  biomeAt(x, z) {
    return this.flat !== null ? 'superflat' : dominantBiome(biomeWeights(x, z, this.seed));
  }

  /**
   * How cold it is here, on Minecraft's scale — below FREEZING_POINT and
   * exposed water turns to ice. Height is part of the answer, so this takes
   * a y rather than a column.
   */
  temperatureAt(x, y, z) {
    return this.temperature !== null ? this.temperature : temperatureAt(x, y, z, this.seed);
  }

  /** A safe standing height for (x, z). */
  spawnHeight(x, z) {
    return this.heightAt(x, z) + 1;
  }

  /** Where a new player starts: grass, flat, near the origin. */
  spawnPoint() {
    if (this.flat !== null) return { x: 0.5, z: 0.5, y: this.flat + 1 };
    const s = findSpawn(this.seed);
    return { x: s.x, z: s.z, y: this.spawnHeight(Math.floor(s.x), Math.floor(s.z)) };
  }
}

// Edits are keyed by a single string so they survive JSON round-trips and
// work for any coordinate, positive or negative.
export function pack(x, y, z) {
  return `${x},${y},${z}`;
}

export function unpack(packed) {
  const [x, y, z] = packed.split(',').map(Number);
  return { x, y, z };
}
