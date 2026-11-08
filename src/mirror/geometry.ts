import { BufferGeometry, Float32BufferAttribute } from 'three';
import { MIRROR } from './spec';

type Profile = readonly (readonly [number, number])[];
const COUNT = 256;

function contour(offset: number, index: number) {
  const angle = index / COUNT * Math.PI * 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  const a = MIRROR.width / 2, b = MIRROR.height / 2;
  const length = Math.hypot(c / a, s / b);
  const nx = c / a / length, ny = s / b / length;
  return { x: a * c + nx * offset, y: b * s + ny * offset, nx, ny };
}

/** Analytic sweep normals avoid corner seams and topology-dependent highlights. */
function sweep(profile: Profile, closed: boolean, cap: boolean): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let ring = 0; ring < profile.length; ring++) {
    const [offset, z] = profile[ring];
    const previous = profile[ring === 0 ? (closed ? profile.length - 1 : 0) : ring - 1];
    const next = profile[ring === profile.length - 1 ? (closed ? 0 : ring) : ring + 1];
    const beforeLength = Math.hypot(offset - previous[0], z - previous[1]) || 1;
    const afterLength = Math.hypot(next[0] - offset, next[1] - z) || 1;
    const dr = (offset - previous[0]) / beforeLength + (next[0] - offset) / afterLength;
    const dz = (z - previous[1]) / beforeLength + (next[1] - z) / afterLength;
    const length = Math.hypot(dr, dz) || 1;
    for (let i = 0; i < COUNT; i++) {
      const p = contour(offset, i);
      positions.push(p.x, p.y, z);
      normals.push(-dz / length * p.nx, -dz / length * p.ny, dr / length);
      uvs.push(p.x / MIRROR.width + .5, p.y / MIRROR.height + .5);
    }
  }
  const rings = closed ? profile.length : profile.length - 1;
  for (let ring = 0; ring < rings; ring++) {
    const next = (ring + 1) % profile.length;
    for (let i = 0; i < COUNT; i++) {
      const j = (i + 1) % COUNT;
      const a = ring * COUNT + i, b = ring * COUNT + j;
      const c = next * COUNT + i, d = next * COUNT + j;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (cap) {
    const center = positions.length / 3;
    positions.push(0, 0, profile[0][1]); normals.push(0, 0, 1); uvs.push(.5, .5);
    for (let i = 0; i < COUNT; i++) indices.push(center, i, (i + 1) % COUNT);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createGlass(): BufferGeometry {
  const b = MIRROR.bevelWidth, t = MIRROR.glassThickness, edge = t - MIRROR.bevelDrop;
  return sweep([
    [-b, t], [-b + .00015, t], [-b + .0004, t - .00005],
    [-.0005, edge + .0001], [-.0001, edge],
    [0, edge - .0001], [0, .0001],
  ], false, true);
}

export function createFrame(): BufferGeometry {
  const profile: Profile = [
    [.0001, -.001], [.0002, .0022], [.0008, .0034],
    [.0018, .0038], [.003, .0034], [.0042, .0019],
    [.006, .0021], [.008, .0036], [.010, .0037],
    [.012, .0018], [.0125, -.001], [.011, -.005],
    [.003, -.005], [.0001, -.003],
  ];
  return sweep(profile, true, false);
}
