import * as THREE from 'three';
import { createFrame, createGlass } from './geometry';
import { createOrnament } from './ornament';
import { createAgedMetal } from './agedMetal';
import { MirrorEnvironment } from './environment';
import { MIRROR } from './spec';
import { mirrorFragment, mirrorVertex } from './shaders';
import { createSurfaceFields } from './surfaceFields';
import { CameraRadiance } from './CameraRadiance';
import { VanityObjects } from './VanityObjects';
import { EXPRESSION_ABSORPTION } from '../reflection/palette';
import type { Expression } from '../reflection/expressions';

export class MirrorRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, .01, 20);
  private group = new THREE.Group();
  private environment: MirrorEnvironment;
  private glass: THREE.ShaderMaterial;
  private environmentTarget?: THREE.WebGLRenderTarget;
  private environmentLoaded = false;
  private videoTexture?: THREE.VideoTexture;
  private cameraRadiance = new CameraRadiance();
  private observer: ResizeObserver;
  private raf = 0;
  private disposed = false;
  private contextLost = false;
  private lastVideoVersion = -1;
  private dirty = true;
  private composition = new THREE.Box3();
  private studioTarget = new THREE.Vector2();
  private emotionTarget = new THREE.Vector3();
  private lastAnimationTime = performance.now();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private placeholder = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  private surfaceFields = createSurfaceFields();
  private vanity = new VanityObjects();

  constructor(private host: HTMLElement, private onContextError: (lost: boolean) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.environment = new MirrorEnvironment();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.domElement.setAttribute('aria-label', 'Victorian gold hand mirror with a carved shell neck, cherub relief and floral filigree and antique silvered glass. Camera is off.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.dataset.environment = 'loading';
    this.host.append(this.renderer.domElement);
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 0, 1.8);
    this.placeholder.needsUpdate = true;

    const uniforms = {
      uVideo: { value: this.placeholder as THREE.Texture },
      uEnvironment: { value: this.environment.texture },
      uBackingMap: { value: this.surfaceFields.backing },
      uGlassMap: { value: this.surfaceFields.glass },
      uMaterialTexel: { value: new THREE.Vector2(1 / this.surfaceFields.width, 1 / this.surfaceFields.height) },
      uLive: { value: 0 },
      uIOR: { value: MIRROR.glassIOR },
      uSize: { value: new THREE.Vector2(MIRROR.width, MIRROR.height) },
      uVideoSize: { value: new THREE.Vector2(1920, 1080) },
      uViewDistance: { value: this.camera.position.z },
      uAbsorption: { value: new THREE.Vector3(...MIRROR.absorption) },
      uEmotionAbsorption: { value: new THREE.Vector3() },
      uSilver: { value: new THREE.Vector3(...MIRROR.silverReflectance) },
      // Johnson & Christy (1974), interpolated at 650/550/450 nm. Three sampled
      // wavelengths are an RGB approximation, not a spectral integration.
      uChromeN: { value: new THREE.Vector3(3.1071, 3.1812, 2.323) },
      uChromeK: { value: new THREE.Vector3(3.3314, 3.3291, 3.135) },
      uEnvironmentRotation: { value: MIRROR.environmentRotation },
      uEnvironmentExposure: { value: MIRROR.environmentExposure },
      uCameraIntegration: { value: MIRROR.cameraIntegration },
      uCameraExposure: { value: MIRROR.cameraExposure },
      uCameraSaturation: { value: MIRROR.cameraSaturation },
      uFaceMetalness: { value: MIRROR.faceMetalness },
      uFaceContour: { value: MIRROR.faceContour },
      uAntique: { value: MIRROR.antique },
      uStudioStrength: { value: MIRROR.studioStrength },
      uStudioShift: { value: new THREE.Vector2() },
      uWorldRotation: { value: new THREE.Matrix3() },
    };
    this.glass = new THREE.ShaderMaterial({
      vertexShader: mirrorVertex, fragmentShader: mirrorFragment,
      uniforms: { ...uniforms, uLayer: { value: 0 } },
    });
    const gold = createAgedMetal('gold');
    const burnished = createAgedMetal('burnished');
    const recess = createAgedMetal('recess');
    const materials = { gold, burnished, recess };
    const ornament = createOrnament();
    const pane = new THREE.Mesh(createGlass(), this.glass);
    pane.castShadow = true;
    this.group.add(pane);
    const frame = new THREE.Mesh(createFrame(), gold);
    frame.castShadow = frame.receiveShadow = true;
    this.group.add(frame);
    for (const finish of ['gold', 'burnished', 'recess'] as const) {
      const mesh = new THREE.Mesh(ornament[finish], materials[finish]);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.scene.add(this.group);
    // Three inverts its environment orientation; our glass rotates lookup rays.
    this.scene.environmentRotation.y = -MIRROR.environmentRotation;
    this.composition.setFromObject(this.group);
    this.scene.add(this.vanity.root);

    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShadowMaterial({ color: '#795660', opacity: .18, depthWrite: false }));
    backdrop.position.set(0, -.05, -.008);
    backdrop.receiveShadow = true;
    this.scene.add(backdrop);
    this.scene.add(new THREE.HemisphereLight('#fff5de', '#85735c', 1.3));
    const key = new THREE.DirectionalLight('#fff4dd', 3.2);
    key.position.set(-.25, .32, .55);
    key.target.position.set(0, -.05, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -.25, right: .25, top: .25, bottom: -.25, near: .1, far: 1.2 });
    key.shadow.bias = -.0001;
    key.shadow.normalBias = .00015;
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight('#e4ecff', .9);
    fill.position.set(.3, -.05, .3);
    this.scene.add(fill);

    this.environment.ready.then(texture => {
      if (this.disposed) return;
      uniforms.uEnvironment.value = texture;
      this.environmentLoaded = true;
      if (!this.contextLost) this.refreshEnvironment();
      this.renderer.domElement.dataset.environment = 'ready';
      this.dirty = true;
    }).catch(() => {
      if (this.disposed) return;
      // The camera still works if the local environment asset cannot be loaded.
      this.renderer.domElement.dataset.environment = 'fallback';
      this.dirty = true;
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.domElement.addEventListener('webglcontextlost', this.loseContext);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.restoreContext);
    document.addEventListener('visibilitychange', this.visibility);
    host.addEventListener('pointermove', this.moveLight);
    host.addEventListener('pointerleave', this.resetLight);
    this.reducedMotion.addEventListener('change', this.resetLight);
    this.resize();
    this.animate();
  }

  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.vanity.arrange(this.camera.aspect);
    this.renderer.shadowMap.needsUpdate = true;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const center = this.composition.getCenter(new THREE.Vector3());
    const size = this.composition.getSize(new THREE.Vector3());
    this.camera.position.set(0, center.y, Math.max(size.y * 1.06 / (2 * Math.tan(fov / 2)), size.x * 1.08 / (2 * Math.tan(fov / 2) * this.camera.aspect)));
    this.camera.lookAt(0, center.y, 0);
    this.camera.updateProjectionMatrix();
    this.glass.uniforms.uViewDistance.value = this.camera.position.z;
    this.renderer.setSize(width, height);
    const glassCenter = new THREE.Vector3(0, 0, MIRROR.glassThickness).project(this.camera);
    this.host.parentElement?.style.setProperty('--mirror-center-y', `${(1 - glassCenter.y) * 50}%`);
    // Projected coordinates keep visual QA tied to the object, not a viewport.
    this.renderer.domElement.dataset.glassCenterY = String((1 - glassCenter.y) * height / 2);
    this.renderer.domElement.dataset.glassHeight = String(MIRROR.height * height / (2 * this.camera.position.z * Math.tan(fov / 2)));
    this.dirty = true;
  }

  private loseContext = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    cancelAnimationFrame(this.raf);
    this.onContextError(true);
  };
  private refreshEnvironment() {
    this.environmentTarget?.dispose();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = generator.fromEquirectangular(this.environment.texture);
    this.scene.environment = this.environmentTarget.texture;
    generator.dispose();
  }
  private restoreContext = () => {
    // The HDR has CPU data; the gold's GPU-generated reflection map must be rebuilt.
    this.contextLost = false;
    this.dirty = true;
    this.lastVideoVersion = -1;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.environmentLoaded) this.refreshEnvironment();
    this.onContextError(false);
    this.animate();
  };
  private visibility = () => {
    cancelAnimationFrame(this.raf);
    if (!document.hidden && !this.contextLost && !this.disposed) {
      this.dirty = true;
      this.animate();
    }
  };
  private moveLight = (event: PointerEvent) => {
    if (this.reducedMotion.matches || event.pointerType === 'touch') return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    const bounds = this.host.getBoundingClientRect();
    this.studioTarget.set(
      THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width - .5, -.5, .5) * .16,
      THREE.MathUtils.clamp(.5 - (event.clientY - bounds.top) / bounds.height, -.5, .5) * .10,
    );
  };
  private resetLight = () => {
    this.studioTarget.set(0, 0);
    if (this.reducedMotion.matches) this.glass.uniforms.uStudioShift.value.set(0, 0);
    this.dirty = true;
  };
  private animate = () => {
    if (this.disposed || this.contextLost) return;
    const now = performance.now(), dt = Math.min((now - this.lastAnimationTime) / 1000, .1);
    this.lastAnimationTime = now;
    const tint = this.glass.uniforms.uEmotionAbsorption.value as THREE.Vector3;
    if (tint.distanceToSquared(this.emotionTarget) > .000001) {
      tint.lerp(this.emotionTarget, this.reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 1.1));
      this.dirty = true;
    }
    const shift = this.glass.uniforms.uStudioShift.value as THREE.Vector2;
    if (shift.distanceToSquared(this.studioTarget) > .00000001) {
      shift.lerp(this.studioTarget, .12);
      this.dirty = true;
    }
    // VideoTexture's frame callback changes its version only on a new capture.
    // Older browsers without that callback use Three's animation-loop update.
    if (this.videoTexture && !('requestVideoFrameCallback' in HTMLVideoElement.prototype)) this.videoTexture.update();
    if (this.dirty || (this.videoTexture && this.videoTexture.version !== this.lastVideoVersion)) {
      if (this.videoTexture && this.videoTexture.version !== this.lastVideoVersion) {
        const size = this.glass.uniforms.uVideoSize.value as THREE.Vector2;
        this.cameraRadiance.render(this.renderer, this.videoTexture, size.x, size.y);
      }
      const tiltX = -shift.y * .35, tiltY = shift.x * .35;
      if (this.group.rotation.x !== tiltX || this.group.rotation.y !== tiltY) {
        this.group.rotation.set(tiltX, tiltY, 0);
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.group.updateMatrixWorld(true);
      this.glass.uniforms.uWorldRotation.value.setFromMatrix4(this.group.matrixWorld);
      this.scene.environmentRotation.y = -MIRROR.environmentRotation;
      this.renderer.render(this.scene, this.camera);
      this.lastVideoVersion = this.videoTexture?.version ?? -1;
      this.dirty = false;
    }
    this.raf = requestAnimationFrame(this.animate);
  };

  setExpression(expression: Expression | null) {
    this.emotionTarget.set(...(expression ? EXPRESSION_ABSORPTION[expression] : [0, 0, 0] as const));
    this.dirty = true;
  }

  setVideo(video: HTMLVideoElement | null) {
    this.videoTexture?.dispose();
    this.videoTexture = undefined;
    if (video) {
      this.videoTexture = new THREE.VideoTexture(video);
      this.videoTexture.colorSpace = THREE.SRGBColorSpace;
      this.videoTexture.minFilter = THREE.LinearFilter;
      this.videoTexture.magFilter = THREE.LinearFilter;
      this.glass.uniforms.uVideo.value = this.cameraRadiance.texture;
      this.setVideoSize(video.videoWidth, video.videoHeight);
    } else this.glass.uniforms.uVideo.value = this.placeholder;
    this.glass.uniforms.uLive.value = video ? 1 : 0;
    this.lastVideoVersion = -1;
    this.dirty = true;
    this.renderer.domElement.setAttribute('aria-label', video
      ? 'Live reflection shaped by polished and tarnished silver in a Victorian gold hand mirror with carved shellwork and cherub relief'
      : 'Victorian gold hand mirror with a carved shell neck, cherub relief and floral filigree and antique silvered glass. Camera is off.');
  }

  setVideoSize(width: number, height: number) {
    if (width && height) {
      this.glass.uniforms.uVideoSize.value.set(width, height);
      this.lastVideoVersion = -1;
      this.dirty = true;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.loseContext);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.restoreContext);
    document.removeEventListener('visibilitychange', this.visibility);
    this.host.removeEventListener('pointermove', this.moveLight);
    this.host.removeEventListener('pointerleave', this.resetLight);
    this.reducedMotion.removeEventListener('change', this.resetLight);
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const owned = Array.isArray(object.material) ? object.material : [object.material];
        owned.forEach(material => materials.add(material));
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    materials.forEach(material => material.dispose());
    this.videoTexture?.dispose();
    this.cameraRadiance.dispose();
    this.vanity.dispose();
    this.placeholder.dispose();
    this.surfaceFields.backing.dispose();
    this.surfaceFields.glass.dispose();
    this.environment.dispose();
    this.environmentTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
