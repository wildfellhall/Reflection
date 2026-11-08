import * as THREE from 'three';

/** Decode each captured frame once, then build its reflection mip pyramid in
 * linear light. VideoTexture itself has no mipmaps. These levels let polished
 * silver retain detail while scattered returns integrate a wider footprint. */
export class CameraRadiance {
  private target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    stencilBuffer: false,
  });
  private material = new THREE.ShaderMaterial({
    uniforms: { uSource: { value: null as THREE.Texture | null } },
    depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uSource, vUv).rgb;
        // Three uploads video to linear storage; decode its sRGB values once.
        c = mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(vec3(.04045), c));
        // Approximate the inverse neutral-display black offset. This cannot
        // recover clipped HDR or undo the camera's own image processing.
        float minimum = min(min(c.r, c.g), c.b);
        c += minimum < .04 ? .4 * sqrt(minimum) - minimum : .04;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  private geometry = new THREE.PlaneGeometry(2, 2);
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();

  constructor() {
    const quad = new THREE.Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get texture() { return this.target.texture; }

  render(renderer: THREE.WebGLRenderer, source: THREE.Texture, width: number, height: number) {
    const scale = Math.min(1, 1024 / Math.max(width, height, 1));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    this.material.uniforms.uSource.value = source;
    const previous = renderer.getRenderTarget();
    const shadowUpdate = renderer.shadowMap.needsUpdate;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
    // A fullscreen prepass must not consume the sculpture's pending shadow update.
    renderer.shadowMap.needsUpdate = shadowUpdate;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
