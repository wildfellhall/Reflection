import { ExpressionWindow, type Observation, type Reading } from './expressions';

export type ReadResult = { reading: Reading | null; reason: 'matched' | 'uncertain' | 'no-face' | 'multiple' | 'unavailable' | 'cancelled' };
export type ReadProgress = 'loading' | 'observing' | 'no-face' | 'multiple';

/** A bounded, on-demand observation. Terminating the worker releases its model,
 * frames and scores on completion, cancellation, camera stop or tab hiding. */
export function readExpression(video: HTMLVideoElement, signal: AbortSignal,
  progress: (state: ReadProgress) => void): Promise<ReadResult> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve({ reading: null, reason: 'cancelled' }); return; }
    if (typeof Worker === 'undefined' || !video.videoWidth) { resolve({ reading: null, reason: 'unavailable' }); return; }
    let worker: Worker;
    try { worker = new Worker(new URL('./expression.worker.ts', import.meta.url), { type: 'module' }); }
    catch { resolve({ reading: null, reason: 'unavailable' }); return; }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const window = new ExpressionWindow();
    let done = false, timer = 0, deadline = 0;
    let lastFrameTime = -1;
    let lastReason: ReadResult['reason'] = 'no-face';
    const finish = (result: ReadResult) => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(deadline);
      worker.terminate(); signal.removeEventListener('abort', abort);
      document.removeEventListener('visibilitychange', visibility);
      canvas.width = canvas.height = 0;
      resolve(result);
    };
    const abort = () => finish({ reading: null, reason: 'cancelled' });
    const visibility = () => { if (document.hidden) abort(); };
    signal.addEventListener('abort', abort, { once: true });
    document.addEventListener('visibilitychange', visibility);
    const capture = () => {
      if (done) return;
      if (signal.aborted || document.hidden || video.paused || !video.srcObject) { abort(); return; }
      const track = (video.srcObject as MediaStream).getVideoTracks()[0];
      if (!track || track.readyState !== 'live' || track.muted) { abort(); return; }
      // A frozen camera must not accumulate repeated evidence for a reading.
      if (video.currentTime === lastFrameTime) { timer = self.setTimeout(capture, 420); return; }
      lastFrameTime = video.currentTime;
      try {
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        worker.postMessage({ type: 'frame', buffer: frame.data.buffer, width: canvas.width, height: canvas.height }, [frame.data.buffer]);
      } catch { finish({ reading: null, reason: 'unavailable' }); }
    };
    worker.onmessage = ({ data }) => {
      if (done) return;
      if (data.type === 'ready') {
        clearTimeout(deadline);
        deadline = self.setTimeout(() => finish({ reading: null, reason: lastReason }), 6500);
        progress('observing'); capture();
      } else if (data.type === 'observation') {
        const observation = data.observation as Observation;
        lastReason = observation.faces > 1 ? 'multiple' : observation.faces === 0 ? 'no-face' : 'uncertain';
        progress(lastReason === 'uncertain' ? 'observing' : lastReason);
        const reading = window.add(observation, performance.now());
        if (reading) finish({ reading, reason: 'matched' });
        else timer = self.setTimeout(capture, 420);
      } else if (data.type === 'error') finish({ reading: null, reason: 'unavailable' });
    };
    worker.onerror = event => { event.preventDefault(); finish({ reading: null, reason: 'unavailable' }); };
    deadline = self.setTimeout(() => finish({ reading: null, reason: 'unavailable' }), 20000);
    progress('loading');
    worker.postMessage({ type: 'init', base: new URL(import.meta.env.BASE_URL, location.href).href });
  });
}
