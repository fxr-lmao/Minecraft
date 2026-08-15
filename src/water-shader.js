// How water *looks*.
//
// water-mesh.js already solved the geometry: the surface is a continuous sheet
// whose height lives at the corners, so a stream slopes instead of stepping.
// This is the other half, and the first version of it got the big thing right
// — Fresnel, a real swell, an analytic normal — and then guessed at three
// quantities it had no way to know:
//
//   * how much water the light came through, guessed from a per-corner count
//     of water blocks;
//   * where the waterline was, guessed from how many of a corner's four cells
//     were land;
//   * what was above to reflect, guessed as a gradient.
//
// Guessing gave a beach that looked like wet sand with white worms painted on
// it. Shallow water was 46% opaque over bright sand, so what you saw was sand.
// Turning the alpha up would have hidden the sea floor instead, which is
// worse. The problem was never the number — it was that a quantity which can
// be measured was being estimated.
//
// So water-render.js measures them, and this shades from the measurements:
//
//   * **Absorption.** The depth texture gives the exact distance light
//     travelled through the water to reach the eye, and Beer-Lambert turns it
//     into colour: red is absorbed about eight times faster than blue, which
//     is why a hand's depth over sand is faintly green and six blocks of the
//     same water is deep blue. Nothing about that is a colour ramp somebody
//     picked; it is one exponential per channel.
//   * **Refraction.** What is behind the surface is sampled through the wave
//     normal, so the sea floor moves under the ripples.
//   * **The shoreline** is where the thickness goes to zero, so foam finds it
//     by itself — around a block sticking out of a pond as readily as along a
//     coast, and softly, with no line anywhere.
//   * **Reflection** is the world, rendered again from a mirrored camera,
//     scattered by the same wave normal. Where there is no reflection pass it
//     falls back to the procedural sky.
//   * **Caustics** are cast onto the point behind the surface, reconstructed
//     from the depth buffer, which is the reason they can no longer land on
//     dry sand: a pixel with no water in front of it is not shaded by this
//     shader at all.
//
// Every one of those degrades to the old guess when the passes are off, which
// is what the two USE_ flags select.

import * as THREE from '../vendor/three.module.min.js';
import { SKY_TOP, SKY_HORIZON } from './sky.js';
import { SWELL_GLSL, CAUSTIC_GLSL, SKY_GLSL } from './water-glsl.js';

/**
 * Beer-Lambert absorption per block of water, per channel. These are the
 * numbers that decide what colour the sea is; there is no separate "deep
 * colour" any more, because the deep colour is what you get when you run
 * these far enough.
 */
const ABSORB = new THREE.Vector3(0.33, 0.075, 0.042);
/** What the water scatters back toward you — the colour of "too far to see". */
const SCATTER_COLOR = 0x1d6f9c;
/**
 * The colour a shallow stretch comes out at. Only the lowest quality setting
 * needs it: with a depth pass the shallows are the sea floor seen through a
 * measured thickness of water, and no colour has to be named at all.
 */
const SHALLOW_COLOR = 0x2f93ad;
/** Broken water. Not pure white: that reads as snow. */
const FOAM_COLOR = 0xe8f4ff;
/** Matches the directional light in main.js. */
const SUN_COLOR = 0xfff2d9;
/** The tint of sunlight that has already been through several metres of sea. */
const CAUSTIC_TINT = new THREE.Vector3(0.55, 1.0, 0.92);

/**
 * How far a fragment's refracted sample may slide, in screen widths at one
 * block away. Scaled down by distance and by how little water there is, so a
 * puddle does not shear the block it is lying in.
 */
const REFRACT_STRENGTH = 0.045;

/** How many blocks of water the shoreline foam spreads over. */
const FOAM_DEPTH = 1.25;

/**
 * Uniforms shared by every water surface. The render passes write into these,
 * so the two materials and the composite all run off one clock and one
 * measurement of the frame.
 */
export const waterUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.48, 0.8, 0.32).normalize() },
  uSunColor: { value: new THREE.Color(SUN_COLOR) },
  uSkyTop: { value: new THREE.Color(SKY_TOP) },
  uSkyHorizon: { value: new THREE.Color(SKY_HORIZON) },
  uAbsorb: { value: ABSORB.clone() },
  uScatter: { value: new THREE.Color(SCATTER_COLOR) },
  uShallow: { value: new THREE.Color(SHALLOW_COLOR) },
  uFoam: { value: new THREE.Color(FOAM_COLOR) },
  uCausticTint: { value: CAUSTIC_TINT.clone() },
  /** 1 while the camera itself is under the surface. */
  uUnder: { value: 0 },

  // ---- filled in by the render passes ----
  uSceneColor: { value: null },
  uSceneDepth: { value: null },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uCameraNear: { value: 0.1 },
  uCameraFar: { value: 1000 },
  uReflection: { value: null },
  uReflectionMatrix: { value: new THREE.Matrix4() },
  uReflectionStrength: { value: 0 },
};

/** Seconds of game time. Paused means the sea stops, like everything else. */
export function advanceWaterTime(dt) {
  // Wrapped well away from the point where a float32 stops being able to
  // resolve a frame. The discontinuity is a phase jump in a sine — invisible,
  // and once an hour.
  waterUniforms.uTime.value = (waterUniforms.uTime.value + dt) % 3600;
}

/** Tell the water which side of itself the camera is on. */
export function setCameraUnderwater(under) {
  waterUniforms.uUnder.value = under ? 1 : 0;
}

/** Point the specular highlight at wherever main.js put the sun. */
export function setSunDirection(x, y, z) {
  waterUniforms.uSunDir.value.set(x, y, z).normalize();
}

// ------------------------------------------------------------------- GLSL

const WATER_VERTEX = /* glsl */ `
${SWELL_GLSL}

uniform float uTime;
uniform float uWaveScale;

// depth (0..1 over eight blocks), shore (0..1), wave amplitude, churn.
// Packed by the mesher; see water-mesh.js. Only the wave amplitude is still
// load-bearing once the depth texture is available — the other three are the
// fallback the lowest quality setting shades from.
attribute vec4 wdata;

varying vec3 vWorld;
varying vec3 vGeom;
varying vec2 vTexture;
varying vec4 vData;
varying float vCrest;
varying vec4 vClip;

#ifdef USE_FOG
  varying float vFogDepth;
#endif

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);

  // How much this vertex is allowed to move. It is a property of the *corner*
  // of the fluid grid, not of the face, which is what keeps a surface quad and
  // the top edge of the wall beneath it welded together: both read the same
  // corner and so both move by the same amount. Shallow water and the feather
  // edge against the shore get none of it, so a one-ninth puddle cannot ripple
  // its way through the floor it is lying on.
  float amp = wdata.z * uWaveScale;
  float h = 0.0;
  vec2 g = vec2(0.0);
  if (amp > 0.002) {
    swell(world.xz, uTime, h, g);
    world.y += h * amp;
  }

  vCrest = h * 18.0; // roughly -1..1: how near this point is to a wave crest
  vWorld = world.xyz;
  vGeom = normal;
  vTexture = uv;
  vData = wdata;

  vec4 mv = viewMatrix * world;
  #ifdef USE_FOG
    vFogDepth = -mv.z;
  #endif
  vClip = projectionMatrix * mv;
  gl_Position = vClip;
}
`;

const WATER_FRAGMENT = /* glsl */ `
${SWELL_GLSL}
${CAUSTIC_GLSL}
${SKY_GLSL}

uniform float uTime;
uniform sampler2D uMap;
uniform vec2 uScroll;
uniform float uPatternGain;
uniform float uOpacity;
uniform float uNormalGain;
uniform float uRefractGain;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uAbsorb;
uniform vec3 uScatter;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uCausticTint;
uniform float uUnder;

uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform sampler2D uReflection;
uniform mat4 uReflectionMatrix;
uniform float uReflectionStrength;

varying vec3 vWorld;
varying vec3 vGeom;
varying vec2 vTexture;
varying vec4 vData;
varying float vCrest;
varying vec4 vClip;

#include <packing>
#include <fog_pars_fragment>

/** How far the eye is from whatever the depth buffer has at this pixel. */
float sceneDistance(vec2 uv) {
  float raw = texture2D(uSceneDepth, uv).x;
  return -perspectiveDepthToViewZ(raw, uCameraNear, uCameraFar);
}

void main() {
  bool top = vGeom.y > 0.5;
  vec3 toEye = cameraPosition - vWorld;
  float eyeDist = length(toEye);
  vec3 V = toEye / eyeDist;

  // ---- the normal ----
  // On the surface it comes from the derivative of the same swell that
  // displaced the vertex, plus the fine ripples, evaluated per pixel — so the
  // highlights are as detailed as the maths rather than as coarse as the mesh.
  // Walls of a waterfall keep their flat geometric normal.
  vec3 N = normalize(vGeom);
  if (top) {
    float h = 0.0;
    vec2 g = vec2(0.0);
    swell(vWorld.xz, uTime, h, g);
    ripples(vWorld.xz, uTime, g);
    N = normalize(vec3(-g.x, 1.0, -g.y) * vec3(uNormalGain, 1.0, uNormalGain));
  }

  // The pixel tile is still here, as a brightness ripple rather than as the
  // colour itself. This is a Minecraft clone, and the hand-drawn 16x16 pattern
  // scrolling across the surface is a good part of why the sea reads as *this*
  // game's sea and not as some other engine's.
  float pattern = texture2D(uMap, vTexture + uScroll).r * 2.0 - 1.0;

  vec2 screenUv = vClip.xy / vClip.w * 0.5 + 0.5;

  // ---- what is behind the water, and how much water is in the way ----
  vec3 transmitted;
  float thickness;
  float alpha;

#if USE_REFRACTION
  // Manual depth test. This pass draws nothing but water, into a depth buffer
  // nobody filled, so the test the GPU would have done for free has to be done
  // here instead — against the depth texture from the pass that did fill one.
  float fragDist = -perspectiveDepthToViewZ(
    (vClip.z / vClip.w) * 0.5 + 0.5, uCameraNear, uCameraFar);
  // The bias matters more than it looks. At the feather edge of a spread the
  // surface tapers down onto the floor it is lying on, so the two are the same
  // depth to within a float, the comparison goes either way at random, and the
  // band that gets thrown away is exactly the shallowest one — the waterline,
  // the only place foam was ever going to be.
  float bias = max(0.03, fragDist * 0.004);
  float behind = sceneDistance(screenUv);
  if (behind < fragDist - bias) discard;

  thickness = max(behind - fragDist, 0.0);

  // Slide the sample along the surface normal. Scaled by the thickness, so a
  // puddle does not shear the block it is lying in, and by distance, so the
  // distortion is a property of the water rather than of how close you are.
  float slide = uRefractGain * min(thickness, 3.0) / max(fragDist, 1.0);
  vec2 refractUv = clamp(screenUv + N.xz * slide, vec2(0.001), vec2(0.999));
  // ...unless that sample is of something in *front* of the water, which
  // would smear a block standing in the shallows out across the surface.
  float refractedBehind = sceneDistance(refractUv);
  if (refractedBehind < fragDist - bias) {
    refractUv = screenUv;
    refractedBehind = behind;
  }
  thickness = max(refractedBehind - fragDist, 0.0);

  vec3 floorColor = texture2D(uSceneColor, refractUv).rgb;

  // Caustics, cast onto the point the light actually reached. Reconstructed
  // from the depth buffer, which is why they cannot land anywhere there is no
  // water in front of them — a dry beach is not drawn by this shader at all.
  vec3 hit = cameraPosition - V * refractedBehind;
  float lines = caustic(hit.xz * 1.7, uTime);
  floorColor += uSunColor * uCausticTint * lines * exp(-thickness * 0.32) * 0.30;

  // Beer-Lambert. Red goes first, then green, and what is left over any
  // distance at all is blue. This one expression is the colour of water.
  //
  // The distance is both legs of the journey: down from the surface to
  // whatever the light hit, and back out to the eye. Counting only the
  // second leg makes a deep sea floor viewed from straight above look as
  // though it were lit from nowhere — which is what it looked like.
  float below = max(vWorld.y - hit.y, 0.0);
  float path = thickness + below * 1.15;
  vec3 transmit = exp(-uAbsorb * path);
  transmitted = floorColor * transmit + uScatter * (1.0 - transmit);

  // The surface is opaque in the sense that it replaces what is behind it —
  // the absorption above has already done the blending, correctly, per
  // channel. What is left for alpha is only the very edge, where there is so
  // little water that even the surface tension of a rendered quad is a lie.
  alpha = smoothstep(0.0, 0.06, thickness);
#else
  // No depth pass: fall back to the mesher's per-corner estimate. It cannot
  // see what is behind the water, so it cannot absorb anything — the best it
  // can do is guess the colour the absorption would have produced and lean on
  // opacity to make the water visible at all. That is what the whole surface
  // used to be, and the reason there is a depth pass now.
  thickness = vData.x * 8.0;
  vec3 transmit = exp(-uAbsorb * thickness);
  transmitted = mix(uShallow, uScatter, 1.0 - transmit.b);
  alpha = clamp(uOpacity * mix(0.95, 1.35, vData.x), 0.0, 0.96);
#endif

  transmitted *= 1.0 + pattern * uPatternGain * 0.5;

  // ---- what is above the water ----
  // Which side of the surface the camera is on. gl_FrontFacing would be the
  // obvious test and it is the wrong one: at the horizon the view is within a
  // degree of grazing, the swell tilts the odd quad past that, and those few
  // quads flip to the underwater branch and paint a black stripe across the
  // sea. Comparing heights cannot flip.
  bool fromAbove = !top || cameraPosition.y >= vWorld.y;

  // Fresnel, Schlick, with water's 2% at normal incidence. Look straight down
  // and you see the bottom; look across and it is a mirror. Most of the
  // difference between "blue glass" and "a lake" is this one term.
  float f = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  float fresnel = clamp(0.02 + 0.98 * f, 0.0, 1.0);

  vec3 color;

  if (fromAbove) {
    vec3 reflectDir = reflect(-V, N);
    vec3 sky = skyAlong(reflectDir, uSunDir, uSunColor, uSkyTop, uSkyHorizon) * 0.78;
    // A reflection along the surface is not a clean image of the sky. You are
    // looking across the slopes of every wave between here and the horizon,
    // and what comes back is part sky and part the water's own colour. Without
    // this the whole lower half of the screen goes the colour of the horizon
    // haze, which here is very nearly white — the sea disappears into it.
    float grazing = 1.0 - clamp(abs(reflectDir.y) * 4.0, 0.0, 1.0);
    sky = mix(sky, uScatter * 1.35, grazing * 0.45);
    vec3 mirrored = sky;

#if USE_REFLECTION
    if (uReflectionStrength > 0.0) {
      // The world, rendered from the mirrored camera, looked up by projecting
      // this point with that camera — and nudged by the wave normal, which is
      // what turns a hard mirror into water.
      vec4 rp = uReflectionMatrix * vec4(vWorld, 1.0);
      vec2 ruv = rp.xy / max(rp.w, 0.001);
      // A hard mirror is not water. The wave normal scatters the lookup, and
      // it has to scatter it by enough that the reflection reads as a
      // disturbed surface rather than as glass someone laid over the bay.
      ruv += N.xz * 0.16;
      if (ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0) {
        vec3 world = texture2D(uReflection, ruv).rgb;
        // Fade back to the sky near the top of the reflection, where the
        // mirrored camera ran out of frustum, and at a glancing angle where
        // the nudge would have sampled off the edge.
        float edge = smoothstep(0.0, 0.12, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
        mirrored = mix(sky, world, edge * uReflectionStrength);
      }
    }
#endif

    // The glitter: a tight lobe for the sun's own reflection and a broad one
    // for the sheen around it.
    vec3 halfway = normalize(V + uSunDir);
    float ndh = max(dot(N, halfway), 0.0);
    float spec = pow(ndh, 300.0) * 3.4 + pow(ndh, 26.0) * 0.11;

    // Under water there is no sky to reflect, so the mirror term is mostly
    // turned off and what is left is the body of the water itself.
    // Capped below one. Schlick says a perfect flat surface is a perfect
    // mirror at ninety degrees, and water is neither perfect nor flat: at
    // that angle you are seeing a statistical average over wave slopes, and
    // some of every pixel is always the water underneath.
    float mirror = min(fresnel * 0.92, 0.80) * (1.0 - uUnder * 0.62);
    color = mix(transmitted, mirrored, mirror);
    color += uSunColor * spec * (1.0 - uUnder * 0.85);
    alpha = mix(alpha, 0.98, mirror);
  } else {
    // Seen from below. Refraction squeezes the entire sky into a cone 97°
    // wide — Snell's window — and outside it the surface is a mirror looking
    // back down into the dark. The boundary is at cos(48.6°) = 0.66.
    float lift = clamp(abs(V.y), 0.0, 1.0);
    float window = smoothstep(0.54, 0.78, lift);
    vec3 above = skyAlong(vec3(V.x, abs(V.y), V.z),
      uSunDir, uSunColor, uSkyTop, uSkyHorizon) * 0.92;
    color = mix(uScatter * 0.55, above, window);
    color += uSunColor * caustic(vWorld.xz * 1.7, uTime) * 0.18 * (1.0 - window);
    alpha = mix(0.94, 0.55, window);
  }

  // ---- foam ----
  // Three sources. The shoreline, which with a depth pass is simply where the
  // water gets thin — so it finds the edge of a pond and the base of a block
  // standing in the shallows without being told where either of them is. The
  // crests of the swell, but only near the shore, because open water does not
  // break. And churn, which the mesher sets on anything falling or running.
  float mottle = 0.55 + 0.45 * sin(vWorld.x * 2.7 + vWorld.z * 3.4 + uTime * 1.6)
                      * (0.6 + 0.4 * sin(vWorld.z * 1.3 - vWorld.x * 0.9 - uTime * 1.1));
  float churn = vData.w;
#if USE_REFRACTION
  float shallow = 1.0 - smoothstep(0.0, ${FOAM_DEPTH.toFixed(2)}, thickness);
#else
  float shallow = smoothstep(0.05, 0.45, vData.y);
#endif
  // The mottle only ever varies the band, never punches holes in it: a
  // shoreline that comes and goes along its length reads as a bug, and the
  // waterline is the one edge in the scene the eye is looking for.
  float grain = 0.62 + 0.38 * mottle;
  float foam = top
    ? shallow * shallow * (0.55 + 0.45 * smoothstep(-0.5, 0.9, vCrest)) + churn * 0.34
    : churn * 0.50;
  foam = clamp(foam * grain * 1.75, 0.0, 1.0);
  color = mix(color, uFoam, foam * 0.92);
  alpha = max(alpha, foam * 0.96);

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));

#if !USE_REFRACTION
  // The one-pass path is the only one that still needs these: with the
  // refraction pass on, the colour behind the water has already been through
  // both, and running them again would tone-map the sea floor twice.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#else
  #include <colorspace_fragment>
#endif
  #include <fog_fragment>
}
`;

/**
 * One water material. Still and flowing water get one each: they are different
 * textures scrolling at different speeds, and moving water is not allowed to
 * swell (a stream running down a hillside does not have waves on it).
 */
export function createWaterMaterial({
  map, waveScale, patternGain, opacity, normalGain, refractGain = 1,
}) {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: null },
        uScroll: { value: new THREE.Vector2(0, 0) },
        uWaveScale: { value: waveScale },
        uPatternGain: { value: patternGain },
        uNormalGain: { value: normalGain },
        uOpacity: { value: opacity },
        uRefractGain: { value: REFRACT_STRENGTH * refractGain },
      },
    ]),
    // Values, not bare defines, and tested with `#if` rather than `#ifdef`:
    // a define of 0 is still *defined*, so `#ifdef` would take the refraction
    // branch at the quality level that has no refraction pass to take it
    // from, and the water would sample a depth texture that was never filled.
    defines: { USE_REFRACTION: 0, USE_REFLECTION: 0 },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
  // UniformsUtils.merge clones what it is given, which would hand each
  // material its own private copy of the shared ones — and then the sea, the
  // reflection and the underwater pass would all be running off different
  // clocks. Re-point them at the originals afterwards.
  Object.assign(material.uniforms, waterUniforms);
  material.uniforms.uMap.value = map;
  return material;
}

export { ABSORB, SCATTER_COLOR, SHALLOW_COLOR, FOAM_DEPTH, REFRACT_STRENGTH };
