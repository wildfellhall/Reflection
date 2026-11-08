import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/** Captured environment used by the glass and the gold's prefiltered lighting. */
export class MirrorEnvironment {
  texture: THREE.DataTexture;
  readonly ready: Promise<THREE.DataTexture>;
  private disposed = false;

  constructor() {
    // Neutral low-frequency fallback, used only while the local HDR is loading.
    this.texture = new THREE.DataTexture(new Float32Array([.18, .19, .2, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.needsUpdate = true;
    this.ready = new HDRLoader().loadAsync('/environment/solitude-interior.hdr').then(texture => {
      if (this.disposed) { texture.dispose(); return texture; }
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      this.texture.dispose();
      this.texture = texture;
      return texture;
    });
  }

  dispose() { this.disposed = true; this.texture.dispose(); }
}
