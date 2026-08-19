// Weather: rain, and snow where it is already cold enough to freeze.
//
// The water in this game has all been water you can walk into. This is the
// other half of the water cycle — the part that arrives from above, lands on
// everything, and is the reason the sea is there in the first place.
//
// Three things decide what you see out of the window:
//
//   the cycle      whether it is raining at all, which is a property of the
//                  world and not of anywhere in it. Minecraft keeps one
//                  clock: clear for 12,000-180,000 ticks, rain for
//                  12,000-24,000, and a `rainLevel` that ramps by 0.01 a
//                  tick so a downpour arrives over five seconds instead of
//                  between two frames. Those are the numbers below.
//   the column     what falls *here*, which is the climate again — the same
//                  temperature that decides where water freezes decides
//                  whether the rain is snow. It is why the peaks go white
//                  while the valley gets wet, off one number and no second
//                  system.
//   the sky        whether it can reach you. The top solid block in the
//                  column answers it, so a roof keeps you dry and an
//                  overhang keeps the block under it dry while the one
//                  beside it is not.
//
// Deserts get nothing. Minecraft decides that per biome with a flag, and
// every biome carrying it sits at temperature 2.0, so a threshold on the
// same number picks out the same places — and, because the biome mix here is
// blended rather than chosen, gives the desert a fading edge instead of a
// line you can stand on with one boot in the rain.
//
// Nothing here draws anything or knows what a particle is: it answers "is it
// raining", "what falls at this column" and "for how long", and particles.js
// turns that into water in the air. No THREE, no DOM, so the whole cycle is
// unit-testable.

import { FREEZING_POINT, NO_PRECIPITATION_TEMPERATURE } from './terrain.js';

/** The world's weather. */
export const CLEAR = 0;
export const RAIN = 1;

/** What falls at a particular place. */
export const DRY = 0;
export const RAINING = 1;
export const SNOWING = 2;

/**
 * Spell lengths in seconds, which are Minecraft's tick counts divided by 20:
 * clear for ten minutes to a little over two hours, rain for ten to twenty.
 */
export const CLEAR_MIN = 600;
export const CLEAR_RANGE = 8400;
export const RAIN_MIN = 600;
export const RAIN_RANGE = 600;

/**
 * Except the first one, which is a minute or less.
 *
 * Minecraft can afford to make you wait an hour for rain because you are
 * going to be there for a hundred of them. Nobody opens a browser tab for two
 * hours to find out whether it has weather, and a feature nobody ever sees is
 * the same as one that is not there — so the first spell of clear is short,
 * and every one after it is the real thing.
 */
export const FIRST_CLEAR_MIN = 40;
export const FIRST_CLEAR_RANGE = 50;

/** How fast the intensity moves toward its target. Minecraft: 0.01 a tick. */
export const RAMP_RATE = 0.2;

export class Weather {
  /**
   * @param {{random?: () => number, state?: number, seconds?: number}} [opts]
   *   `random` for a seeded cycle the tests can predict; `state`/`seconds`
   *   to start somewhere other than the beginning of a short clear spell.
   */
  constructor(opts = {}) {
    this.random = opts.random ?? Math.random;
    /** CLEAR or RAIN — what the sky is doing. */
    this.state = opts.state ?? CLEAR;
    /**
     * How much of it there is, 0 to 1. Not a copy of `state`: it lags behind
     * on purpose, so rain fades up and dies away rather than switching, and
     * everything that reads the weather — the particles, the light, the fog —
     * gets that for free by multiplying by this instead of branching on the
     * state.
     */
    this.level = this.state === RAIN ? 1 : 0;
    /** Seconds this spell has left. */
    this.left = opts.seconds ?? (FIRST_CLEAR_MIN + this.random() * FIRST_CLEAR_RANGE);
    /** Spells since the world began, for the debug screen. */
    this.spells = 0;
  }

  get raining() {
    return this.state === RAIN;
  }

  /** How long the next spell of this kind should last, in seconds. */
  spellLength(state) {
    return state === RAIN
      ? RAIN_MIN + this.random() * RAIN_RANGE
      : CLEAR_MIN + this.random() * CLEAR_RANGE;
  }

  /** Change the weather now, whatever the clock says. */
  turn() {
    this.state = this.state === RAIN ? CLEAR : RAIN;
    this.left = this.spellLength(this.state);
    this.spells++;
    return this.state;
  }

  /**
   * Advance the clock. Returns the intensity, because every caller wants it
   * and none of them want the state.
   */
  update(dt) {
    if (dt > 0) {
      this.left -= dt;
      if (this.left <= 0) this.turn();
      const target = this.state === RAIN ? 1 : 0;
      const step = RAMP_RATE * dt;
      if (this.level < target) this.level = Math.min(target, this.level + step);
      else if (this.level > target) this.level = Math.max(target, this.level - step);
    }
    return this.level;
  }

  /**
   * What falls at a column, given the height the weather would land at.
   *
   * The height matters as much as the place: the air cools as you climb, so
   * the same rain that is falling on the shore is snow by the time the same
   * storm reaches the top of the mountain behind it.
   */
  fallAt(world, x, y, z) {
    if (this.level <= 0) return DRY;
    const t = world.temperatureAt(x, y, z);
    if (t >= NO_PRECIPITATION_TEMPERATURE) return DRY;
    return t < FREEZING_POINT ? SNOWING : RAINING;
  }

  /**
   * Can the sky reach this point? The top solid block in the column decides,
   * exactly as it does for freezing — which is what makes a shelter a
   * shelter, in one line, without anything having to know what a roof is.
   */
  openSky(world, x, y, z) {
    return y >= world.heightAt(x, z);
  }
}
