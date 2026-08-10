// Save/restore the world in localStorage, so refreshing the page (or Safari
// dropping the tab in the background, which iPads do constantly) doesn't
// throw away what you built.
//
// Only the *edits* are stored, not the whole 128x128x32 grid: the terrain is
// generated deterministically, so a flat list of [blockIndex, id] pairs
// rebuilds it exactly. A player who has placed 10k blocks costs ~80 KB.
//
// Pure functions here (encode/decode) are unit-tested in Node; the
// localStorage wrapper around them is not.

const KEY = 'mc-clone.save.v1';
const VERSION = 1;
/** Refuse to persist absurd saves rather than blowing the storage quota. */
export const MAX_EDITS = 200000;

/** World edits (Map<index, id>) -> flat [index, id, index, id, ...]. */
export function encodeEdits(edits) {
  const out = [];
  for (const [index, id] of edits) {
    out.push(index, id);
    if (out.length >= MAX_EDITS * 2) break;
  }
  return out;
}

/** Flat pairs -> [{ index, id }], skipping anything malformed. */
export function decodeEdits(flat) {
  const out = [];
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const index = flat[i];
    const id = flat[i + 1];
    if (!Number.isInteger(index) || index < 0) continue;
    if (!Number.isInteger(id) || id < 0 || id > 255) continue;
    out.push({ index, id });
  }
  return out;
}

/** Build the serialisable snapshot. Pure — takes plain data, returns data. */
export function buildSnapshot({ world, inventory, player, viewMode }) {
  return {
    version: VERSION,
    at: Date.now(),
    size: world.size,
    layers: world.layers,
    edits: encodeEdits(world.edits),
    inventory: {
      slots: inventory.slots.map((s) => (s ? [s.id, s.count] : 0)),
      selected: inventory.selected,
    },
    player: {
      x: player.pos.x, y: player.pos.y, z: player.pos.z,
      yaw: player.yaw, pitch: player.pitch,
    },
    view: viewMode,
  };
}

/**
 * Validate a parsed snapshot against the current world shape.
 * Returns null when the save is missing, malformed, or from a world size
 * that no longer matches (rather than restoring a corrupt world).
 */
export function parseSnapshot(raw, world) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== VERSION) return null;
  if (raw.size !== world.size || raw.layers !== world.layers) return null;
  const cells = world.size * world.size * world.layers;
  const edits = decodeEdits(raw.edits).filter((e) => e.index < cells);
  const slots = Array.isArray(raw.inventory?.slots) ? raw.inventory.slots : [];
  return {
    edits,
    inventory: {
      slots: slots.map((s) =>
        Array.isArray(s) && Number.isInteger(s[0]) && Number.isInteger(s[1]) && s[1] > 0
          ? { id: s[0], count: s[1] }
          : null
      ),
      selected: Number.isInteger(raw.inventory?.selected) ? raw.inventory.selected : 0,
    },
    player: raw.player && Number.isFinite(raw.player.x) ? raw.player : null,
    view: Number.isInteger(raw.view) ? raw.view : 0,
  };
}

// ------------------------------------------------------------ localStorage

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(buildSnapshot(state)));
    return true;
  } catch {
    return false; // quota or private browsing; the game keeps running
  }
}

export function load(world) {
  try {
    return parseSnapshot(JSON.parse(localStorage.getItem(KEY) ?? 'null'), world);
  } catch {
    return null;
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function hasSave() {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
