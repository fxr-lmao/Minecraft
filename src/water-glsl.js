// The GLSL that more than one water pass needs.
//
// Kept in one place because the alternative is two copies that drift: the
// surface displaces vertices with the swell and shades them with its
// derivative, and if those two ever came from different code the highlights
// would slide off the waves. The same goes for caustics, which the surface
// casts onto whatever is behind it and the underwater pass casts onto
// everything — one function, or the two disagree at the waterline.

/**
 * The swell, and the ripples on it.
 *
 * Every term is evaluated at a *world* position, and that is the whole trick
 * behind seamless chunks: two meshes that meet at x = 32 both evaluate
 * sin(32 · k) and get the same answer, so the surface is continuous across a
 * border neither of them knows about.
 */
export const SWELL_GLSL = /* glsl */ `
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
// across, so anything with a wavelength under a metre would only alias. They
// tilt the normal, which at this scale is all the eye reads anyway.
void ripples(vec2 p, float t, inout vec2 g) {
  float h = 0.0;
  swellTerm(p, t, vec2( 0.316,  0.949),  6.1, 0.0026, 3.7, h, g);
  swellTerm(p, t, vec2(-0.800,  0.600),  8.9, 0.0016, 4.6, h, g);
  swellTerm(p, t, vec2( 0.970, -0.243), 13.1, 0.0009, 6.1, h, g);
}
`;

/**
 * Caustics: the moving net of light the surface focuses onto whatever is
 * under it.
 *
 * The obvious cheap version is one ridged field — `1 - |sum of sines|`,
 * sharpened — and it is not good enough. A single field's bright contours are
 * long parallel worms, and worms painted on sand look like graffiti, which is
 * exactly what the first attempt looked like. Real caustics are a *network*:
 * lines that cross, with bright knots where they meet.
 *
 * So it is two ridged fields at different scales, multiplied. A pixel is
 * bright only where both are, which turns the worms into cells. Everything is
 * a function of position times a frequency, with no dependence on distance
 * from the origin, so the pattern is the same size at x = 5 and at x = 5000 —
 * which the usual iterated-distortion caustic shaders are not, and a voxel
 * world with coordinates in the thousands notices.
 */
export const CAUSTIC_GLSL = /* glsl */ `
float causticRidge(vec2 p, float t, float k) {
  float a = sin((p.x * 1.31 + p.y * 0.72) * k + t * 1.70)
          + sin((p.x * -0.83 + p.y * 1.19) * k - t * 1.30)
          + sin((p.x * 0.41 - p.y * 1.44) * k + t * 2.10);
  return clamp(1.0 - abs(a) * 0.42, 0.0, 1.0);
}

float caustic(vec2 p, float t) {
  float a = causticRidge(p, t, 1.0);
  float b = causticRidge(p + vec2(13.7, 5.1), t * 1.23, 1.9);
  return pow(a * b, 5.0);
}
`;

/**
 * The sky along a direction, matching the dome in sky.js so that a reflection
 * of "no geometry" agrees with the sky you can see above it. Used as the
 * fallback whenever there is no reflection pass — at the lowest quality
 * setting, or for a pond at a height the mirrored camera was not aimed at.
 */
export const SKY_GLSL = /* glsl */ `
vec3 skyAlong(vec3 dir, vec3 sunDir, vec3 sunColor, vec3 top, vec3 horizon) {
  float up = clamp(dir.y * 1.6 + 0.05, 0.0, 1.0);
  vec3 c = mix(horizon, top, up);
  float s = max(dot(dir, sunDir), 0.0);
  c += sunColor * pow(s, 420.0) * 6.0;  // the disc, glittering on the crests
  c += sunColor * pow(s, 20.0) * 0.14;  // the haze around it
  return c;
}
`;
