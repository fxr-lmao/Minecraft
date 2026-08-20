// Procedural sound system — block break/place, footsteps, splashes, tool
// swings, weather. Everything is synthesised from Web Audio oscillators and
// noise buffers so there are zero external assets to load.

import { GRASS, DIRT, STONE, SAND, SNOW, LOG, LEAVES, DEEPSLATE, PLANKS } from './terrain.js';

let ctx = null;
let master = null;
let muted = false;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return { ctx, master };
}

/** A short buffer of white noise. */
function noiseBuffer(ctx, dur) {
  const sr = ctx.sampleRate;
  const len = Math.ceil(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** A short burst of filtered noise — the core of every block hit. */
function burstNoise(ctx, dur, lpFreq, gain, dest) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = lpFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(lp).connect(g).connect(dest);
  src.start(ctx.currentTime);
  src.stop(ctx.currentTime + dur + 0.01);
}

// ---- block break/place sounds ----
// Each material sounds like itself: stone is a dull low crack, sand a short
// hiss, leaves a rustle. The mapping keys off the *surface block* id.

const BREAK_PROFILES = {
  [STONE]:   { lp: 800,  gain: 0.9, dur: 0.10 },
  [DEEPSLATE]: { lp: 500,  gain: 1.0, dur: 0.12 },
  [SAND]:    { lp: 2200, gain: 0.5, dur: 0.06 },
  [SNOW]:    { lp: 3200, gain: 0.3, dur: 0.05 },
  [LEAVES]:  { lp: 2600, gain: 0.3, dur: 0.04 },
  [GRASS]:   { lp: 1600, gain: 0.5, dur: 0.07 },
  [DIRT]:    { lp: 1200, gain: 0.5, dur: 0.07 },
  [LOG]:     { lp: 1100, gain: 0.5, dur: 0.09 },
  [PLANKS]:  { lp: 1100, gain: 0.5, dur: 0.08 },
};

const DEFAULT_BREAK = { lp: 1000, gain: 0.6, dur: 0.08 };

export function playBlockBreak(blockId) {
  if (muted) return;
  const { ctx, master } = getCtx();
  const p = BREAK_PROFILES[blockId] ?? DEFAULT_BREAK;
  burstNoise(ctx, p.dur, p.lp, p.gain, master);
  // A click transient for hard blocks
  if (p.lp < 1000) {
    burstNoise(ctx, 0.025, 4000, 0.25, master);
  }
}

export function playBlockPlace(blockId) {
  if (muted) return;
  const { ctx, master } = getCtx();
  const p = BREAK_PROFILES[blockId] ?? DEFAULT_BREAK;
  // Shorter, softer — a "thump" rather than a "crack"
  burstNoise(ctx, p.dur * 0.6, p.lp * 0.7, p.gain * 0.5, master);
}

// ---- footstep sounds ----

const STEP_PROFILES = {
  [STONE]:   { lp: 600,  gain: 0.35, dur: 0.04 },
  [DEEPSLATE]: { lp: 500,  gain: 0.40, dur: 0.04 },
  [SAND]:    { lp: 3000, gain: 0.20, dur: 0.05 },
  [SNOW]:    { lp: 4000, gain: 0.12, dur: 0.06 },
  [LEAVES]:  { lp: 3500, gain: 0.10, dur: 0.04 },
  [GRASS]:   { lp: 2500, gain: 0.22, dur: 0.05 },
  [DIRT]:    { lp: 2000, gain: 0.22, dur: 0.05 },
  [PLANKS]:  { lp: 900,  gain: 0.30, dur: 0.04 },
  [LOG]:     { lp: 900,  gain: 0.30, dur: 0.04 },
};
const DEFAULT_STEP = { lp: 1500, gain: 0.20, dur: 0.04 };

let stepTimer = 0;

export function playStep(blockId) {
  if (muted) return;
  // Rate limit footsteps (max ~10/s)
  const now = performance.now();
  if (now - stepTimer < 80) return;
  stepTimer = now;
  const { ctx, master } = getCtx();
  const p = STEP_PROFILES[blockId] ?? DEFAULT_STEP;
  burstNoise(ctx, p.dur, p.lp, p.gain, master);
}

// ---- tool swing ----

let lastSwing = 0;
export function playSwing() {
  if (muted) return;
  const now = performance.now();
  if (now - lastSwing < 60) return;
  lastSwing = now;
  const { ctx, master } = getCtx();
  burstNoise(ctx, 0.04, 2000, 0.12, master);
}

// ---- picking things up ----

let lastPickup = 0;

/**
 * Minecraft's pop: a short sine blip that slides *up* in pitch.
 *
 * The rise is the whole of it. A falling blip reads as something being spent
 * and a rising one as something being gained, which is why every game that
 * has ever made a coin noise has made it go up. The pitch varies a little
 * per pickup so that walking through a scattered pile is an arpeggio rather
 * than a stuck key, and it is rate-limited hard, because a stack of thirty
 * cobblestone collected in one stride is thirty of these at once and that is
 * a buzz, not a sound.
 */
export function playPickup() {
  if (muted) return;
  const now = performance.now();
  if (now - lastPickup < 55) return;
  lastPickup = now;
  const { ctx, master } = getCtx();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const base = 620 + Math.random() * 120;
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.07);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.13);
}

/**
 * Something hitting the floor: a dropped item landing, or a thrown one.
 * Quieter and duller than a block break, because it is a thing settling
 * rather than a thing coming apart.
 */
let lastLand = 0;
export function playDropLand(force = 1) {
  if (muted) return;
  // Rate limited hard: a broken furnace spills its contents in one frame and
  // a TNT crater rains rubble for a second afterwards. Without this it is not
  // a series of thuds, it is a roar.
  const now = performance.now();
  if (now - lastLand < 70) return;
  lastLand = now;
  const { ctx, master } = getCtx();
  const f = Math.max(0, Math.min(1, force));
  // Harder impacts are louder, longer and brighter — the difference between
  // a block nudged off a ledge and one dropped down a ravine.
  burstNoise(ctx, 0.035 + f * 0.03, 620 + f * 260, 0.06 + f * 0.12, master);
}

// ---- water ----

export function playSplash(force) {
  if (muted) return;
  const { ctx, master } = getCtx();
  const dur = 0.08 + force * 0.18;
  const gain = 0.3 + force * 0.7;
  burstNoise(ctx, dur, 2500, gain, master);
  // Bubbles: a higher pitched burst that trails
  setTimeout(() => {
    if (muted) return;
    burstNoise(ctx, 0.15, 4000, 0.15, master);
  }, 60);
}

export function playBubble() {
  if (muted) return;
  const { ctx, master } = getCtx();
  burstNoise(ctx, 0.03, 6000, 0.05, master);
}

// ---- damage ----

export function playHurt() {
  if (muted) return;
  const { ctx, master } = getCtx();
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.15, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.connect(g).connect(master);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.16);
}

export function playDrown() {
  if (muted) return;
  const { ctx, master } = getCtx();
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 180;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.08, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  osc.connect(g).connect(master);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);
}

// ---- weather ----

export function playThunder() {
  if (muted) return;
  const { ctx, master } = getCtx();
  const t = ctx.currentTime;
  burstNoise(ctx, 0.6, 200, 0.6, master);
  // Low rumble tail
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(50, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.08, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.9);
}

// ---- creative flight wind ----

let windSrc = null;
let windGain = null;

export function setFlightWind(on) {
  if (muted) return;
  const { ctx, master } = getCtx();
  if (on && !windSrc) {
    windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer(ctx, 0.5);
    windSrc.loop = true;
    windGain = ctx.createGain();
    windGain.gain.value = 0.03;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    windSrc.connect(lp).connect(windGain).connect(master);
    windSrc.start();
  } else if (!on && windSrc) {
    const g = windGain;
    windGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    setTimeout(() => {
      try { windSrc.stop(); } catch (e) { /* already stopped */ }
      windSrc = null;
      windGain = null;
    }, 350);
  }
}

// ---- mute toggle ----

export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  if (muted && windSrc && windGain) windGain.gain.value = 0;
  return muted;
}

export function setMuted(v) {
  muted = v;
  if (muted && windSrc && windGain) windGain.gain.value = 0;
}
