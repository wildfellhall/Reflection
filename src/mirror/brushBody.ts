import * as T from 'three';

// A single longitudinal casting: the oval's shoulder continues through the
// throat, waist and palm end. No intersecting head/handle caps at the junction.
const profile = [
  [[0, -.096], [.0045, -.096], [.0083, -.091], [.0083, -.085]],
  [[.0083, -.085], [.0083, -.073], [.0048, -.064], [.0048, -.050]],
  [[.0048, -.050], [.0048, -.035], [.0045, -.025], [.0105, -.016]],
  [[.0105, -.016], [.0165, -.007], [.027, .001], [.027, .025]],
  [[.027, .025], [.027, .0471], [.01491, .065], [0, .065]],
].map(points => new T.CubicBezierCurve(...points.map(([x, y]) => new T.Vector2(x, y)) as [T.Vector2, T.Vector2, T.Vector2, T.Vector2]));

export function brushWidth(y: number) {
  const curve = profile.find(curve => y <= curve.v3.y) ?? profile[profile.length - 1];
  let low = 0, high = 1;
  for (let step = 0; step < 22; step++) {
    const mid = (low + high) / 2;
    if (curve.getPoint(mid).y < y) low = mid; else high = mid;
  }
  return curve.getPoint((low + high) / 2).x;
}
function section(y: number) {
  const t = T.MathUtils.smoothstep(y, -.035, .006);
  return { center: .001 - .0005 * t, depth: .0045 + .002 * t };
}

/** Upper surface height, also used to seat the chasing in the casting. */
export function brushSurface(x: number, y: number) {
  const { center, depth } = section(y), width = Math.max(brushWidth(y), .00001);
  return center + depth * Math.sqrt(Math.max(0, 1 - (x / width) ** 2));
}

export function createBrushBody() {
  const positions: number[] = [], indices: number[] = [];
  const rows = 256, sides = 64;
  // Cosine spacing resolves the rounded ends without a row of zero-area faces.
  for (let row = 1; row < rows; row++) {
    const y = -.096 + .161 * (1 - Math.cos(Math.PI * row / rows)) / 2;
    const width = brushWidth(y), { center, depth } = section(y);
    // Taper depth only at the extreme ends, rounding their end caps as well.
    const round = (distance: number) => Math.sqrt(1 - (1 - T.MathUtils.clamp(distance / .004, 0, 1)) ** 2);
    const endRound = Math.min(round(y + .096), round(.065 - y));
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2;
      positions.push(width * Math.cos(angle), y, center + depth * Math.sin(angle) * endRound);
    }
  }
  for (let row = 0; row < rows - 2; row++) for (let side = 0; side < sides; side++) {
    const a = row * sides + side, b = row * sides + (side + 1) % sides;
    indices.push(a, a + sides, b, b, a + sides, b + sides);
  }
  const bottom = positions.length / 3;
  positions.push(0, -.096, section(-.096).center);
  const top = positions.length / 3;
  positions.push(0, .065, section(.065).center);
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides, last = (rows - 2) * sides;
    indices.push(bottom, side, next, top, last + next, last + side);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
