// Save/restore the world in localStorage, so refreshing the page (or Safari
// dropping the tab in the background, which iPads do constantly) doesn't
// throw away what you built.
//
// Only the *edits* are stored, never the terrain: generation is a pure
// function of the seed, so a flat list of [x, y, z, id] quadruples rebuilds
// any world exactly. A player who has placed 10k blocks costs ~150 KB.
//
// Pure functions here (encode/decode/parse) are unit-tested in Node; the
// localStorage wrapper around them is not.

import { WORLD_MIN_Y, WORLD_MAX_Y } from './constants.js';

const KEY = 'mc-clone.save.v1'; // same slot; the payload carries its version
const VERSION = 3;

/**
 * How far version 2 worlds have to move up.
 *
 * Version 2 generated the plains around y = 14; version 3 uses Minecraft's
 * elevations and puts them at 66. Leaving old edits where they were would
 * bury everything anyone built fifty blocks underground, so they are lifted
 * by the difference — which lands them back on the surface they were built
 * on, give or take the change in the hills.
 */
export const V2_LIFT = 52;
/** Refuse to persist absurd saves rather than blowing the storage quota. */
export const MAX_EDITS = 200000;

/** World edits -> flat [x, y, z, id, ...]. */
export function encodeEdits(editList) {
  const out = [];
  for (const { x, y, z, id } of editList) {
    out.push(x, y, z, id);
    if (out.length >= MAX_EDITS * 4) break;
  }
  return out;
}

/** Raise every edit by `dy`, dropping any that would leave the world. */
export function liftEdits(edits, dy) {
  const out = [];
  for (const e of edits) {
    const y = e.y + dy;
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) continue;
    out.push({ ...e, y });
  }
  return out;
}

/**
 * Flat quadruples -> [{x, y, z, id}], skipping anything malformed.
 * `floor` lets a migration accept coordinates from a world whose floor was
 * somewhere else, before they are moved into this one's range.
 */
export function decodeEdits(flat, floor = WORLD_MIN_Y) {
  const out = [];
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const [x, y, z, id] = flat.slice(i, i + 4);
    if (![x, y, z, id].every(Number.isInteger)) continue;
    // y is absolute and the world extends below zero, so only the real
    // vertical bounds may reject an edit — `y < 0` used to, and would now
    // silently drop everything anyone built underground.
    if (id < 0 || id > 255 || y < floor || y > WORLD_MAX_Y) continue;
    out.push({ x, y, z, id });
  }
  return out;
}

/**
 * Version 1 stored edits as indices into a fixed 128x128x32 grid. The world
 * is infinite now, so those indices are converted to absolute coordinates —
 * a player's build survives the upgrade even though the terrain under it is
 * no longer flat.
 */
export function migrateV1Edits(flat, size = 128) {
  const out = [];
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const index = flat[i];
    const id = flat[i + 1];
    if (!Number.isInteger(index) || index < 0) continue;
    if (!Number.isInteger(id) || id < 0 || id > 255) continue;
    const x = index % size;
    const z = Math.floor(index / size) % size;
    const y = Math.floor(index / (size * size));
    out.push({ x, y, z, id });
  }
  return out;
}

/** Build the serialisable snapshot. Pure — takes plain data, returns data. */
export function buildSnapshot({ world, inventory, player, viewMode }) {
  return {
    version: VERSION,
    at: Date.now(),
    seed: world.seed,
    edits: encodeEdits(world.editList()),
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

function parseInventory(raw) {
  const slots = Array.isArray(raw?.slots) ? raw.slots : [];
  return {
    slots: slots.map((s) =>
      Array.isArray(s) && Number.isInteger(s[0]) && Number.isInteger(s[1]) && s[1] > 0
        ? { id: s[0], count: s[1] }
        : null
    ),
    selected: Number.isInteger(raw?.selected) ? raw.selected : 0,
  };
}

/**
 * Validate a parsed snapshot. Returns null when the save is missing or
 * malformed; version 1 saves from the old finite world are migrated.
 */
export function parseSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;

  if (raw.version === 1) {
    return {
      migrated: true,
      edits: migrateV1Edits(raw.edits, raw.size ?? 128),
      inventory: parseInventory(raw.inventory),
      player: raw.player && Number.isFinite(raw.player.x) ? raw.player : null,
      view: Number.isInteger(raw.view) ? raw.view : 0,
    };
  }
  if (raw.version === 2) {
    return {
      migrated: true,
      edits: liftEdits(decodeEdits(raw.edits, WORLD_MIN_Y - V2_LIFT), V2_LIFT),
      inventory: parseInventory(raw.inventory),
      player: raw.player && Number.isFinite(raw.player.x)
        ? { ...raw.player, y: raw.player.y + V2_LIFT }
        : null,
      view: Number.isInteger(raw.view) ? raw.view : 0,
    };
  }
  if (raw.version !== VERSION) return null;

  return {
    migrated: false,
    edits: decodeEdits(raw.edits),
    inventory: parseInventory(raw.inventory),
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

export function load() {
  try {
    return parseSnapshot(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
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
