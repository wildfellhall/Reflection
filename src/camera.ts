export type CameraState = 'off' | 'requesting' | 'live' | 'error';
export interface CameraEvents {
  state: (state: CameraState, message?: string) => void;
  video: (video: HTMLVideoElement | null) => void;
  dimensions: (width: number, height: number) => void;
}

export class MirrorCamera {
  readonly video = document.createElement('video');
  private stream: MediaStream | null = null;
  private request = 0;

  constructor(private events: CameraEvents) {
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('aria-hidden', 'true');
    // Keeping a small, rendered video element supports camera playback on iOS.
    this.video.className = 'camera-source';
    document.body.append(this.video);
    this.video.addEventListener('resize', this.dimensions);
  }

  async start() {
    this.stop(false);
    const id = ++this.request;
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.setState('error', 'Camera access needs HTTPS or localhost. Open this mirror in a secure browser tab.');
      return;
    }
    this.setState('requesting');
    let acquired: MediaStream | null = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1920 }, height: { ideal: 1080 },
          frameRate: { ideal: 60, max: 60 },
        },
      });
      if (id !== this.request) { acquired.getTracks().forEach(track => track.stop()); return; }
      this.stream = acquired;
      this.video.srcObject = acquired;
      await this.video.play();
      if (id !== this.request) { acquired.getTracks().forEach(track => track.stop()); return; }
      const track = acquired.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (id !== this.request) return;
        this.stop(false);
        this.setState('error', 'The camera disconnected. Reconnect it, then try again.');
      });
      track.addEventListener('mute', () => {
        if (id === this.request) this.events.state('live', 'Camera paused by your device. It will resume when available.');
      });
      track.addEventListener('unmute', () => { if (id === this.request) this.setState('live'); });
      this.events.video(this.video);
      this.dimensions();
      this.setState('live');
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop());
      if (id !== this.request) return;
      this.stop(false);
      const name = error instanceof DOMException ? error.name : '';
      const messages: Record<string, string> = {
        NotAllowedError: 'Camera access is blocked. Allow the camera in your browser’s site settings, then try again.',
        NotFoundError: 'No camera was found. Connect a camera, then try again.',
        NotReadableError: 'Your camera is busy or unavailable. Close other apps using it, then try again.',
        OverconstrainedError: 'Your camera is unavailable. Reconnect it, then try again.',
        SecurityError: 'Your browser has disabled camera access for this page. Check its site settings.',
      };
      this.setState('error', messages[name] ?? 'The camera couldn’t start. Check its connection and browser permissions, then try again.');
    }
  }

  stop(notify = true) {
    ++this.request;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.events.video(null);
    if (notify) this.setState('off');
  }
  private setState(state: CameraState, message?: string) {
    this.events.state(state, message);
  }
  private dimensions = () => this.events.dimensions(this.video.videoWidth, this.video.videoHeight);
  dispose() {
    this.stop(false);
    this.video.removeEventListener('resize', this.dimensions);
    this.video.remove();
  }
}
