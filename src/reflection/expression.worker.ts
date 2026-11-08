import Human from '@vladmandic/human';
import type { Observation, Scores } from './expressions';

let human: Human | undefined;
let busy = false;
self.onmessage = async (event: MessageEvent) => {
  if (busy) return;
  busy = true;
  try {
    if (event.data.type === 'init') {
      const base = event.data.base as string;
      human = new Human({
        backend: 'wasm', wasmPath: `${base}expression/wasm/`,
        modelBasePath: `${base}expression/models/`,
        cacheModels: false, cacheSensitivity: 0, async: false, warmup: 'none', debug: false,
        filter: { enabled: false, return: false }, gesture: { enabled: false },
        face: {
          enabled: true,
          detector: { enabled: true, rotation: true, maxDetected: 2, minConfidence: .6, minSize: 48, return: false, skipFrames: 0, skipTime: 0 },
          emotion: { enabled: true, minConfidence: 0, skipFrames: 0, skipTime: 0 },
          mesh: { enabled: false }, iris: { enabled: false }, attention: { enabled: false },
          description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false }, gear: { enabled: false },
        },
        body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, segmentation: { enabled: false },
      });
      await human.load();
      if (human.tf.getBackend() !== 'wasm') throw new Error('Expression runtime could not start.');
      self.postMessage({ type: 'ready' });
    } else if (event.data.type === 'frame' && human) {
      const { buffer, width, height } = event.data;
      const input = new ImageData(new Uint8ClampedArray(buffer), width, height);
      const result = await human.detect(input);
      const face = result.face[0];
      const scores: Scores = {};
      if (result.face.length === 1) for (const item of face.emotion ?? []) scores[item.emotion] = item.score;
      const observation: Observation = {
        faces: result.face.length, confidence: face?.boxScore ?? 0,
        size: face ? Math.min(face.box[2], face.box[3]) : 0, scores,
      };
      // Only transient scores cross back to the UI. No image, landmarks,
      // identity descriptor, age or gender result is retained or transmitted.
      self.postMessage({ type: 'observation', observation });
    }
  } catch {
    self.postMessage({ type: 'error' });
  } finally { busy = false; }
};
