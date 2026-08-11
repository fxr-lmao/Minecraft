// Infinite chunked world.
//
// The world is a Map of 32x32x64 chunks generated on demand from a seed.
// There is no border: walk in any direction and chunks appear. Chunks far
// from the player are evicted to keep memory flat, which is safe because
// generation is deterministic and player edits live in a separate map keyed
// by absolute coordinate — a regenerated chunk replays its edits and comes
// back exactly as it was.
//
// Collision must never see a hole, so `get()` generates a missing chunk
// synchronously (a fraction of a millisecond). Rendering is separate and
// only meshes chunks inside the render distance.

import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_SEED } from './constants.js';
import { generateChunk, generateFlatChunk, findSpawn } from './terrain.js';

export { GRASS, DIRT, STONE, SAND, BEDROCK, AIR } from './terrain.js';
import { BEDROCK, AIR } from './terrain.js';

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
    this.maxY = flat === null
      ? generateChunk(this.blocks, cx, cz, CHUNK_SIZE, WORLD_HEIGHT, seed)
      : generateFlatChunk(this.blocks, CHUNK_SIZE, WORLD_HEIGHT, flat);
    /** Bumped whenever the contents change, so meshes know they are stale. */
    this.revision = 0;
    this.lastUsed = 0;
  }

  index(lx, y, lz) {
    return y * AREA + lz * CHUNK_SIZE + lx;
  }
}

export class World {
  /**
   * @param {number} seed
   * @param {{flat?: number}} [opts] `flat` generates a superflat world with
   *   its surface at that height — deterministic ground for the tests.
   */
  constructor(seed = WORLD_SEED, opts = {}) {
    this.seed = seed;
    this.flat = opts.flat ?? null;
    this.size = CHUNK_SIZE;
    this.chunkSize = CHUNK_SIZE;
    this.layers = WORLD_HEIGHT;
    this.height = WORLD_HEIGHT;
    /** key -> Chunk */
    this.chunks = new Map();
    /** "x,y,z" -> block id, every edit the player has made. */
    this.edits = new Map();
    /** Chunk keys whose meshes are out of date. */
    this.dirtyChunks = new Set();
    /** Bumped on every edit so the save loop knows there is work to do. */
    this.revision = 0;
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
      if (y < 0 || y >= WORLD_HEIGHT) continue;
      c.blocks[c.index(x - x0, y, z - z0)] = id;
      if (id !== AIR && y > c.maxY) c.maxY = y;
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
    if (y < 0) return BEDROCK; // sealed below, so you cannot dig out
    if (y >= WORLD_HEIGHT) return AIR;
    const c = this.chunk(toChunk(x), toChunk(z));
    return c.blocks[c.index(toLocal(x), y, toLocal(z))];
  }

  /** True when the coordinate can hold a block at all. */
  inBounds(x, y, z) {
    return y >= 0 && y < WORLD_HEIGHT;
  }

  isSolid(x, y, z) {
    return this.get(x, y, z) !== AIR;
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
      if (y < 0 || y >= WORLD_HEIGHT) continue;
      this._recordEdit(x, y, z, id);
      const key = chunkKey(toChunk(x), toChunk(z));
      const c = this.chunks.get(key);
      if (c) {
        c.blocks[c.index(toLocal(x), y, toLocal(z))] = id;
        if (id !== AIR && y > c.maxY) c.maxY = y;
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

  /** Height of the top solid block at (x, z); -1 if the column is empty. */
  heightAt(x, z) {
    const c = this.chunk(toChunk(x), toChunk(z));
    const lx = toLocal(x);
    const lz = toLocal(z);
    for (let y = Math.min(c.maxY, WORLD_HEIGHT - 1); y >= 0; y--) {
      if (c.blocks[c.index(lx, y, lz)] !== AIR) return y;
    }
    return -1;
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
