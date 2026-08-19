// Daytime sky: gradient dome, sun sprite, drifting pixel clouds.
// No time cycle yet — a static pleasant midday.

import * as THREE from '../vendor/three.module.min.js';
import { mulberry32 } from './utils.js';

export const SKY_TOP = 0x6eb5ff;
export const SKY_HORIZON = 0xd9ecff;
export const FOG_COLOR = 0xd9ecff;

function makeSkyDomeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#5f9fe8');
  g.addColorStop(0.45, '#8ec3f5');
  g.addColorStop(0.75, '#c9e6ff');
  g.addColorStop(1.0, '#d9ecff'); // matches FOG_COLOR so terrain fades into the sky
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSunTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0.0, 'rgba(255,255,240,1)');
  g.addColorStop(0.25, 'rgba(255,250,210,0.95)');
  g.addColorStop(0.55, 'rgba(255,244,180,0.35)');
  g.addColorStop(1.0, 'rgba(255,244,180,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCloudTexture() {
  const rand = mulberry32(2024);
  const cv = document.createElement('canvas');
  const S = 256;
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  // big soft blobs
  for (let i = 0; i < 46; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 14 + rand() * 34;
    const a = 0.12 + rand() * 0.2;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createSky(scene) {
  // gradient dome
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(600, 24, 12),
    new THREE.MeshBasicMaterial({
      map: makeSkyDomeTexture(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
  );
  dome.renderOrder = -10;
  scene.add(dome);

  // sun
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSunTexture(),
      fog: false,
      depthWrite: false,
      transparent: true,
    })
  );
  sun.scale.setScalar(90);
  sun.position.set(-420, 260, -260);
  scene.add(sun);

  // clouds
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: 0.85,
    })
  );
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 210;
  scene.add(clouds);

  const domeTint = new THREE.Color(0xffffff);
  const cloudTint = new THREE.Color(0xffffff);
  /** How overcast it is, kept because the cloud drift wants it too. */
  let overcast = 0;

  return {
    /** Hidden while the camera is under water — down there you see fog. */
    setVisible(on) {
      dome.visible = on;
      sun.visible = on;
      clouds.visible = on;
    },
    /**
     * How overcast it is, 0 to 1, which is the weather's intensity.
     *
     * The sky is not repainted — the dome, the clouds and the sun are all
     * multiplied down toward a flat grey, which is what an overcast sky
     * actually is: the same sky with the light taken out of it. The sun goes
     * first and fastest, because a sun you can still see through rain is the
     * one thing that gives the whole effect away.
     */
    setOvercast(level) {
      const l = Math.max(0, Math.min(1, level));
      overcast = l;
      domeTint.setRGB(1 - l * 0.52, 1 - l * 0.47, 1 - l * 0.38);
      dome.material.color.copy(domeTint);
      sun.material.opacity = Math.max(0, 1 - l * 1.6);
      cloudTint.setRGB(1 - l * 0.45, 1 - l * 0.43, 1 - l * 0.38);
      clouds.material.color.copy(cloudTint);
      clouds.material.opacity = 0.85 + l * 0.15;
    },
    update(_dt, playerPos) {
      dome.position.copy(playerPos);
      sun.position.set(playerPos.x - 420, 260, playerPos.z - 260);
      clouds.position.x = playerPos.x;
      clouds.position.z = playerPos.z;
      // Weather moves, so the cloud deck moves with it.
      const wind = 1 + overcast * 2.2;
      cloudTex.offset.x += _dt * 0.0022 * wind;
      cloudTex.offset.y += _dt * 0.0008 * wind;
    },
  };
}
