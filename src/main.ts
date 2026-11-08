import './style.css';
import { MirrorRenderer } from './mirror/MirrorRenderer';
import { MirrorCamera, type CameraState } from './camera';
import { ReflectionPanel } from './reflection/ReflectionPanel';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main aria-label="Mirror" aria-keyshortcuts="Escape Enter">
    <div class="lace-border" aria-hidden="true">
      <div class="lace-edge lace-top"></div><div class="lace-edge lace-right"></div>
      <div class="lace-edge lace-bottom"></div><div class="lace-edge lace-left"></div>
    </div>
    <div id="mirror-stage" tabindex="0" aria-label="Mirror. Press Escape to stop the camera; Enter to resume."></div>
    <div id="camera-prompt" hidden><p id="camera-message" role="status"></p></div>
    <span id="camera-status" class="visually-hidden" role="status" aria-live="polite"></span>
  </main>
`;

const host = document.querySelector('main')!;
const stage = document.querySelector<HTMLDivElement>('#mirror-stage')!;
const prompt = document.querySelector<HTMLDivElement>('#camera-prompt')!;
const message = document.querySelector<HTMLParagraphElement>('#camera-message')!;
const status = document.querySelector<HTMLSpanElement>('#camera-status')!;
let renderer: MirrorRenderer | undefined;
let camera: MirrorCamera | undefined;
let cameraState: CameraState = 'off';
let graphicsReady = false;
const writing = new ReflectionPanel(host, expression => renderer?.setExpression(expression));

function showMessage(text = '') {
  message.textContent = text; prompt.hidden = !text;
}
function updateState(state: CameraState, explanation?: string) {
  cameraState = state; document.body.dataset.camera = state;
  showMessage(explanation || (state === 'off' ? 'Touch the mirror or press Enter to resume.' : ''));
  if (state === 'error') {
    showMessage(`${explanation} Touch the mirror or press Enter to try again.`);
    writing.cameraUnavailable();
  }
  status.textContent = state === 'live' ? 'Camera active. Expression cues are processed on this device. Press Escape to stop.'
    : state === 'requesting' ? 'Allow camera access in your browser. Press Escape to cancel.' : 'Camera off.';
}

try {
  renderer = new MirrorRenderer(stage, lost => {
    graphicsReady = !lost;
    if (lost) { camera?.stop(); showMessage('Restoring the mirror…'); }
    else showMessage('Touch the mirror or press Enter to resume.');
  });
  graphicsReady = true;
  camera = new MirrorCamera({
    state: updateState,
    video: video => { renderer?.setVideo(video); writing.setVideo(video); },
    dimensions: (width, height) => renderer?.setVideoSize(width, height),
  });
  // The browser's native permission prompt is the only camera permission UI.
  // Reading starts automatically from the same stream used by the mirror.
  void camera.start();
} catch (error) {
  console.error('Mirror initialization failed:', error);
  renderer?.dispose(); graphicsReady = false;
  showMessage('This mirror needs WebGL 2. Enable graphics acceleration in your browser, then reload.');
  writing.cameraUnavailable();
}

const resume = () => {
  if (graphicsReady && cameraState !== 'live' && cameraState !== 'requesting') void camera?.start();
};
const touchMirror = () => { if (writing.canSend) void writing.send(); else resume(); };
const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') camera?.stop();
  else if (event.key === 'Enter' && event.target === stage && writing.canSend) { event.preventDefault(); void writing.send(); }
  else if (event.key === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest('textarea,input,a,[contenteditable]'))) resume();
};
const stopOnLeave = () => camera?.stop();
stage.addEventListener('click', touchMirror);
document.addEventListener('keydown', onKey);
window.addEventListener('pagehide', stopOnLeave);
if (import.meta.hot) import.meta.hot.dispose(() => {
  stage.removeEventListener('click', touchMirror);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('pagehide', stopOnLeave);
  camera?.dispose(); renderer?.dispose(); writing.dispose();
});
