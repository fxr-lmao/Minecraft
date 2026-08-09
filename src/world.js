// Flat superflat-style world: bedrock at y=0, dirt y=1..2, grass y=3.
// The full world lives in a dense 3D array so collisions and future
// block edits are O(1) lookups.

import { WORLD_SIZE, WORLD_LAYERS } from './constants.js';
import { buildWorldMeshes } from './blocks.js';

// block ids (see textures.js BLOCK_DEFS)
export const BEDROCK = 8;
export const DIRT = 2;
export const GRASS = 1;

export const AIR = 0;

export class World {
  constructor() {
    this.size = WORLD_SIZE;
    this.layers = WORLD_LAYERS;
    // blocks[y][z][x], y = 0..layers-1
    this.blocks = new Uint8Array(this.size * this.layers * this.size);
    this.generate();
  }

  generate() {
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        this.set(x, 0, z, BEDROCK);
        this.set(x, 1, z, DIRT);
        this.set(x, 2, z, DIRT);
        this.set(x, 3, z, GRASS);
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

  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.blocks[this.index(x, y, z)] = id;
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

  /** Build all render meshes for the current world state. */
  buildMeshes() {
    return buildWorldMeshes(this);
  }
}
