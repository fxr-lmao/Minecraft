// The module graph, walked end to end.
//
// Most regressions in this codebase fail silently: a renamed export still
// parses, and the first anyone knows about it is the page throwing at load.
// This test imports every module in src/ (except main.js, which is the DOM
// entry point and binds listeners at import time) under a canvas/DOM stub,
// so a typo in an export chain breaks the build before a browser can.
//
// The stubs paint nothing; they exist so the texture, model and UI modules
// can construct. What matters is that every import resolves and every
// module-level statement runs.

class Ctx {
  constructor() {
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.globalAlpha = 1;
    this.lineWidth = 1;
    this.font = '';
    this.imageSmoothingEnabled = true;
  }
  fillRect() {} strokeRect() {} clearRect() {}
  beginPath() {} closePath() {}
  moveTo() {} lineTo() {} arc() {} fill() {} stroke() {}
  save() {} restore() {} translate() {} rotate() {} scale() {}
  setTransform() {} resetTransform() {} transform() {}
  setLineDash() {} getLineDash() { return []; }
  clip() {} rect() {} quadraticCurveTo() {} bezierCurveTo() {} ellipse() {} arcTo() {}
  measureText() { return { width: 0 }; }
  createPattern() { return null; }
  drawImage() {} fillText() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  getImageData(x, y, w = 1, h = 1) {
    return { data: new Uint8ClampedArray(4 * w * h), width: w, height: h };
  }
  createImageData(w = 1, h = 1) {
    return { data: new Uint8ClampedArray(4 * w * h), width: w, height: h };
  }
  putImageData() {}
}
class Canvas {
  constructor() {
    this.width = 16;
    this.height = 16;
    this._ctx = new Ctx();
  }
  getContext() { return this._ctx; }
  toDataURL() { return 'data:image/png;base64,AAAA'; }
}

globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? new Canvas() : {}),
  createElementNS: (ns, tag) => (tag === 'canvas' ? new Canvas() : {}),
  getElementById: () => null,
  addEventListener() {},
  body: { appendChild() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  matchMedia: () => ({ matches: false, addListener() {} }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', maxTouchPoints: 0 },
  configurable: true,
});
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0;

const results = [];
const assert = (name, cond, detail) =>
  results.push([name, Boolean(cond), detail !== undefined ? String(detail) : '']);

const fs = await import('node:fs');
const files = fs.readdirSync(new URL('../src/', import.meta.url).pathname)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => f !== 'main.js'); // the DOM entry; see the header comment

for (const file of files) {
  try {
    await import(`../src/${file}`);
    assert(`imports: ${file}`, true);
  } catch (e) {
    assert(`imports: ${file}`, false, e.message.split('\n')[0]);
  }
}

for (const [name, ok, detail] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
