// Hunger: the stat that makes food matter.
//
// Until now a world could hurt you but could not feed you, and the one thing
// missing was the whole point of the food that has started existing: a bar
// that runs down as you work, that only eating fills, and that decides
// whether you heal or starve. This file is that bar, pure and testable — no
// THREE, no DOM, no world — and it is driven by the player (exhaustion from
// moving and doing) and by the game loop (the slow clock of healing and
// starving).
//
// The numbers are Minecraft's, on Minecraft's own scale where a shank — the
// half of a drumstick — is four exhaustion points:
//
//   * Walking costs 0.01 a metre, sprinting ten times that, and the same
//     split holds in water. Jumping is 0.05 (0.2 while sprinting), taking a
//     hit 0.1, landing a hit 0.1, mining a block 0.005. Those are the costs
//     this class never spends itself — the things that *do* them report here.
//   * Four points empty one shank: saturation first while any is left, then
//     food itself. Saturation is the reason a steak keeps you full for real
//     time: a full meal fills both bars, and the second one is spent before
//     the first one is touched.
//   * Health regenerates one hit point every four seconds, but only while
//     food is 18 or more and something is still in the saturation bar — the
//     rule that makes a good meal healing and a bare meal merely survival.
//   * At zero food, hunger turns on you: one hit point every four seconds.
//     It is not fast, and that is the whole design — starving is a slow
//     countdown to do something about, not a sudden death.



/** The two bars, both twenty, drawn as ten drumsticks apiece. */
export const MAX_FOOD = 20;
export const MAX_SATURATION = 20;

/** Exhaustion points per shank. Four points, one shank, Minecraft's rule. */
export const EXHAUSTION_PER_POINT = 4;

/**
 * Exhaustion for doing things. Each value is Minecraft's, in points: walking
 * is per metre, so a day's walk is a day of steadily rising hunger rather
 * than an instant of it.
 */
export const EXHAUST_WALK = 0.01;      // per metre, walking or swimming
export const EXHAUST_SPRINT = 0.1;     // per metre, sprinting (or sprint-swimming)
export const EXHAUST_JUMP = 0.05;      // per jump
export const EXHAUST_JUMP_SPRINT = 0.2; // per sprint jump
export const EXHAUST_ATTACK = 0.1;     // landing a hit
export const EXHAUST_HURT = 0.1;       // taking one
export const EXHAUST_MINE = 0.005;     // breaking a block

/** The food level at which health starts to come back. */
export const REGEN_FOOD = 18;
/** Hit points healed each regen interval. */
export const REGEN_HEAL = 1;
/** Seconds between regen ticks (Minecraft's, on Normal). */
export const REGEN_INTERVAL = 4;
/** Exhaustion a regen tick spends — Minecraft's 1.5 shanks, 6 points. */
export const REGEN_EXHAUSTION = 6;

/** Hit points lost per starvation interval at zero food. */
export const STARVE_DAMAGE = 1;
/** Seconds between those losses. Slow enough to be a countdown, not a trap. */
export const STARVE_INTERVAL = 4;

/**
 * Food poisoning. Rotten flesh and raw chicken have a chance of it: the food
 * bar drains for half a minute as your stomach makes its opinion known. It is
 * a debuff, not a second damage bar — Minecraft's "Hunger" effect, modelled
 * as a steady drain rather than a status icon, because this HUD has no
 * status icons and the drain is the part that matters.
 */
export const POISON_SECONDS = 30;
/** Food points drained per second while poisoned (six shanks all told). */
export const POISON_DRAIN = 0.2;

export class Hunger {
  constructor() {
    /** How full you are, 0..20. The bar food is drawn from. */
    this.food = MAX_FOOD;
    /** Hidden full-ness, 0..20, spent before food is touched. */
    this.saturation = 5;
    /** Points toward the next shank lost, 0..4. */
    this.exhaustion = 0;
    /** Seconds of food poisoning left, or 0. */
    this.poison = 0;
    /** Seconds until the next regen tick; clock only runs when it can. */
    this._regenClock = 0;
    /** Seconds until the next starvation loss, kept across calls. */
    this._starveClock = 0;
  }

  /** Is there anything left to eat *for*? Both bars full means no. */
  get canEat() {
    return this.food < MAX_FOOD || this.saturation < MAX_SATURATION;
  }

  /**
   * Spend effort. When enough has piled up — four points — a shank comes
   * off, saturation before food, and the clock starts again from zero.
   */
  addExhaustion(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.exhaustion += amount;
    while (this.exhaustion >= EXHAUSTION_PER_POINT) {
      this.exhaustion -= EXHAUSTION_PER_POINT;
      if (this.saturation > 0) {
        this.saturation -= 1;
      } else if (this.food > 0) {
        this.food -= 1;
      } else {
        // Nothing left to take from: the extra is simply spent.
        this.exhaustion = 0;
        break;
      }
    }
  }

  /**
   * Eat. Nutrition goes into the food bar and saturation into the hidden
   * one, capped at twenty each — Minecraft's rule, and the reason a golden
   * apple would be "wasted" on a full stomach.
   *
   * @returns {boolean} false when both bars are already full (nothing to
   *   restore, so the caller should not spend the item).
   */
  eat(nutrition, saturation) {
    if (!this.canEat) return false;
    this.food = Math.min(MAX_FOOD, this.food + nutrition);
    this.saturation = Math.min(MAX_SATURATION, this.saturation + saturation);
    return true;
  }

  /** Food poisoning for a while. Re-arming extends rather than resets. */
  applyPoison(seconds = POISON_SECONDS) {
    this.poison = Math.max(this.poison, seconds);
  }

  /**
   * Advance the slow clocks by `dt` game seconds.
   *
   * @returns {{heal: number, starve: number}} hit points to give back and to
   *   take away. The caller owns health — this class owns only the appetite —
   *   so the two come out as numbers rather than being applied here.
   */
  tick(dt) {
    let heal = 0;
    let starve = 0;

    // Poison drains the food bar first, then saturation, one shank at a
    // time on the same four-point tariff as everything else.
    if (this.poison > 0) {
      this.poison = Math.max(0, this.poison - dt);
      this.addExhaustion(POISON_DRAIN * dt * EXHAUSTION_PER_POINT);
    }

    // Regeneration: only while well fed, and only while there is saturation
    // left to burn. The clock accumulates when the condition holds and
    // freezes (not resets) when it stops, so eating again picks up where
    // healing left off.
    if (this.food >= REGEN_FOOD && this.saturation > 0) {
      this._regenClock += dt;
      while (this._regenClock >= REGEN_INTERVAL) {
        this._regenClock -= REGEN_INTERVAL;
        this.addExhaustion(REGEN_EXHAUSTION);
        heal += REGEN_HEAL;
        if (!(this.food >= REGEN_FOOD && this.saturation > 0)) break;
      }
    } else {
      this._regenClock = 0;
    }

    // Starvation: the counterweight. At zero food the body eats itself.
    if (this.food <= 0) {
      this._starveClock += dt;
      while (this._starveClock >= STARVE_INTERVAL) {
        this._starveClock -= STARVE_INTERVAL;
        starve += STARVE_DAMAGE;
      }
    } else {
      this._starveClock = 0;
    }

    return { heal, starve };
  }

  toJSON() {
    return {
      food: this.food,
      saturation: this.saturation,
      exhaustion: this.exhaustion,
      poison: this.poison,
    };
  }

  fromJSON(raw) {
    if (!raw) return;
    this.food = clampStat(raw.food, 0, MAX_FOOD);
    this.saturation = clampStat(raw.saturation, 0, MAX_SATURATION);
    this.exhaustion = clampStat(raw.exhaustion, 0, EXHAUSTION_PER_POINT);
    this.poison = clampStat(raw.poison, 0, POISON_SECONDS);
  }
}

/** A stat restored from a save: number, finite, clamped into range. */
function clampStat(v, lo, hi) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}
