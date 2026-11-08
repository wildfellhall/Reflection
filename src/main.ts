import './style.css';
import { MirrorRenderer } from './mirror/MirrorRenderer';
import { MirrorCamera, type CameraState } from './camera';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main aria-label="Mirror" aria-keyshortcuts="Escape">
    <div class="lace-border" aria-hidden="true">
      <div class="lace-edge lace-top"></div><div class="lace-edge lace-right"></div>
      <div class="lace-edge lace-bottom"></div><div class="lace-edge lace-left"></div>
    </div>
    <div id="mirror-stage"></div>
    <div id="camera-prompt">
      <button id="enable-camera" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="m8 6 1.5-3h5L16 6"/><circle cx="12" cy="13" r="3.5"/></svg>
        <span>Enable camera</span>
      </button>
      <p id="camera-message" role="status" hidden></p>
    </div>
    <span id="camera-status" class="visually-hidden" role="status" aria-live="polite"></span>
  </main>
`;

const prompt = document.querySelector<HTMLDivElement>('#camera-prompt')!;
const button = document.querySelector<HTMLButtonElement>('#enable-camera')!;
const label = button.querySelector('span')!;
const message = document.querySelector<HTMLParagraphElement>('#camera-message')!;
const status = document.querySelector<HTMLSpanElement>('#camera-status')!;
let renderer: MirrorRenderer | undefined;
let camera: MirrorCamera | undefined;
let cameraState: CameraState = 'off';

function showMessage(text = '') {
  message.textContent = text;
  message.hidden = !text;
}

function updateState(state: CameraState, explanation?: string) {
  cameraState = state;
  document.body.dataset.camera = state;
  prompt.hidden = state === 'live' && !explanation;
  button.hidden = state === 'live';
  button.classList.toggle('connecting', state === 'requesting');
  label.textContent = state === 'requesting' ? 'Cancel' : state === 'error' ? 'Try again' : 'Enable camera';
  showMessage(explanation);
  status.textContent = state === 'live' ? 'Camera active. Press Escape to stop the camera.'
    : state === 'requesting' ? 'Allow camera access in your browser.' : 'Camera off.';
}

try {
  renderer = new MirrorRenderer(document.querySelector<HTMLDivElement>('#mirror-stage')!, lost => {
    if (lost) {
      camera?.stop();
      button.disabled = true;
      showMessage('Restoring the mirror…');
    } else {
      button.disabled = false;
      showMessage();
    }
  });
  camera = new MirrorCamera({
    state: updateState,
    video: video => renderer?.setVideo(video),
    dimensions: (width, height) => renderer?.setVideoSize(width, height),
  });
  // Returning visitors who already granted permission go straight to the mirror.
  navigator.permissions?.query({ name: 'camera' as PermissionName }).then(permission => {
    if (permission.state === 'granted' && cameraState === 'off') void camera?.start();
  }).catch(() => { /* Browsers without camera permission queries use the button. */ });
} catch (error) {
  console.error('Mirror initialization failed:', error);
  renderer?.dispose();
  button.hidden = true;
  showMessage('This mirror needs WebGL 2. Enable graphics acceleration in your browser, then reload.');
}

button.addEventListener('click', () => {
  if (cameraState === 'requesting') camera?.stop();
  else void camera?.start();
});

const stopOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    camera?.stop();
    button.focus({ preventScroll: true });
  }
};
const stopOnLeave = () => camera?.stop();
document.addEventListener('keydown', stopOnEscape);
window.addEventListener('pagehide', stopOnLeave);
if (import.meta.hot) import.meta.hot.dispose(() => {
  document.removeEventListener('keydown', stopOnEscape);
  window.removeEventListener('pagehide', stopOnLeave);
  camera?.dispose();
  renderer?.dispose();
});
