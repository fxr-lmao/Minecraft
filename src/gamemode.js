// Game mode: survival (the default, everything as it has been) and creative
// (no damage, instant breaking, infinite blocks, flight). Minecraft's two
// modes in miniature — the pieces that matter here.
//
// The mode is a plain object with a handful of flags; the rest of the game
// (mining speed, damage, the HUD) reads those flags. Nothing in here touches
// the world — it is a setting, not a mechanic.

export const SURVIVAL = 0;
export const CREATIVE = 1;

export class GameMode {
  constructor() {
    this.mode = SURVIVAL;
    /** Flight is only meaningful in creative; toggled with double-tap space. */
    this.flying = false;
    /** A save/restore-friendly snapshot. */
    this.creative = false;
  }

  get isCreative() { return this.mode === CREATIVE; }

  get name() { return this.isCreative ? 'Creative' : 'Survival'; }

  /** Toggle survival <-> creative. Turning off creative lands the player. */
  toggle() {
    this.mode = this.isCreative ? SURVIVAL : CREATIVE;
    if (!this.isCreative) this.flying = false;
    return this.mode;
  }

  setCreative(v) {
    this.mode = v ? CREATIVE : SURVIVAL;
    if (!this.isCreative) this.flying = false;
    return this.mode;
  }

  /** Double-tap space only works in creative, like Minecraft. */
  toggleFlying() {
    if (!this.isCreative) return false;
    this.flying = !this.flying;
    return this.flying;
  }

  /** Blocks never run out in creative: use from the hotbar forever. */
  infiniteBlocks() { return this.isCreative; }

  /** Breaking is instant in creative. */
  instantBreak() { return this.isCreative; }

  /** Creative players cannot be hurt. */
  invulnerable() { return this.isCreative; }
}
