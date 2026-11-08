import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAgedMetal } from './agedMetal';
import { createBrushBody, brushSurface, brushWidth } from './brushBody';

type Point = [number, number, number];

/** Original modeled dressing-table objects. All silhouettes, rims, jewelry,
 * brush tufts and relief are geometry, lit by the mirror's shared environment. */
export class VanityObjects {
  readonly root = new T.Group();
  private brush = new T.Group();
  private dish = new T.Group();
  private box = new T.Group();
  private floral = porcelainFlowers();

  constructor() {
    this.root.name = 'Dressing table objects';
    const brass = createAgedMetal('gold'); brass.color.set('#b29a61'); brass.roughness = .28;
    const gilt = createAgedMetal('burnished'); gilt.color.set('#d2b36b');
    const dark = createAgedMetal('recess');
    const porcelain = new T.MeshPhysicalMaterial({
      color: '#c9c2b8', map: this.floral, roughness: .26, metalness: 0,
      clearcoat: 1, clearcoatRoughness: .13, ior: 1.48, envMapIntensity: .85,
    });
    porcelain.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vCeramicPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCeramicPosition = position;');
      shader.fragmentShader = 'varying vec3 vCeramicPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        float kiln = sin(vCeramicPosition.x * 710.0 + sin(vCeramicPosition.y * 920.0))
          * sin(vCeramicPosition.y * 680.0 + vCeramicPosition.z * 370.0);
        roughnessFactor += kiln * .018;
      `);
    };
    porcelain.customProgramCacheKey = () => 'vanity-porcelain-v1';
    const pearl = new T.MeshPhysicalMaterial({ color: '#f1e8d8', roughness: .25, clearcoat: .8, clearcoatRoughness: .2, iridescence: .14, iridescenceIOR: 1.3, envMapIntensity: .9 });
    const quartz = new T.MeshPhysicalMaterial({ color: '#b77f91', roughness: .14, metalness: 0, transmission: .22, thickness: .004, ior: 1.54, clearcoat: 1 });
    const bristles = new T.MeshStandardMaterial({ color: '#6a4d30', roughness: .82 });
    this.buildBrush(brass, gilt, dark, bristles);
    this.buildDish(porcelain, gilt, pearl, quartz);
    this.buildBox(porcelain, gilt);
    this.brush.name = 'Chased brass hairbrush';
    this.dish.name = 'Gilt porcelain jewelry dish';
    this.box.name = 'Porcelain trinket box';
    this.root.add(this.brush, this.dish, this.box);
  }

  arrange(aspect: number) {
    if (aspect >= 1.12) {
      this.brush.position.set(-.158, -.068, 0); this.brush.scale.setScalar(1);
      this.brush.rotation.set(.026, -.16, -.32, 'ZYX');
      this.dish.position.set(.153, -.067, 0); this.dish.scale.setScalar(1);
      this.dish.rotation.set(.02, -.04, .22);
      this.box.position.set(.157, .041, 0); this.box.scale.setScalar(1);
      this.box.rotation.set(.04, .07, -.35); this.box.visible = true;
    } else {
      // A smaller arrangement beside the handle preserves the large oval on phones.
      this.brush.position.set(-.059, -.147, 0); this.brush.scale.setScalar(.52);
      this.brush.rotation.set(.026, -.16, -.30, 'ZYX');
      this.dish.position.set(.056, -.152, 0); this.dish.scale.setScalar(.56);
      this.dish.rotation.set(.02, -.04, -.2);
      this.box.visible = false;
    }
    this.brush.updateWorldMatrix(true, true);
    // A rotated merged mesh's bounding-box corners include empty space.
    // Ground against its actual vertices, with only 0.1 mm of cloth clearance.
    const bounds = new T.Box3().setFromObject(this.brush, true);
    this.brush.position.z += -.0079 - bounds.min.z;
  }

  private buildBrush(brass: T.Material, gilt: T.Material, dark: T.Material, bristles: T.Material) {
    const shell: T.BufferGeometry[] = [], trim: T.BufferGeometry[] = [], chasing: T.BufferGeometry[] = [];
    // A rolled brass casing, with its domed bristle insert facing the viewer.
    // The metal shell remains visible in profile, below the tufted bed.
    shell.push(createBrushBody());
    // A turned lip joins the rolled rim to the casting beneath it. The rim
    // must not hover over the convex shell's falling edge.
    shell.push(vessel(.026, .039, [[.94, .0046], [.98, .0053], [1.015, .0048],
      [1.027, .0031], [1, .0005], [.94, .0005], [.94, .0046]], 0).translate(0, .025, 0));
    trim.push(ovalTube(.026, .039, .0045, .0008, 0, .025));
    trim.push(ovalTube(.0253, .0382, .0055, .00028, 0, .025));
    chasing.push(ovalTube(.0262, .0392, .0025, .00022, 0, .025));
    const wood = new T.MeshStandardMaterial({ color: '#342319', roughness: .73 });
    wood.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vBrushPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrushPosition = position;');
      shader.fragmentShader = 'varying vec3 vBrushPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float grain = sin(vBrushPosition.x * 3600. + sin(vBrushPosition.y * 120.) * 2.);
        diffuseColor.rgb *= .87 + .13 * grain;
      `);
    };
    wood.customProgramCacheKey = () => 'brush-wood-v1';
    mesh(this.brush, ellipsoid([0, .025, .0055], [.0247, .0372, .0038], 56, 28), wood);

    // Chasing is seated on the curved casting. A small fluted palmette spreads
    // from the throat into the oval rim; the handle's fine border follows it.
    const seated = (points: [number, number][], lift = .00012): Point[] =>
      points.map(([x, y]) => [x, y, brushSurface(x, y) + lift]);
    const seatedLeaf = (base: [number, number], tip: [number, number], width: number) => {
      const relief = leaf([...base, .00008], [...tip, .00008], width);
      const p = relief.getAttribute('position');
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + brushSurface(p.getX(i), p.getY(i)));
      relief.computeVertexNormals(); return relief;
    };
    trim.push(seatedLeaf([0, -.0285], [0, -.0138], .0013));
    trim.push(tube(seated([[0, -.026], [-.0006, -.045], [.0006, -.066], [0, -.087]]), .00020));
    for (const side of [-1, 1]) {
      const border: [number, number][] = [];
      for (let i = 0; i <= 36; i++) {
        const y = -.014 - i * .077 / 36;
        border.push([side * brushWidth(y) * .72, y]);
      }
      trim.push(tube(seated(border), .00019, 72));
      for (let i = 0; i < 7; i++) {
        const y = -.035 - i * .0074, x = side * .0021;
        trim.push(leaf([0, y, brushSurface(0, y) + .00012], [x, y + .0038, brushSurface(x, y + .0038) + .00010], .0007));
      }
      for (let i = 0; i < 2; i++) {
        const x = side * (.0056 + i * .0032), y = -.0145 - i * .0012;
        trim.push(seatedLeaf([side * .0008, -.028 + i * .003], [x, y], .0011 - i * .0002));
        trim.push(tube(seated([[side * .001, -.027 + i * .003], [x * .45, -.022], [x * .9, y - .001]], .00028), .00011));
        chasing.push(tube(seated([[side * .0017, -.026 + i * .003], [x * .65, -.021], [x + side * .0004, y - .001]], -.00002), .00010));
      }
    }
    // Tiny milled beads on the rim, not oversized applied ornament.
    for (let i = 0; i < 102; i++) {
      const a = i / 102 * Math.PI * 2;
      trim.push(ellipsoid([.0263 * Math.cos(a), .025 + .0393 * Math.sin(a), .0047], [.0003, .0003, .00025], 8, 6));
    }
    const tufts: T.BufferGeometry[][] = [[], [], [], []], sockets: T.BufferGeometry[] = [];
    const tones = [bristles, new T.MeshStandardMaterial({ color: '#94744c', roughness: .86 }),
      new T.MeshStandardMaterial({ color: '#b69768', roughness: .9 }), new T.MeshStandardMaterial({ color: '#493424', roughness: .8 })];
    const random = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    let tuft = 0;
    for (let row = -8; row <= 8; row++) for (let col = -5; col <= 5; col++) {
      const x = (col + (Math.abs(row) % 2) * .5) * .0041, y = row * .0042;
      const r2 = (x / .023) ** 2 + (y / .035) ** 2;
      if (r2 > 1) continue;
      const root = .0055 + .0038 * Math.sqrt(Math.max(0, 1 - (x / .0247) ** 2 - (y / .0372) ** 2));
      sockets.push(ellipsoid([x, .025 + y, root], [.00082, .00082, .00018], 10, 6));
      // Seven tapered fibers form each drilled tuft. Bent tips, a staggered grid,
      // and bounded length/color variation avoid the uniform-pin appearance.
      for (let strand = 0; strand < 7; strand++) {
        const id = tuft * 7 + strand, angle = strand * 2.399 + tuft * .31;
        const spread = strand ? .00048 : 0;
        const px = x + Math.cos(angle) * spread, py = .025 + y + Math.sin(angle) * spread;
        const length = .009 + .003 * (1 - r2) + (random(id) - .5) * .002;
        const bendX = x * .055 + Math.cos(angle) * .0007;
        const bendY = y * .025 + Math.sin(angle) * .0006;
        const hair = new T.CylinderGeometry(.000045, .00017, length, 5, 3, false).rotateX(Math.PI / 2);
        const positions = hair.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          // After rotation the narrow end points along +z, above the insert.
          const z = positions.getZ(i), t = (z + length / 2) / length;
          positions.setXYZ(i, positions.getX(i) + px + bendX * t * t, positions.getY(i) + py + bendY * t * t, root + z + length / 2);
        }
        hair.computeVertexNormals(); tufts[Math.floor(random(id + 1400) * 4)].push(hair);
      }
      tuft++;
    }
    mergeMesh(this.brush, shell, brass); mergeMesh(this.brush, trim, gilt);
    mergeMesh(this.brush, chasing, dark); mergeMesh(this.brush, sockets, wood);
    tufts.forEach((parts, i) => mergeMesh(this.brush, parts, tones[i]));
  }

  private buildDish(porcelain: T.Material, gilt: T.Material, pearl: T.Material, quartz: T.Material) {
    const a = .049, b = .034;
    const profile: [number, number][] = [[0, -.002], [.55, -.0018], [.72, -.0008], [.84, .001], [.94, .0045],
      [1, .007], [1.025, .007], [1.035, .0056], [.99, .002], [.86, -.0035], [.68, -.006], [0, -.006]];
    mesh(this.dish, vessel(a, b, profile, 14), porcelain);
    const gold: T.BufferGeometry[] = [ovalTube(a * 1.015, b * 1.015, .007, .0006, 0, 0, 14), ovalTube(a * .84, b * .84, .0015, .0002)];
    // Pearl bracelet, threaded on a gold wire, rests within the recessed well.
    const pearls: T.BufferGeometry[] = [];
    gold.push(ovalTube(.032, .021, .0005, .00019));
    for (let i = 0; i < 51; i++) {
      const angle = i / 51 * Math.PI * 2, radius = .00158 * (1 + .04 * Math.sin(i * 7));
      pearls.push(ellipsoid([.032 * Math.cos(angle), .021 * Math.sin(angle), .0006], [radius, radius, radius], 14, 10));
    }
    const ring = new T.TorusGeometry(.0078, .0009, 10, 48).rotateX(.45).rotateY(.25).translate(-.008, -.002, .0025);
    gold.push(ring);
    gold.push(new T.TorusGeometry(.0086, .0008, 10, 48).rotateX(-.35).rotateY(.45).translate(.010, .003, .0029));
    gold.push(ovalTube(.0027, .0034, .008, .0005, -.008, .005));
    for (const side of [-1, 1]) for (const end of [-1, 1])
      gold.push(tube([[-.008 + side * .0022, .005 + end * .0027, .0058], [-.008 + side * .0025, .005 + end * .0029, .0094]], .00035, 5));
    mesh(this.dish, new T.IcosahedronGeometry(1, 1).scale(.0025, .0032, .002).translate(-.008, .005, .0087), quartz);
    mergeMesh(this.dish, gold, gilt); mergeMesh(this.dish, pearls, pearl);
  }

  private buildBox(porcelain: T.Material, gilt: T.Material) {
    const a = .025, b = .022;
    mesh(this.box, vessel(a, b, [[0, .017], [.8, .016], [.96, .015], [1.06, .011], [1.12, .004], [1.03, -.003], [.78, -.006], [0, -.006]], 10), porcelain);
    mesh(this.box, vessel(a, b, [[0, .022], [.4, .0215], [.76, .019], [.96, .016], [1.03, .015], [1.04, .0135], [.94, .0125], [0, .0125]], 10), porcelain);
    const gold: T.BufferGeometry[] = [ovalTube(a, b, .014, .00075, 0, 0, 10), ovalTube(a * .90, b * .90, .017, .00025, 0, 0, 10), ovalTube(a * .87, b * .87, -.003, .00055)];
    rose(gold, [0, 0, .023], .0042);
    for (const side of [-1, 1]) gold.push(leaf([0, 0, .022], [side * .008, side * .003, .021], .0025));
    for (let i = 0; i < 20; i++) {
      const angle = i / 20 * Math.PI * 2;
      gold.push(tube([[a * Math.cos(angle), b * Math.sin(angle), .003], [a * 1.005 * Math.cos(angle), b * 1.005 * Math.sin(angle), .011]], .00016, 4));
    }
    mergeMesh(this.box, gold, gilt);
  }

  dispose() { this.floral.dispose(); }
}

function mesh(group: T.Group, geometry: T.BufferGeometry, material: T.Material) {
  const object = new T.Mesh(geometry, material); object.castShadow = object.receiveShadow = true; group.add(object);
}
function mergeMesh(group: T.Group, parts: T.BufferGeometry[], material: T.Material) {
  const normalized = parts.map(part => { const geometry = part.index ? part.toNonIndexed() : part; geometry.deleteAttribute('uv'); return geometry; });
  const merged = mergeGeometries(normalized); mesh(group, merged, material);
  new Set([...parts, ...normalized]).forEach(geometry => geometry.dispose());
}
function ellipsoid(position: Point, scale: Point, segments = 24, rings = 14) {
  return new T.SphereGeometry(1, segments, rings).scale(...scale).translate(...position);
}
function tube(points: Point[], radius: number, segments = 32) {
  return new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), segments, radius, 8, false);
}
function ovalTube(a: number, b: number, z: number, radius: number, x = 0, y = 0, flutes = 0) {
  const points: T.Vector3[] = [];
  for (let i = 0; i < 192; i++) {
    const angle = i / 192 * Math.PI * 2, scallop = 1 + (flutes ? .018 * Math.cos(angle * flutes) : 0);
    points.push(new T.Vector3(x + a * scallop * Math.cos(angle), y + b * scallop * Math.sin(angle), z));
  }
  return new T.TubeGeometry(new T.CatmullRomCurve3(points, true), 192, radius, 8, true);
}
function leaf(base: Point, tip: Point, width: number) {
  const points: number[] = [], indices: number[] = [];
  const dx = tip[0] - base[0], dy = tip[1] - base[1], length = Math.hypot(dx, dy);
  for (let row = 0; row <= 12; row++) for (let col = 0; col <= 6; col++) {
    const t = row / 12, across = col / 3 - 1, spread = Math.sin(t * Math.PI) * width * (1 + .09 * Math.cos(t * Math.PI * 6));
    points.push(base[0] + dx * t - dy / length * across * spread, base[1] + dy * t + dx / length * across * spread,
      base[2] + (tip[2] - base[2]) * t + Math.sin(t * Math.PI) * (1 - across * across) * width * .35);
  }
  for (let row = 0; row < 12; row++) for (let col = 0; col < 6; col++) { const a = row * 7 + col, b = a + 7; indices.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(points, 3)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
function rose(parts: T.BufferGeometry[], center: Point, size: number) {
  for (let tier = 0; tier < 3; tier++) for (let i = 0; i < 7 - tier; i++) {
    const angle = i / (7 - tier) * Math.PI * 2 + tier * .7, r = size * (1 - tier * .28);
    parts.push(leaf([center[0], center[1], center[2] + tier * .0006],
      [center[0] + Math.cos(angle) * r, center[1] + Math.sin(angle) * r, center[2]], r * .49));
  }
}
function vessel(a: number, b: number, profile: [number, number][], flutes: number) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], segments = 128;
  for (const [r, z] of profile) for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2, scallop = 1 + .018 * Math.cos(angle * flutes) * r * r;
    const x = r * Math.cos(angle), y = r * Math.sin(angle);
    positions.push(a * x * scallop, b * y * scallop, z);
    uvs.push(x * .47 + .5, y * .47 + .5);
  }
  for (let row = 0; row < profile.length - 1; row++) for (let i = 0; i < segments; i++) {
    const p = row * (segments + 1) + i, q = p + segments + 1;
    indices.push(p, q, p + 1, p + 1, q, q + 1);
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); g.setIndex(indices); g.computeVertexNormals(); return g;
}

/** Small, code-drawn botanical enamel marks live under the glaze, follow the
 * curved UV surface and receive the same shading as the rest of the ceramic. */
function porcelainFlowers() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, 1024, 1024);
  for (let sprig = 0; sprig < 7; sprig++) {
    const angle = sprig / 7 * Math.PI * 2 + .3;
    ctx.save(); ctx.translate(512 + Math.cos(angle) * 343, 512 + Math.sin(angle) * 343); ctx.rotate(angle + Math.PI / 2);
    ctx.strokeStyle = '#819274'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, 48); ctx.bezierCurveTo(-17, 15, 17, -18, 1, -58); ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const side = i % 2 ? -1 : 1, y = 32 - i * 17;
      ctx.fillStyle = i % 2 ? '#a0ab8b' : '#879677'; ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(side * 10, y - 23, side * 27, y - 23, side * 28, y - 28);
      ctx.bezierCurveTo(side * 23, y - 7, side * 12, y + 3, 0, y); ctx.fill();
    }
    for (const [x, y, scale] of [[-8, -18, 1], [16, 23, .55], [0, -64, .42]]) {
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      for (let tier = 0; tier < 3; tier++) for (let i = 0; i < 6; i++) {
        const theta = i * Math.PI / 3 + tier * .6, radius = 17 - tier * 5;
        ctx.fillStyle = ['#d3a5a6', '#bd858d', '#e0bdba'][tier];
        ctx.beginPath(); ctx.ellipse(Math.cos(theta) * radius * .4, Math.sin(theta) * radius * .4, radius * .7, radius * .44, theta + 1.1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#986f74'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 3, .2, 4.7); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4; return texture;
}
