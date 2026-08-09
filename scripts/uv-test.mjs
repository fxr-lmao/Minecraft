// Validate the shared face table used by the mesher:
// correct winding (cross product == face normal) and UVs inside the right
// atlas column.
import { FACES } from '../src/blocks.js';

const names = ['+x', '-x', '+y', '-y', '+z', '-z'];
let ok = true;

FACES.forEach((f, i) => {
  // winding: cross(v1 - v0, v2 - v0) must equal the face normal
  const a = [f.v[1][0] - f.v[0][0], f.v[1][1] - f.v[0][1], f.v[1][2] - f.v[0][2]];
  const b = [f.v[2][0] - f.v[0][0], f.v[2][1] - f.v[0][1], f.v[2][2] - f.v[0][2]];
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const okN = cross.every((c, k) => Math.abs(c - f.n[k]) < 1e-6);

  // UVs must span the full 0..1 column range, mapped to column col/3
  const okU =
    Math.abs(f.uv[0][0]) < 1e-6 &&
    Math.abs(f.uv[2][0] - 1) < 1e-6 &&
    f.col >= 0 &&
    f.col <= 2;

  const pass = okN && okU;
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  face ${names[i]}  winding=${okN}  uv-col=${okU} (col ${f.col})`);
});

console.log(ok ? 'Face table OK' : 'Face table BROKEN');
process.exit(ok ? 0 : 1);
