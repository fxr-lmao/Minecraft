// How water *looks*, which is a completely different problem from where it is.
//
// water-mesh.js already solved the geometry: the surface is a continuous
// sheet whose height lives at the corners, so a stream slopes instead of
// stepping. That fixed the thing that was visibly broken. It did not make
// water look like water, because a flat Lambert-shaded translucent blue quad
// never will — the material was missing every single thing the eye actually
// uses to recognise water:
//
//   * Fresnel. Water is nearly clear when you look straight down into it and
//     nearly a mirror when you look across it. This one term is most of the
//     difference between "blue glass" and "a lake". Everything else here is
//     decoration next to it.
//   * A moving surface. Not a scrolling texture — actual displacement, from
//     four crossing swells summed in *world* space so neighbouring chunks
//     agree along their shared edge without having to be told about each
//     other. The normal comes from the analytic derivative of the same sum,
//     so the shading and the shape can never disagree.
//   * Depth. Shallow water over sand is pale and green; six blocks of it is
//     dark blue. The mesher measures how much water is under each corner and
//     hands it over as a vertex attribute.
//   * A shoreline. Foam where the sheet meets land, on the crests of the
//     swell, and wherever the current is churning.
//   * Snell's window. Looking up from underwater, the whole sky is squeezed
//     into a 97° cone and everything outside it is a mirror of the depths.
//     It costs one smoothstep and it is the single most convincing thing you
//     can do to an underwater shot.
//   * Caustics. The moving net of light on the sea floor, which is not on the
//     water at all — it is on the terrain, and it is why the chunk material
//     gets patched too.
//
// All of it is procedural: no cubemaps, no render targets, no second pass, no
// build step. The whole thing is arithmetic in the fragment shader, which is
// the only kind of "expensive" an iPad is actually good at.

import * as THREE from '../vendor/three.module.min.js';
import { SKY_TOP, SKY_HORIZON } from './sky.js';
import { SEA_LEVEL } from './terrain.js';

/** Deep open water. */
const DEEP_COLOR = 0x0a2f5e;
/** A hand's depth over sand. */
const SHALLOW_COLOR = 0x3fb2c9;
/** Broken water. Not pure white — that reads as snow. */
const FOAM_COLOR = 0xe4f2ff;
/** Matches the directional light in main.js. */
const SUN_COLOR = 0xfff2d9;

/**
 * Uniforms shared by every water surface *and* by the terrain underneath it,
 * so the caustics on the sea floor move with the swell above them rather than
 * drifting out of step with it.
 */
export const waterUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.48, 0.8, 0.32).normalize() },
  uSunColor: { value: new THREE.Color(SUN_COLOR) },
  uSkyTop: { value: new THREE.Color(SKY_TOP) },
  uSkyHorizon: { value: new THREE.Color(SKY_HORIZON) },
  uShallow: { value: new THREE.Color(SHALLOW_COLOR) },
  uDeep: { value: new THREE.Color(DEEP_COLOR) },
  uFoam: { value: new THREE.Color(FOAM_COLOR) },
  /** 1 while the camera itself is under the surface. */
  uUnder: { value: 0 },
  /** Where the sea sits, so caustics can fade with depth. */
  uSeaLevel: { value: SEA_LEVEL },
};

/** Seconds of game time. Paused means the sea stops, like everything else. */
export function advanceWaterTime(dt) {
  // Wrapped well away from the point where a float32 stops being able to
  // resolve a frame: the swell has periods of a few seconds, and 3600 is a
  // whole number of none of them, but the discontinuity is a phase jump in a
  // sine — invisible, and once an hour.
  waterUniforms.uTime.value = (waterUniforms.uTime.value + dt) % 3600;
}

/** Tell the water where the camera is, relative to its own surface. */
export function setCameraUnderwater(under) {
  waterUniforms.uUnder.value = under ? 1 : 0;
}

/** Point the specular highlight at wherever main.js put the sun. */
export function setSunDirection(x, y, z) {
  waterUniforms.uSunDir.value.set(x, y, z).normalize();
}

// ------------------------------------------------------------------- GLSL

/**
 * The swell, and the ripples on it. Shared verbatim by the vertex shader
 * (which moves the surface) and the fragment shader (which shades it) — if
 * these two ever disagreed the highlights would slide off the waves.
 *
 * Every term is evaluated at a *world* position. That is the whole trick
 * behind seamless chunks: two meshes that meet at x = 32 both evaluate
 * sin(32 · k) and get the same answer, so the surface is continuous across a
 * border nobody had to think about.
 */
const SWELL_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWaveScale;

// One sine, accumulating both its height and its gradient. The gradient is
// what the normal is built from, so it has to come from the same sine as the
// displacement rather than from a second, prettier function.
void swellTerm(vec2 p, float t, vec2 dir, float freq, float amp, float speed,
               inout float h, inout vec2 g) {
  float phase = dot(p, dir) * freq + t * speed;
  h += sin(phase) * amp;
  g += dir * (cos(phase) * amp * freq);
}

// Four crossing swells: one long and slow, three shorter and faster, none of
// their wavelengths a multiple of another so the pattern never visibly
// repeats. Total amplitude 0.054 of a block — water sits at 8/9 of a block,
// so a crest still has room under the block above it.
void swell(vec2 p, float t, out float h, out vec2 g) {
  h = 0.0;
  g = vec2(0.0);
  swellTerm(p, t, vec2( 0.862,  0.507), 0.86, 0.0260, 1.05, h, g);
  swellTerm(p, t, vec2(-0.423,  0.906), 1.53, 0.0155, 1.55, h, g);
  swellTerm(p, t, vec2( 0.629, -0.777), 2.41, 0.0080, 2.20, h, g);
  swellTerm(p, t, vec2(-0.951, -0.309), 3.70, 0.0042, 2.95, h, g);
}

// Ripples too small to be worth moving a vertex for: a block is four vertices
// across, so anything with a wavelength under a metre would just alias. They
// only tilt the normal, which at this scale is all the eye reads anyway.
void ripples(vec2 p, float t, inout vec2 g) {
  float h = 0.0;
  swellTerm(p, t, vec2( 0.316,  0.949),  6.1, 0.0026, 3.7, h, g);
  swellTerm(p, t, vec2(-0.800,  0.600),  8.9, 0.0016, 4.6, h, g);
  swellTerm(p, t, vec2( 0.970, -0.243), 13.1, 0.0009, 6.1, h, g);
}
`;

/**
 * Caustics. Two pairs of interfering waves, folded at zero and sharpened —
 * the classic cheap approximation, and a good one, because what the eye wants
 * from caustics is a moving net of bright thin lines and that is exactly what
 * |sin + sin| gives you once you raise it to a power.
 *
 * Shared with the terrain shader, which is the only place they are really
 * seen: light focused by the surface lands on the sea floor, not on the water.
 */
const CAUSTIC_GLSL = /* glsl */ `
float caustic(vec2 p, float t) {
  float a = sin(p.x * 2.3 + t * 1.7) + sin(p.y * 2.9 - t * 1.3);
  float b = sin((p.x + p.y) * 1.9 + t * 2.1) + sin((p.x - p.y) * 2.5 - t * 1.1);
  float v = 1.0 - abs(a + b) * 0.25;
  return pow(clamp(v, 0.0, 1.0), 14.0);
}
`;

const WATER_VERTEX = /* glsl */ `
${SWELL_GLSL}

// depth (0..1 over eight blocks), shore (0..1), wave amplitude, churn.
// Packed by the mesher; see water-mesh.js.
attribute vec4 wdata;

varying vec3 vWorld;
varying vec3 vGeom;
varying vec2 vTexture;
varying vec4 vData;
varying float vCrest;

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
  gl_Position = projectionMatrix * mv;
}
`;

const WATER_FRAGMENT = /* glsl */ `
${SWELL_GLSL}
${CAUSTIC_GLSL}

uniform sampler2D uMap;
uniform vec2 uScroll;
uniform float uPatternGain;
uniform float uOpacity;
uniform float uNormalGain;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uUnder;

varying vec3 vWorld;
varying vec3 vGeom;
varying vec2 vTexture;
varying vec4 vData;
varying float vCrest;

// Tone mapping and colour space are already in the prefix three puts on every
// fragment shader, so only the fog needs declaring.
#include <fog_pars_fragment>

/**
 * The sky along a direction — the same gradient the dome in sky.js draws, so
 * a reflection matches what is actually up there, plus the sun itself. There
 * is no cubemap and there does not need to be one: the sky is a vertical
 * gradient and a disc, and both are cheaper to evaluate than to sample.
 */
vec3 skyAlong(vec3 dir) {
  float up = clamp(dir.y * 1.6 + 0.05, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, up);
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * pow(s, 420.0) * 6.0;  // the disc, glittering on the crests
  c += uSunColor * pow(s, 20.0) * 0.14;  // the haze around it
  return c;
}

void main() {
  bool top = vGeom.y > 0.5;
  vec3 V = normalize(cameraPosition - vWorld);

  // The normal. On the surface it comes from the derivative of the same swell
  // that displaced the vertex, plus the fine ripples, evaluated per pixel —
  // so the highlights are as detailed as the maths rather than as coarse as
  // the mesh. Walls of a waterfall keep their flat geometric normal.
  vec3 N = normalize(vGeom);
  if (top) {
    float h = 0.0;
    vec2 g = vec2(0.0);
    swell(vWorld.xz, uTime, h, g);
    ripples(vWorld.xz, uTime, g);
    N = normalize(vec3(-g.x, 1.0, -g.y) * vec3(uNormalGain, 1.0, uNormalGain));
  }

  // The pixel tile is still in here, as a brightness ripple rather than as the
  // colour itself. That is deliberate: this is a Minecraft clone, and the
  // hand-drawn 16x16 pattern scrolling across the surface is a good part of
  // why the sea reads as *this* game's sea and not as some other engine's.
  float pattern = texture2D(uMap, vTexture + uScroll).r * 2.0 - 1.0;

  float depth = vData.x;
  float shore = vData.y;
  float churn = vData.w;

  // Colour by how much water you are looking through. Sand under a foot of it
  // stays visible and green-blue; six blocks of it goes navy.
  vec3 body = mix(uShallow, uDeep, depth) * (1.0 + pattern * uPatternGain);

  // And *hide* by the same measure. Without a copy of the frame behind it
  // there is no way to actually absorb the light coming through the water, so
  // depth buys opacity instead: a foot of it is a pane of tinted glass over
  // the sand, six blocks of it is not. This is the cue that reads as depth
  // from the shore, and it does most of the work of a refraction pass for
  // none of the cost.
  float clarity = clamp(uOpacity * mix(0.55, 1.30, depth), 0.0, 0.96);

  // Fresnel. Straight down: 2% reflective, you see the bottom. Along the
  // surface: a mirror. Nothing else in this shader matters as much.
  float f = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  float fresnel = clamp(0.02 + 0.98 * f, 0.0, 1.0);

  vec3 color;
  float alpha;

  // Which side of the surface the camera is on. gl_FrontFacing would be the
  // obvious test and it is the wrong one: at the horizon the view is within a
  // degree of grazing, the swell tilts the odd quad past that, and those few
  // quads flip to the underwater branch and paint a black stripe across the
  // sea. Comparing heights cannot flip.
  bool fromAbove = !top || cameraPosition.y >= vWorld.y;

  if (fromAbove) {
    vec3 reflected = reflect(-V, N);
    // Never quite as bright as the sky it is reflecting: some of that light
    // went into the water instead of bouncing off it, and a sea brighter than
    // the sky above it is the thing that makes cheap water look like foil.
    vec3 sky = skyAlong(reflected) * 0.86;

    // The glitter: a tight lobe for the sun's own reflection and a broad one
    // for the sheen around it.
    vec3 half3 = normalize(V + uSunDir);
    float ndh = max(dot(N, half3), 0.0);
    float spec = pow(ndh, 300.0) * 3.4 + pow(ndh, 26.0) * 0.11;

    // Under water there is no sky to reflect, so the mirror term is mostly
    // turned off and what is left is the body of the water itself.
    float mirror = fresnel * 0.92 * (1.0 - uUnder * 0.62);
    color = mix(body, sky, mirror);
    color += uSunColor * spec * (1.0 - uUnder * 0.85);
    alpha = mix(clarity, 0.96, mirror);
  } else {
    // Seen from below. Refraction squeezes the entire sky into a cone 97°
    // wide — Snell's window — and outside it the surface is a mirror looking
    // back down into the dark. The boundary is at cos(48.6°) = 0.66.
    float lift = clamp(abs(V.y), 0.0, 1.0);
    float window = smoothstep(0.54, 0.78, lift);
    vec3 above = skyAlong(vec3(V.x, abs(V.y), V.z)) * 0.92;
    color = mix(uDeep * 0.7, above, window);
    color += uSunColor * caustic(vWorld.xz * 1.4, uTime) * 0.22 * (1.0 - window);
    alpha = mix(0.94, 0.5, window);
  }

  // Foam. Three sources: the shore, where the sheet thins out against land;
  // the crests of the swell, but only near the shore, because open water does
  // not break; and churn, which the mesher sets on anything falling or
  // running fast. The mottle keeps it from looking like a drawn outline.
  float mottle = 0.55 + 0.45 * sin(vWorld.x * 2.7 + vWorld.z * 3.4 + uTime * 1.6)
                      * (0.6 + 0.4 * sin(vWorld.z * 1.3 - vWorld.x * 0.9 - uTime * 1.1));
  float foam = top
    ? smoothstep(0.05, 0.45, shore) * (0.40 + 0.60 * smoothstep(-0.4, 0.9, vCrest)) + churn * 0.34
    : churn * 0.50;
  foam = clamp(foam * mottle * 1.7, 0.0, 1.0);
  color = mix(color, uFoam, foam * 0.9);
  alpha = mix(alpha, 0.97, foam);

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * One water material. Still and flowing water get one each: they are different
 * textures scrolling at different speeds, and moving water is not allowed to
 * swell (a stream running down a hillside does not have waves on it).
 */
export function createWaterMaterial({ map, waveScale, patternGain, opacity, normalGain }) {
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
      },
    ]),
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
  // UniformsUtils.merge clones what it is given, which would hand each
  // material its own private copy of the shared ones — and then the sea and
  // the sea floor would be running off two different clocks. Re-point them at
  // the originals afterwards.
  Object.assign(material.uniforms, waterUniforms);
  material.uniforms.uMap.value = map;
  return material;
}

/**
 * Caustics on the sea floor, painted into the chunk material.
 *
 * Light bent by the surface converges into bright moving lines on whatever is
 * underneath, and since the sea floor is ordinary terrain, that has to happen
 * in the terrain's shader rather than the water's. Three lets a stock material
 * be patched on its way to the compiler, so the Lambert shading everything
 * else relies on stays exactly as it was.
 *
 * The `wet` attribute is what keeps this honest: the mesher sets it on faces
 * whose exposed side is actually water, so caustics appear on the sea floor
 * and on the walls of a flooded trench, and never in a dry cave that happens
 * to be below sea level.
 */
export function applyWaterCaustics(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uSunColor = waterUniforms.uSunColor;
    shader.uniforms.uSeaLevel = waterUniforms.uSeaLevel;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float wet;
        varying vec3 vWetWorld;
        varying float vWet;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vWetWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWet = wet;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uSunColor;
        uniform float uSeaLevel;
        varying vec3 vWetWorld;
        varying float vWet;
        ${CAUSTIC_GLSL}`
      )
      .replace(
        '#include <tonemapping_fragment>',
        `if (vWet > 0.01) {
          // Dimmer the deeper it is, because less light gets down there —
          // and never brighter than the surface that focused it.
          float below = max(uSeaLevel - vWetWorld.y, 0.0);
          float reach = 0.30 + 0.70 * exp(-below * 0.16);
          float lines = caustic(vWetWorld.xz * 1.6, uTime);
          // Sunlight that has been through several metres of sea arrives
          // green, so the net is not white — white on sand reads as marble.
          gl_FragColor.rgb += uSunColor * vec3(0.62, 1.0, 0.94)
            * lines * vWet * reach * 0.5;
        }
        #include <tonemapping_fragment>`
      );
  };
  // Without this every mesh sharing the material would still share one
  // compiled program, but three has no way to know the patch changed — the
  // cache key makes the patched program distinct from a stock Lambert one.
  material.customProgramCacheKey = () => 'water-caustics-v1';
  return material;
}
