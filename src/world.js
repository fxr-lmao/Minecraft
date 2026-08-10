// Flat superflat-style world: bedrock at y=0, dirt y=1..2, grass y=3.
// The world is a dense 3D array (128 x 32 x 128) so collisions and block
// edits are O(1) lookups. Everything above the generated ground is air, so
// the player can build up to y=31.
//
// Edits mark their chunk dirty; the renderer only re-meshes dirty chunks.

import { WORLD_SIZE, WORLD_LAYERS, GROUND_LAYERS, CHUNK_SIZE } from './constants.js';

// block ids (see textures.js BLOCK_DEFS)
export const GRASS = 1;
export const DIRT = 2;
export const BEDROCK = 8;

export const AIR = 0;

export class World {
  constructor() {
    this.size = WORLD_SIZE;
    this.layers = WORLD_LAYERS;
    this.chunkSize = CHUNK_SIZE;
    this.chunksPerSide = Math.ceil(WORLD_SIZE / CHUNK_SIZE);
    // blocks[y][z][x], y = 0..layers-1
    this.blocks = new Uint8Array(this.size * this.layers * this.size);
    /** Chunk keys ("cx,cz") whose meshes are out of date. */
    this.dirtyChunks = new Set();
    this.generate();
  }

  generate() {
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        this.blocks[this.index(x, 0, z)] = BEDROCK;
        this.blocks[this.index(x, 1, z)] = DIRT;
        this.blocks[this.index(x, 2, z)] = DIRT;
        this.blocks[this.index(x, 3, z)] = GRASS;
      }
    }
  }

  index(x, y, z) {
    return y * this.size * this.size + z * this.size + x;
  }

  inBounds(x, y, z) {
    return (
      x >= 0 && x < this.size &&
      y >= 0 && y < this.layers &&
      z >= 0 && z < this.size
    );
  }

  get(x, y, z) {
    // Below the world and beyond the horizontal border: solid (sealed).
    // Above the world: open sky.
    if (y < 0 || x < 0 || x >= this.size || z < 0 || z >= this.size) return BEDROCK;
    if (y >= this.layers) return AIR;
    return this.blocks[this.index(x, y, z)];
  }

  /** Raw write with no dirty tracking (used by generation). */
  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.blocks[this.index(x, y, z)] = id;
  }

  /**
   * Place/remove a block and mark the affected chunk meshes dirty.
   * Returns true if the world actually changed.
   */
  setBlock(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    if (this.blocks[i] === id) return false;
    this.blocks[i] = id;
    this.markDirty(x, z);
    // A block on a chunk border also changes the neighbour's hidden faces.
    const lx = x % this.chunkSize;
    const lz = z % this.chunkSize;
    if (lx === 0) this.markDirty(x - 1, z);
    if (lx === this.chunkSize - 1) this.markDirty(x + 1, z);
    if (lz === 0) this.markDirty(x, z - 1);
    if (lz === this.chunkSize - 1) this.markDirty(x, z + 1);
    return true;
  }

  markDirty(x, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    if (cx < 0 || cz < 0 || cx >= this.chunksPerSide || cz >= this.chunksPerSide) return;
    this.dirtyChunks.add(`${cx},${cz}`);
  }

  /** Take (and clear) the set of chunks needing a re-mesh. */
  consumeDirtyChunks() {
    const list = [...this.dirtyChunks].map((key) => key.split(',').map(Number));
    this.dirtyChunks.clear();
    return list;
  }

  isSolid(x, y, z) {
    return this.get(x, y, z) !== AIR;
  }

  /** Height of the top solid block at (x, z); -1 if none. */
  heightAt(x, z) {
    for (let y = this.layers - 1; y >= 0; y--) {
      if (this.get(x, y, z) !== AIR) return y;
    }
    return -1;
  }

  /** True if the generated (unbreakable) floor sits at this cell. */
  isBedrock(x, y, z) {
    return this.get(x, y, z) === BEDROCK;
  }

  /**
   * Enumerate every solid block as {id, x, y, z} with integer coords
   * (world position = coord + 0.5).
   */
  *solidBlocks() {
    for (let y = 0; y < this.layers; y++) {
      for (let z = 0; z < this.size; z++) {
        for (let x = 0; x < this.size; x++) {
          const id = this.blocks[this.index(x, y, z)];
          if (id !== AIR) yield { id, x, y, z };
        }
      }
    }
  }
}

export { GROUND_LAYERS };
