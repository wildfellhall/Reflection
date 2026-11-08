import { test, expect } from '@playwright/test';
import { Box3, Vector3 } from 'three';
import { createGlass, createFrame } from '../src/mirror/geometry';
import { createOrnament } from '../src/mirror/ornament';
import { MIRROR } from '../src/mirror/spec';

test('the oval pane has a real cut bevel and a continuous cast metal surround', () => {
  const glass = createGlass(), chrome = createFrame();
  glass.computeBoundingBox(); chrome.computeBoundingBox();
  const size = glass.boundingBox!.getSize(new Vector3());
  expect(size.x).toBeCloseTo(MIRROR.width, 6);
  expect(size.y).toBeCloseTo(MIRROR.height, 6);
  expect(glass.boundingBox!.max.z).toBeCloseTo(MIRROR.glassThickness, 6);
  expect(chrome.boundingBox!.max.x).toBeGreaterThan(glass.boundingBox!.max.x + MIRROR.frameWidth * .9);
  expect(chrome.boundingBox!.min.z).toBeLessThan(-.0045);

  // Check actual normal direction against triangle winding, not a screenshot's
  // apparent brightness: this catches inverted facets and discontinuous seams.
  let flat = 0, bevel = 0;
  for (const geometry of [glass, chrome]) {
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      expect(new Vector3().fromBufferAttribute(n, i).length()).toBeCloseTo(1, 5);
      if (geometry === glass) {
        if (n.getZ(i) > .99999) {
          expect(p.getZ(i)).toBeCloseTo(MIRROR.glassThickness, 6);
          flat++;
        } else if (n.getZ(i) > .8 && n.getZ(i) < .99) bevel++;
      }
    }
    const index = geometry.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const [a, b, c] = ids.map(id => new Vector3().fromBufferAttribute(p, id));
      const face = b.sub(a).cross(c.sub(a)).normalize();
      const shading = ids.map(id => new Vector3().fromBufferAttribute(n, id)).reduce((sum, normal) => sum.add(normal), new Vector3()).normalize();
      expect(face.dot(shading)).toBeGreaterThan(.7);
    }
  }
  expect(flat).toBeGreaterThan(100);
  expect(bevel).toBeGreaterThan(100);
  glass.dispose(); chrome.dispose();
});

test('the ornament has finite sculpted geometry, a crown and a complete handle', () => {
  const ornament = createOrnament();
  const totalBounds = new Box3();
  for (const geometry of Object.values(ornament)) {
    const positions = geometry.getAttribute('position');
    expect([...positions.array].every(Number.isFinite)).toBe(true);
    expect([...geometry.getAttribute('normal').array].every(Number.isFinite)).toBe(true);
    geometry.computeBoundingBox();
    totalBounds.union(geometry.boundingBox!);
    expect(geometry.boundingBox!.min.y).toBeLessThan(-.165);
    expect(geometry.boundingBox!.max.y).toBeGreaterThan(.10);
    geometry.dispose();
  }
  // The complete casting needs depth; small chased recesses and rubbed accents
  // need not each span the former standing figure's full depth.
  expect(totalBounds.max.z - totalBounds.min.z).toBeGreaterThan(.005);
});

test('rendered glass obeys slab energy and absorption; chrome matches normal-incidence conductor Fresnel', async ({ page }) => {
  await page.goto('/');
  // Exercise the production GLSL against independent analytical references in
  // a uniform radiance field. Read linear GPU pixels before any display mapping.
  const cases = [
    { angle: 0, thickness: .006, absorption: [0, 0, 0], silver: [1, 1, 1] },
    { angle: 0, thickness: .006, absorption: [...MIRROR.absorption], silver: [...MIRROR.silverReflectance] },
    { angle: 60, thickness: .006, absorption: [...MIRROR.absorption], silver: [...MIRROR.silverReflectance] },
    { angle: 80, thickness: .020, absorption: [18, 4, 9], silver: [...MIRROR.silverReflectance] },
  ];
  const rendered = await page.evaluate(async ({ inputs, spec }) => {
    const threePath = '/node_modules/three/build/three.module.js';
    const shaderPath = '/src/mirror/shaders.ts';
    const T = await import(threePath);
    const { mirrorVertex, mirrorFragment } = await import(shaderPath);
    const renderer = new T.WebGLRenderer();
    renderer.toneMapping = T.NoToneMapping;
    const target = new T.WebGLRenderTarget(1, 1, { type: T.FloatType, colorSpace: T.NoColorSpace });
    const env = new T.DataTexture(new Float32Array([.5, .5, .5, 1]), 1, 1, T.RGBAFormat, T.FloatType);
    env.needsUpdate = true;
    const coat = new T.DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, T.RGBAFormat, T.FloatType);
    const surface = new T.DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, T.RGBAFormat, T.FloatType);
    coat.needsUpdate = surface.needsUpdate = true;
    const uniforms = {
      uVideo: { value: env }, uEnvironment: { value: env }, uLive: { value: 0 },
      uBackingMap: { value: coat }, uGlassMap: { value: surface }, uMaterialTexel: { value: new T.Vector2(1, 1) },
      uLayer: { value: 0 }, uIOR: { value: 1.52 }, uViewDistance: { value: 10 },
      uEnvironmentRotation: { value: 0 }, uEnvironmentExposure: { value: 1 },
      // Disable the presentation studio to measure the optical material alone.
      uCameraIntegration: { value: 1 }, uCameraExposure: { value: 1 }, uCameraSaturation: { value: 1 },
      uFaceMetalness: { value: 0 }, uFaceContour: { value: 0 },
      uAntique: { value: 0 },
      uStudioStrength: { value: 0 }, uStudioShift: { value: new T.Vector2() },
      uSize: { value: new T.Vector2(.62, .86) }, uVideoSize: { value: new T.Vector2(1280, 720) },
      uAbsorption: { value: new T.Vector3() }, uSilver: { value: new T.Vector3() },
      uChromeN: { value: new T.Vector3(3.1071, 3.1812, 2.323) },
      uChromeK: { value: new T.Vector3(3.3314, 3.3291, 3.135) },
      uWorldRotation: { value: new T.Matrix3() },
    };
    const material = new T.ShaderMaterial({ vertexShader: mirrorVertex, fragmentShader: mirrorFragment, uniforms });
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-.001, .001, .001, -.001, .01, 20);
    const read = (angle: number, thickness: number) => {
      const geometry = new T.PlaneGeometry(2, 2).translate(0, 0, thickness);
      const mesh = new T.Mesh(geometry, material); scene.add(mesh);
      const theta = angle * Math.PI / 180;
      camera.position.set(10 * Math.sin(theta), 0, 10 * Math.cos(theta) + thickness);
      camera.lookAt(0, 0, thickness);
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixel = new Float32Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
      scene.remove(mesh); geometry.dispose();
      return [...pixel].slice(0, 3);
    };
    const glass = inputs.map(input => {
      uniforms.uAbsorption.value.fromArray(input.absorption);
      uniforms.uSilver.value.fromArray(input.silver);
      return read(input.angle, input.thickness);
    });
    uniforms.uLayer.value = 1;
    const chrome = read(0, .006);
    uniforms.uLayer.value = 0;
    uniforms.uFaceMetalness.value = spec.faceMetalness;
    uniforms.uAbsorption.value.fromArray(inputs[1].absorption);
    uniforms.uSilver.value.fromArray(inputs[1].silver);
    const polishedFace = read(0, inputs[1].thickness);
    // Exercise the actual layered path. Full silver loss must still retain
    // the front glass return, and the protective backing must not emit light.
    uniforms.uAntique.value = 1;
    uniforms.uFaceMetalness.value = 0;
    coat.image.data[0] = 1; coat.needsUpdate = true;
    const lostSilver = read(0, .006);
    env.image.data.fill(0); env.needsUpdate = true;
    const unlitBacking = read(0, .006);

    // A bright angular stripe probes lobe width independently of albedo.
    // Rough coating lowers the peak and sends some light outside that peak.
    const pixels = new Float32Array(256 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
      const value = Math.abs((x + .5) / 256 - .75) < .011 ? 1 : .01;
      pixels.set([value, value, value, 1], (y * 256 + x) * 4);
    }
    const stripe = new T.DataTexture(pixels, 256, 128, T.RGBAFormat, T.FloatType);
    stripe.minFilter = stripe.magFilter = T.LinearFilter; stripe.needsUpdate = true;
    uniforms.uEnvironment.value = stripe;
    coat.image.data[0] = 0; coat.needsUpdate = true;
    const sharpPeak = read(0, .006), sharpSide = read(12, .006);
    coat.image.data[2] = .35; coat.needsUpdate = true;
    const roughPeak = read(0, .006), roughSide = read(12, .006);
    // A live source must be affected by the same silver coverage and tarnish
    // as the environment. This catches a video layer pasted over the finish.
    const liveSource = new T.DataTexture(new Float32Array([0, 0, 0, 1]), 1, 1, T.RGBAFormat, T.FloatType);
    liveSource.needsUpdate = true;
    env.image.data.set([.5, .5, .5, 1]); env.needsUpdate = true;
    uniforms.uVideo.value = liveSource; uniforms.uEnvironment.value = env;
    uniforms.uLive.value = 1; uniforms.uCameraIntegration.value = spec.cameraIntegration;
    uniforms.uCameraExposure.value = spec.cameraExposure; uniforms.uStudioStrength.value = 1;
    const liveResponse = (loss: number, tarnish: number, roughness = .05) => {
      coat.image.data.set([loss, tarnish, roughness, 0]); coat.needsUpdate = true;
      liveSource.image.data.set([0, 0, 0, 1]); liveSource.needsUpdate = true;
      const dark = read(0, .006);
      liveSource.image.data.set([1, 1, 1, 1]); liveSource.needsUpdate = true;
      const light = read(0, .006);
      return light.map((value: number, channel: number) => value - dark[channel]);
    };
    const intactResponse = liveResponse(0, 0);
    const tarnishedResponse = liveResponse(0, 1);
    const lostResponse = liveResponse(1, 0);
    const scatteredResponse = liveResponse(0, 0, .35);
    material.dispose(); target.dispose(); env.dispose(); coat.dispose(); surface.dispose(); stripe.dispose(); liveSource.dispose(); renderer.dispose();
    return { glass, chrome, polishedFace, lostSilver, unlitBacking, sharpPeak, sharpSide, roughPeak, roughSide, intactResponse, tarnishedResponse, lostResponse, scatteredResponse };
  }, { inputs: cases, spec: MIRROR });

  cases.forEach((input, index) => {
    const theta = input.angle * Math.PI / 180;
    const transmitted = Math.asin(Math.sin(theta) / MIRROR.glassIOR);
    const cosI = Math.cos(theta), cosT = Math.cos(transmitted), n = MIRROR.glassIOR;
    const f = (((cosI - n * cosT) / (cosI + n * cosT)) ** 2
      + ((n * cosI - cosT) / (n * cosI + cosT)) ** 2) / 2;
    input.absorption.forEach((absorption, channel) => {
      const back = input.silver[channel] * Math.exp(-2 * input.thickness * absorption / cosT);
      const expected = .5 * (f + (1 - f) ** 2 * back / (1 - f * back));
      expect(Math.abs(rendered.glass[index][channel] - expected)).toBeLessThan(1.5 / 255);
    });
  });
  const n = [3.1071, 3.1812, 2.323], k = [3.3314, 3.3291, 3.135];
  n.forEach((eta, channel) => {
    const expected = .5 * ((eta - 1) ** 2 + k[channel] ** 2) / ((eta + 1) ** 2 + k[channel] ** 2);
    expect(Math.abs(rendered.chrome[channel] - expected)).toBeLessThan(1.5 / 255);
    // The interior and frame use the same conductor response. Their deliberate
    // finish blend must stay energy-bounded even when studio grading is off.
    const blended = expected * MIRROR.faceMetalness + rendered.glass[1][channel] * (1 - MIRROR.faceMetalness);
    expect(Math.abs(rendered.polishedFace[channel] - blended)).toBeLessThan(2 / 255);
    expect(rendered.polishedFace[channel]).toBeLessThanOrEqual(.5);
    expect(rendered.lostSilver[channel]).toBeGreaterThan(.015);
    expect(rendered.lostSilver[channel]).toBeLessThan(.04);
    expect(rendered.unlitBacking[channel]).toBeLessThanOrEqual(1 / 255);
    expect(rendered.roughPeak[channel]).toBeLessThan(rendered.sharpPeak[channel] * .6);
    expect(rendered.roughSide[channel]).toBeGreaterThan(rendered.sharpSide[channel] + .05);
    expect(rendered.intactResponse[channel]).toBeGreaterThan(.08);
    expect(rendered.intactResponse[channel]).toBeLessThan(.3);
    expect(rendered.tarnishedResponse[channel]).toBeLessThan(rendered.intactResponse[channel] * .8);
    expect(rendered.lostResponse[channel]).toBeLessThan(rendered.intactResponse[channel] * .12);
    expect(rendered.lostResponse[channel]).toBeGreaterThan(0);
    // Broad scattering retains far less resolved camera contrast than polish,
    // even at identical silver coverage and albedo. It is not a uniform filter.
    expect(rendered.scatteredResponse[channel]).toBeLessThan(rendered.intactResponse[channel] * .5);
    expect(rendered.scatteredResponse[channel]).toBeGreaterThan(rendered.lostResponse[channel]);
  });
});

test('camera reflection mipmaps average decoded linear light, with no second display transform', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const threePath = '/node_modules/three/build/three.module.js';
    const radiancePath = '/src/mirror/CameraRadiance.ts';
    const T = await import(threePath);
    const { CameraRadiance } = await import(radiancePath);
    const renderer = new T.WebGLRenderer();
    renderer.toneMapping = T.NeutralToneMapping;
    const radiance = new CameraRadiance();
    const data = new Uint8Array(32 * 32 * 4);
    const source = new T.DataTexture(data, 32, 32);
    source.magFilter = source.minFilter = T.NearestFilter;
    const target = new T.WebGLRenderTarget(1, 1, { type: T.FloatType });
    const material = new T.ShaderMaterial({
      uniforms: { source: { value: radiance.texture }, lod: { value: 0 } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D source; uniform float lod; void main() { gl_FragColor = textureLod(source, vec2(.5), lod); }',
      toneMapped: false,
    });
    const geometry = new T.PlaneGeometry(2, 2), scene = new T.Scene(), camera = new T.Camera();
    const quad = new T.Mesh(geometry, material); quad.frustumCulled = false; scene.add(quad);
    const read = (checker: boolean, lod: number) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const v = checker ? ((x + y) % 2) * 255 : 128;
        data.set([v, v, v, 255], (y * 32 + x) * 4);
      }
      source.needsUpdate = true;
      // Ensure a pending shadow update survives the camera-only prepass.
      renderer.shadowMap.needsUpdate = true;
      radiance.render(renderer, source, 32, 32);
      const shadowPending = renderer.shadowMap.needsUpdate;
      material.uniforms.lod.value = lod;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixel = new Float32Array(4); renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
      return { value: pixel[0], shadowPending };
    };
    const gray = read(false, 0), checker = read(true, 3);
    radiance.dispose(); source.dispose(); target.dispose(); material.dispose(); geometry.dispose(); renderer.dispose();
    return { gray, checker };
  });
  const grayLinear = ((128 / 255 + .055) / 1.055) ** 2.4;
  expect(result.gray.value).toBeCloseTo(grayLinear + .04, 3);
  // Black is zero and white is 1.04 before display mapping; their average is
  // .52, not the decoded midgray (.256). This detects sRGB-space mip filtering.
  expect(result.checker.value).toBeCloseTo(.52, 3);
  expect(result.gray.shadowPending && result.checker.shadowPending).toBe(true);
});
