import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MIRROR } from './spec';

type Finish = 'gold' | 'burnished' | 'recess';
type Point = readonly [number, number, number];

/** Cast relief, pierced filigree and figure sculpture, all actual geometry.
 * Parts are merged by finish so the ornament costs three draw calls. */
export function createOrnament(): Record<Finish, T.BufferGeometry> {
  const parts: Record<Finish, T.BufferGeometry[]> = { gold: [], burnished: [], recess: [] };
  const transform = new T.Matrix4();
  const sphere = new T.SphereGeometry(1, 16, 10);
  const add = (geometry: T.BufferGeometry, finish: Finish = 'gold') => {
    geometry.deleteAttribute('uv');
    if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
    geometry.applyMatrix4(transform);
    parts[finish].push(geometry);
  };
  const oval = (p: Point, scale: Point, finish: Finish = 'gold', angle = 0) => {
    const geometry = sphere.clone().scale(...scale).rotateZ(angle).translate(...p);
    add(geometry, finish);
  };
  const wire = (points: Point[], radius: number, finish: Finish = 'gold', segments = 32) => {
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)));
    add(new T.TubeGeometry(curve, segments, radius, 6, false), finish);
  };
  const scroll = (cx: number, cy: number, radius: number, start: number, handed = 1, z = .0045, thickness = .00065) => {
    const points: Point[] = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64, angle = start + handed * t * Math.PI * 3.3;
      const r = radius * (1 - t * .96);
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle), z + .0006 * Math.sin(t * Math.PI)]);
    }
    wire(points, thickness, 'gold', 64);
    oval(points.at(-1)!, [thickness * 1.4, thickness * 1.4, thickness], 'burnished');
  };

  // A leaf is a domed, scalloped ribbon with a raised midrib and chased veins.
  const leaf = (base: Point, tip: Point, width: number, relief = .001, veins = true, finish: Finish = 'gold') => {
    const dx = tip[0] - base[0], dy = tip[1] - base[1], length = Math.hypot(dx, dy);
    const nx = -dy / length, ny = dx / length;
    const point = (t: number, across: number): Point => {
      const spread = Math.pow(Math.sin(Math.PI * t), .8) * width * (1 + .14 * Math.sin(t * Math.PI * 7));
      const bend = .13 * width * Math.sin(t * Math.PI);
      return [base[0] + dx * t + nx * (across * spread + bend),
        base[1] + dy * t + ny * (across * spread + bend),
        base[2] + (tip[2] - base[2]) * t + relief * Math.sin(Math.PI * t)
          * Math.pow(Math.max(0, Math.cos(across * Math.PI * .5)), 1.7)];
    };
    const p: number[] = [], indices: number[] = [];
    const rows = 18, columns = 8;
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) p.push(...point(row / rows, column / columns * 2 - 1));
    }
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column, b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); add(geometry, finish);
    if (!veins) return;
    wire([point(.03, 0), point(.32, 0), point(.65, 0), point(.97, 0)], .00018, 'burnished', 20);
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
      const t = .18 + i * .15;
      wire([point(t, 0), point(t + .09, side * .45), point(t + .14, side * .87)], .00010, 'recess', 8);
    }
  };

  const rose = (x: number, y: number, z: number, size: number) => {
    oval([x, y, z - .0004], [size * .68, size * .68, size * .23], 'recess');
    for (let tier = 0; tier < 3; tier++) {
      const count = 7 - tier, radius = size * (1 - tier * .26);
      for (let i = 0; i < count; i++) {
        const a = i / count * Math.PI * 2 + tier * .6;
        const base: Point = [x + Math.cos(a) * radius * .16, y + Math.sin(a) * radius * .16, z + tier * .0006];
        const tip: Point = [x + Math.cos(a + .3) * radius, y + Math.sin(a + .3) * radius, z + tier * .0006 + .0004];
        leaf(base, tip, radius * .5, radius * .32, false, tier === 2 ? 'burnished' : 'gold');
      }
    }
    scroll(x, y, size * .23, .3, 1, z + .0021, .0002);
  };

  const a = MIRROR.width / 2, b = MIRROR.height / 2;
  const rimPoint = (angle: number, offset: number, z: number): Point => {
    const c = Math.cos(angle), s = Math.sin(angle), length = Math.hypot(c / a, s / b);
    return [a * c + c / a / length * offset, b * s + s / b / length * offset, z];
  };

  // Pearl edging and a two-strand rope molding around the bevel.
  for (let i = 0; i < 148; i++) {
    const angle = i / 148 * Math.PI * 2;
    oval(rimPoint(angle, .0035, .0035), [.00072, .00072, .0006], 'burnished');
  }
  for (const phase of [0, Math.PI]) {
    const points: Point[] = [];
    for (let i = 0; i <= 768; i++) {
      const angle = i / 768 * Math.PI * 2;
      points.push(rimPoint(angle, .00115 + Math.cos(angle * 96 + phase) * .00024,
        .0039 + Math.sin(angle * 96 + phase) * .00024));
    }
    wire(points, .00019, 'burnished', 1152);
  }

  // Repeating foliate castings alternate with pierced C-scrolls around the oval.
  for (let i = 0; i < 28; i++) {
    const angle = (i + .5) / 28 * Math.PI * 2;
    const base = rimPoint(angle, .0058, .0035);
    const tip = rimPoint(angle + .065, .018, .004);
    leaf(base, tip, .0032, .0015);
    const left = rimPoint(angle - .065, .013, .004);
    const right = rimPoint(angle + .12, .014, .004);
    leaf(base, left, .0021, .0012);
    leaf(base, right, .0022, .0012);
    const center = rimPoint(angle + .11, .0135, .002);
    scroll(center[0], center[1], .0057, angle + Math.PI * .5, i % 2 ? -1 : 1, .0032, .00055);
    wire([rimPoint(angle - .07, .010, .002), rimPoint(angle, .019, .001), rimPoint(angle + .09, .012, .002)], .00065, 'gold', 24);
  }

  // Symmetrical side garlands: longer acanthus leaves with tiny flower knots.
  for (const side of [-1, 1]) {
    for (const y of [-.050, 0, .048]) {
      const x = side * (a * Math.sqrt(1 - (y / b) ** 2) + .012);
      leaf([x, y - .007, .004], [x + side * .009, y + .012, .003], .0037, .0017);
      leaf([x, y + .001, .004], [x - side * .006, y + .011, .006], .0028, .0015);
    }
    rose(side * (a + .011), .001, .006, .0044);
  }

  // Pierced foliate crest. The figures are no longer perched on its shoulders.
  for (const side of [-1, 1]) {
    scroll(side * .012, .098, .011, side > 0 ? -.35 : Math.PI + .35, side, .003, .00075);
    leaf([side * .002, .094, .003], [side * .013, .115, .003], .0046, .0017);
    leaf([side * .009, .094, .003], [side * .031, .102, .003], .0035, .0014);
    leaf([side * .006, .105, .003], [side * .021, .111, .003], .0027, .0012);
  }
  rose(0, .102, .004, .0053);
  leaf([0, .106, .003], [.002, .120, .003], .0035, .0014);

  // A continuous cast neck grows out of the oval and into the grip. Small
  // pierced shoulders replace the old unsupported figure-and-wire connection.
  const handle = new T.Shape();
  handle.moveTo(0, -.082);
  handle.bezierCurveTo(.013, -.083, .029, -.078, .033, -.089);
  handle.bezierCurveTo(.038, -.101, .024, -.108, .019, -.117);
  handle.bezierCurveTo(.012, -.128, .007, -.143, .006, -.157);
  handle.bezierCurveTo(.005, -.174, .009, -.188, .012, -.201);
  handle.bezierCurveTo(.016, -.214, .006, -.226, 0, -.230);
  handle.bezierCurveTo(-.006, -.226, -.016, -.214, -.012, -.201);
  handle.bezierCurveTo(-.009, -.188, -.005, -.174, -.006, -.157);
  handle.bezierCurveTo(-.007, -.143, -.012, -.128, -.019, -.117);
  handle.bezierCurveTo(-.024, -.108, -.038, -.101, -.033, -.089);
  handle.bezierCurveTo(-.029, -.078, -.013, -.083, 0, -.082);
  // Almond-shaped openings are surrounded by substantial cast metal.
  for (const side of [-1, 1]) {
    const hole = new T.Path();
    hole.moveTo(side * .021, -.091);
    hole.bezierCurveTo(side * .026, -.086, side * .031, -.090, side * .030, -.096);
    hole.bezierCurveTo(side * .029, -.102, side * .023, -.105, side * .019, -.107);
    hole.bezierCurveTo(side * .021, -.101, side * .019, -.096, side * .021, -.091);
    handle.holes.push(hole);
  }
  add(new T.ExtrudeGeometry(handle, { depth: .0032, bevelEnabled: true, bevelSegments: 5,
    steps: 1, bevelSize: .0007, bevelThickness: .0010, curveSegments: 36 }).translate(0, 0, -.002));
  const outline = handle.getPoints(220).map(p => [p.x * .96, p.y, .0025] as Point);
  wire(outline, .00032, 'burnished', 440);

  // Broad, tapered scroll ribs with an oval section read as carved casting,
  // with changing mass through the root, shoulder, rolled tip and termination.
  const relief = (points: Point[], width: number, depth: number) => {
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)));
    const positions: number[] = [], indices: number[] = [];
    const rows = 72, sides = 16;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, p = curve.getPoint(t), tangent = curve.getTangent(t);
      const across = new T.Vector3(-tangent.y, tangent.x, 0).normalize();
      const w = width * (.22 + .78 * Math.sin(Math.PI * t) ** .65) * (1 - .55 * t);
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2;
        positions.push(p.x + across.x * Math.cos(angle) * w,
          p.y + across.y * Math.cos(angle) * w, p.z + Math.sin(angle) * depth * (.7 + .3 * Math.sin(Math.PI * t)));
        if (i < rows && j < sides) {
          const a = i * (sides + 1) + j, b = a + sides + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); add(geometry);
  };
  for (const side of [-1, 1]) {
    relief([[side * .005, -.139, .0026], [side * .014, -.116, .0032],
      [side * .029, -.105, .0034], [side * .033, -.094, .0035],
      [side * .027, -.088, .0036], [side * .023, -.093, .0038]], .0030, .00135);
    leaf([side * .006, -.126, .0035], [side * .021, -.109, .0040], .0043, .00165);
    leaf([side * .012, -.112, .0040], [side * .033, -.099, .0040], .0039, .0016);
    leaf([side * .017, -.103, .0040], [side * .036, -.087, .0037], .0037, .0015);
    wire([[side * .007, -.135, .0035], [side * .014, -.118, .0047],
      [side * .023, -.107, .0050]], .00019, 'recess', 40);
  }

  // A single continuous fan shell: fluted relief with a scalloped lip,
  // not a bundle of separate petals. It joins the neck to the narrow grip.
  const shellPoint = (r: number, u: number): Point => {
    const angle = (u - .5) * 2.05;
    const flute = .5 + .5 * Math.cos(u * Math.PI * 18);
    const length = r * (1 + .045 * flute);
    return [Math.sin(angle) * length * .0185,
      -.139 + Math.cos(angle) * length * .027,
      .0028 + Math.sin(Math.PI * r) * .0013 + (flute - .5) * .0010 * Math.sin(Math.PI * r)];
  };
  const shellP: number[] = [], shellI: number[] = [];
  const shellRows = 40, shellColumns = 108;
  for (let r = 0; r <= shellRows; r++) for (let c = 0; c <= shellColumns; c++) shellP.push(...shellPoint(r / shellRows, c / shellColumns));
  for (let r = 0; r < shellRows; r++) for (let c = 0; c < shellColumns; c++) {
    const a = r * (shellColumns + 1) + c, b = a + shellColumns + 1;
    shellI.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const shell = new T.BufferGeometry();
  shell.setAttribute('position', new T.Float32BufferAttribute(shellP, 3));
  shell.setIndex(shellI); shell.computeVertexNormals(); add(shell);
  wire(Array.from({length:81}, (_, i) => shellPoint(1, i / 80)), .00027, 'burnished', 100);

  // A small winged mask sits in the neck as low relief. Facial planes share
  // one surface; shallow sockets and lips avoid bead eyes and a separate nose.
  const fx = 0, fy = -.102, sx = .0046, sy = .0058;
  const bell = (x: number, y: number, cx: number, cy: number, wx: number, wy: number) =>
    Math.exp(-(((x - cx) / wx) ** 2) - ((y - cy) / wy) ** 2);
  const facePoint = (r: number, angle: number): Point => {
    const x = r * Math.cos(angle), y = r * Math.sin(angle);
    let z = .00165 * Math.sqrt(Math.max(0, 1 - r * r));
    z += .00038 * bell(x, y, 0, .55, .65, .45);
    z += .00040 * (bell(x, y, -.48, -.12, .29, .35) + bell(x, y, .48, -.12, .29, .35));
    z += .00078 * bell(x, y, 0, .02, .14, .44) + .00027 * bell(x, y, 0, -.23, .23, .16);
    z -= .00024 * (bell(x, y, -.40, .19, .25, .14) + bell(x, y, .40, .19, .25, .14));
    z -= .00017 * bell(x, y, 0, -.48, .32, .055);
    return [fx + x * sx * (.93 + .10 * y), fy + y * sy, .0044 + z];
  };
  const fp: number[] = [], fi: number[] = [];
  for (let r = 0; r <= 32; r++) for (let c = 0; c <= 80; c++) fp.push(...facePoint(r / 32, c / 80 * Math.PI * 2));
  for (let r = 0; r < 32; r++) for (let c = 0; c < 80; c++) {
    const a = r * 81 + c, b = a + 81;
    fi.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const faceRelief = new T.BufferGeometry();
  faceRelief.setAttribute('position', new T.Float32BufferAttribute(fp, 3));
  faceRelief.setIndex(fi); faceRelief.computeVertexNormals(); add(faceRelief);
  for (let i = 0; i < 9; i++) {
    const angle = -.25 + i / 8 * Math.PI * 1.15;
    scroll(Math.cos(angle) * .0038, fy + .0014 + Math.sin(angle) * .0038,
      .00075, angle, 1, .0054, .00017);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
    leaf([side * .0038, fy - .0030, .0034],
      [side * (.009 + .0015 * i), fy + .006 - i * .0015, .0039], .0015, .0008, true);
  }

  // Chased grip, connected to the fluted shell by a small floral collar.
  rose(0, -.143, .0036, .0034);
  for (const side of [-1, 1]) {
    relief([[side * .0038, -.149, .0027], [side * .0038, -.171, .0027],
      [side * .008, -.198, .0030], [side * .007, -.214, .0030], [0, -.224, .003]], .0009, .0006);
    for (let i = 0; i < 4; i++) {
      const y = -.155 - i * .012;
      leaf([0, y - .008, .0027], [side * (.004 + i * .0005), y + .005, .0030], .0018, .0010);
    }
  }
  rose(0, -.210, .0036, .0052);
  leaf([0, -.228, .0026], [0, -.217, .0035], .0036, .0011);
  oval([0, -.230, .001], [.0024, .0025, .0017], 'burnished');

  sphere.dispose();
  const result = {} as Record<Finish, T.BufferGeometry>;
  for (const finish of Object.keys(parts) as Finish[]) {
    result[finish] = mergeGeometries(parts[finish])!;
    parts[finish].forEach(geometry => geometry.dispose());
    // A shorter, usable grip gives the reflective oval more of the viewport
    // while preserving the complete handheld silhouette and its ornament.
    const positions = result[finish].getAttribute('position');
    const normals = result[finish].getAttribute('normal');
    const n = new T.Vector3();
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) >= -.09) continue;
      positions.setY(i, -.09 + (positions.getY(i) + .09) * MIRROR.handleCompression);
      n.fromBufferAttribute(normals, i);
      n.y /= MIRROR.handleCompression;
      n.normalize();
      normals.setXYZ(i, n.x, n.y, n.z);
    }
    result[finish].computeBoundingSphere();
  }
  return result;
}
