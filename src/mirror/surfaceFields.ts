import { DataTexture, FloatType, LinearFilter, LinearMipmapLinearFilter, RGBAFormat } from 'three';
import { MIRROR } from './spec';

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t);
};
function hash(x: number, y: number) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const u = smooth(0, 1, x - ix), v = smooth(0, 1, y - iy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + ((c - a) + (a - b - c + d) * u) * v;
}
function fbm(x: number, y: number) {
  return noise(x, y) * .57 + noise(x * 2.03 + 19, y * 2.03 - 8) * .28
    + noise(x * 4.09 - 11, y * 4.09 + 23) * .15;
}

/** Stationary material fields in metres. Silver loss, roughness and shallow
 * relief are independent channels; glass has its own normals and thickness.
 * Generated once, not evaluated as screen-space noise on every video frame. */
export function createSurfaceFields(width = 768, height = 1024) {
  const size = width * height;
  const rear = new Uint8Array(size * 4);
  const front = new Float32Array(size * 4);
  const heights = new Float32Array(size);
  const scratches = new Float32Array(size);
  const dx = MIRROR.width / (width - 1), dy = MIRROR.height / (height - 1);
  for (let y = 0; y < height; y++) {
    const py = y * dy - MIRROR.height / 2;
    for (let x = 0; x < width; x++) {
      const px = x * dx - MIRROR.width / 2, i = y * width + x;
      const u = px / (MIRROR.width / 2), v = py / (MIRROR.height / 2);
      const radius = Math.hypot(u, v);
      const normalLength = Math.hypot(px / (MIRROR.width / 2) ** 2, py / (MIRROR.height / 2) ** 2);
      const rim = radius < .0001 ? MIRROR.width / 2 : Math.max(0, radius * (1 - radius) / normalLength);
      // Unequal ingress fronts, with smaller branching along their margins.
      const wetCorner = Math.exp(-((u + .55) ** 2 / .16 + (v + .70) ** 2 / .12))
        + .8 * Math.exp(-((u - .65) ** 2 / .12 + (v - .50) ** 2 / .16));
      const warpX = px + (noise(px * 93 + 17, py * 93) - .5) * .003;
      const warpY = py + (noise(px * 93, py * 93 - 29) - .5) * .003;
      const frontNoise = fbm(warpX * 680, warpY * 680);
      const ingress = smooth(.28, .62, fbm(px * 80 + 4, py * 80 - 11));
      const reach = (.0008 + .004 * wetCorner + .0027 * fbm(px * 160 + 12, py * 160) ** 2) * (.3 + .7 * ingress);
      const corrosionFront = rim - reach + (frontNoise - .5) * .0028;
      const edgeLoss = (1 - smooth(-dx * .7, dx * .7, corrosionFront)) * (.12 + .88 * ingress);
      // Interior pits are sparse, sub-millimetre clusters, not large soft blobs.
      const pitField = noise(warpX * 2200 + 51, warpY * 2200 - 14);
      const pitThreshold = .94 - wetCorner * .095;
      const pits = smooth(pitThreshold, pitThreshold + .035, pitField)
        * smooth(.43, .67, fbm(px * 240 - 7, py * 240 + 29));
      const loss = Math.max(edgeLoss, pits);
      const halo = Math.exp(-Math.max(0, corrosionFront) / .0018);
      const mottling = fbm(warpX * 310 - 9, warpY * 310 + 16);
      const tarnish = clamp(halo * .78 + wetCorner * .20 + smooth(.34, .76, mottling) * .16);
      const roughness = .028 + .17 * tarnish + .04 * fbm(px * 850, py * 850);
      rear[i * 4] = Math.round(loss * 255);
      rear[i * 4 + 1] = Math.round(tarnish * 255);
      rear[i * 4 + 2] = Math.round(roughness * 255);
      rear[i * 4 + 3] = Math.round(fbm(px * 550 + 4, py * 550 - 6) * 255);
      heights[i] = (fbm(px * 75, py * 75) - .5) * .000004;
      // Smooth thickness variation changes both refraction path and absorption.
      front[i * 4 + 3] = (fbm(px * 38 + 19, py * 38) - .5) * .00012;
    }
  }
  // Finite, shallow abrasions with different lengths/directions, written into
  // the front glass height field. Their lighting comes from changed normals.
  for (let s = 0; s < 105; s++) {
    const angle = -.65 + hash(s, 17) * 1.4;
    const cx = (hash(s, 19) - .5) * MIRROR.width * 1.7;
    const cy = (hash(s, 23) - .5) * MIRROR.height * 1.8;
    const length = .0015 + hash(s, 29) ** 3 * .026;
    const steps = Math.ceil(length / Math.min(dx, dy) * 1.5);
    for (let t = 0; t <= steps; t++) {
      const along = t / steps - .5;
      const px = cx + along * length * Math.cos(angle);
      const py = cy + along * length * Math.sin(angle) + along ** 2 * length * .1;
      const ix = Math.round((px + MIRROR.width / 2) / dx), iy = Math.round((py + MIRROR.height / 2) / dy);
      const strength = Math.sin(Math.PI * t / steps) * (.35 + hash(s, 31) * .65);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const x = ix + ox, y = iy + oy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const weight = Math.exp(-(ox * ox + oy * oy) * 1.7) * strength;
        scratches[y * width + x] = Math.max(scratches[y * width + x], weight);
      }
    }
  }
  for (let i = 0; i < size; i++) heights[i] -= scratches[i] * .0000008;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    front[i * 4] = (heights[y * width + Math.min(width - 1, x + 1)] - heights[y * width + Math.max(0, x - 1)]) / (2 * dx);
    front[i * 4 + 1] = (heights[Math.min(height - 1, y + 1) * width + x] - heights[Math.max(0, y - 1) * width + x]) / (2 * dy);
    front[i * 4 + 2] = .008 + scratches[i] * .22;
  }
  const backing = new DataTexture(rear, width, height);
  const glass = new DataTexture(front, width, height, RGBAFormat, FloatType);
  for (const texture of [backing, glass]) {
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  return { backing, glass, width, height };
}
