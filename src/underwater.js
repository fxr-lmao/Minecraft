// The composite pass, which is also the underwater one.
//
// Above the surface this shader does nothing but copy the refraction target to
// the screen. That is not a waste — the copy is what lets the water surface be
// drawn afterwards as the only geometry in its pass, testing itself against a
// depth texture rather than against a depth buffer it would have had to
// re-rasterise the whole world to fill.
//
// Below the surface it earns its place. Being underwater is not "the same
// picture with blue fog on it": light is absorbed by colour, so red goes
// first and everything distant turns the same deep blue-green whatever it
// started as; the surface above focuses light into a moving net across
// everything, not just the floor; and where the sun gets through, it comes
// down in shafts.
//
// All three want the world position of every pixel, which is exactly what a
// depth buffer plus an inverse projection gives you — so all three are one
// fullscreen pass over data pass 1 already produced.

import * as THREE from '../vendor/three.module.min.js';
import { CAUSTIC_GLSL } from './water-glsl.js';

/**
 * Beer-Lambert absorption for sea water, per block travelled, per channel.
 * Red is absorbed roughly an order of magnitude faster than blue, which is
 * the entire reason the sea is blue and the entire reason a red block twenty
 * blocks away underwater is grey.
 */
const ABSORB = new THREE.Vector3(0.36, 0.09, 0.045);

/** What the water scatters back at you, which is what "far away" looks like. */
const SCATTER = 0x1a5f86;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${CAUSTIC_GLSL}

uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uUnder;
uniform float uTime;
uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uAbsorb;
uniform vec3 uScatter;
uniform float uSurfaceY;

varying vec2 vUv;

#include <packing>

/** Distance from the eye to whatever is at this pixel, in blocks. */
float sceneDistance(vec2 uv, out bool sky) {
  float raw = texture2D(uDepth, uv).x;
  sky = raw >= 0.9999;
  float viewZ = perspectiveDepthToViewZ(raw, uCameraNear, uCameraFar);
  return -viewZ;
}

/** The direction this pixel looks along, in world space. */
vec3 rayDirection(vec2 uv) {
  vec4 clip = vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec4 view = uInverseProjection * clip;
  view /= view.w;
  return normalize((uCameraMatrix * vec4(view.xyz, 0.0)).xyz);
}

void main() {
  if (uUnder < 0.5) {
    // Above water this is a straight copy. The sRGB decode on the way in and
    // the encode on the way out cancel exactly, so the pixels that reach the
    // screen are the pixels pass 1 produced.
    gl_FragColor = texture2D(uScene, vUv);
    #include <colorspace_fragment>
    return;
  }

  vec3 color = texture2D(uScene, vUv).rgb;
  bool sky;
  float dist = sceneDistance(vUv, sky);
  vec3 dir = rayDirection(vUv);

  // How far the light actually travelled through water: down from the
  // surface to whatever it hit, and then back out to the eye. Counting only
  // the second leg leaves a sea floor ten blocks down as brightly lit as one
  // just under the surface, which is the difference between being underwater
  // and having a blue filter over the screen.
  vec3 hitPoint = uCameraPos + dir * dist;
  float sink = sky ? 40.0 : max(uSurfaceY - hitPoint.y, 0.0);
  float travel = min((sky ? 70.0 : dist) + sink * 1.15, 95.0);

  // Caustics land on whatever the light reached, which underwater is
  // everything the sun can still see. Fade them out with how far below the
  // surface the lit point is, and with how far away it is from you: at
  // twenty blocks the water between you and it has scattered the pattern
  // into a haze and there is nothing left to resolve.
  if (!sky) {
    float reach = exp(-sink * 0.14) * exp(-dist * 0.05);
    float lines = caustic(hitPoint.xz * 1.7, uTime);
    color += vec3(0.55, 1.0, 0.92) * lines * reach * 0.55;
  }

  // Absorption. Per channel, exponential in the distance travelled — the one
  // formula that turns "a blue filter over the screen" into water.
  vec3 transmit = exp(-uAbsorb * travel);
  color = color * transmit + uScatter * (1.0 - transmit);

  // Shafts. Where you are looking within a few degrees of the sun, the light
  // coming down through the surface picks out its own path in the suspended
  // silt. Banded by a slow ripple so they move rather than sit there.
  float toSun = max(dot(dir, uSunDir), 0.0);
  if (toSun > 0.5) {
    float shaft = pow(toSun, 14.0);
    float bands = 0.55 + 0.45 * sin(dir.x * 22.0 + uTime * 0.7)
                              * sin(dir.z * 17.0 - uTime * 0.5);
    float depthFade = exp(-max(uSurfaceY - uCameraPos.y, 0.0) * 0.09);
    color += vec3(0.55, 0.82, 0.95) * shaft * bands * depthFade * 0.5;
  }

  // A vignette, because your eyes do not have a rectangular field of view and
  // underwater is the one place the game is dark enough to notice.
  vec2 v = vUv - 0.5;
  color *= 1.0 - dot(v, v) * 0.55;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * The composite material. One instance, owned by the WaterView; the caller
 * fills in the scene and depth textures each frame.
 */
export function createUnderwaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScene: { value: null },
      uDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 1000 },
      uUnder: { value: 0 },
      uTime: { value: 0 },
      uInverseProjection: { value: new THREE.Matrix4() },
      uCameraMatrix: { value: new THREE.Matrix4() },
      uCameraPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uAbsorb: { value: ABSORB.clone() },
      uScatter: { value: new THREE.Color(SCATTER) },
      uSurfaceY: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
}

export { ABSORB, SCATTER };
