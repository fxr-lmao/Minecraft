// New blocks added by the crafting/content pass. They live past the ore
// range (33+) so they never collide with generated terrain, and they are
// purely player-placed — the generator never puts them in the world.
//
// The ids are shared with terrain.js's namespace; the constants are kept
// here so crafting.js and the UI can import them without touching terrain.

export const CRAFTING_TABLE = 33;
export const FURNACE = 34;
export const GLASS = 35;
export const TNT = 36;

/** Everything added here, for "is this one of ours" checks. */
export const EXTRA_BLOCKS = [CRAFTING_TABLE, FURNACE, GLASS, TNT];

/** Glass is solid but not opaque: you walk on it, but see through it. */
export const isGlass = (id) => id === GLASS;
