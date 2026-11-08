import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

test.beforeEach(async ({ page }) => {
  // Show the explicit camera gesture, while Chrome supplies a fake camera.
  await page.addInitScript(() => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = descriptor => descriptor.name === 'camera'
      ? Promise.resolve({ state: 'prompt' } as PermissionStatus) : query(descriptor);
  });
});

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveAttribute('data-environment', 'ready');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-camera', 'live');
}

async function glassMetrics(page: Page) {
  return page.locator('canvas').evaluate(canvas => ({
    cx: canvas.clientWidth / 2,
    cy: Number(canvas.dataset.glassCenterY),
    height: Number(canvas.dataset.glassHeight),
  }));
}

test('only the mirror and permission gesture are visible before camera access', async ({ page }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error' || event.type() === 'warning') errors.push(event.text()); });
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5173/')) externalRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('canvas')).toHaveAttribute('data-environment', 'ready');
  await expect(page.locator('button:visible')).toHaveCount(1);
  await expect(page.locator('h1,h2,header,footer,aside,select,input')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/mirror-desktop.png' });
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('native media startup leaves only the mirror; Escape releases every track', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
  await start(page);
  await expect(page.locator('#camera-prompt')).toBeHidden();
  await expect(page.locator('button:visible')).toHaveCount(0);
  expect(await page.locator('video').evaluate(video => {
    const stream = video.srcObject as MediaStream;
    (window as any).testTracks = stream.getTracks();
    return { audio: stream.getAudioTracks().length, width: video.videoWidth, height: video.videoHeight };
  })).toMatchObject({ audio: 0, width: 1920, height: 1080 });
  await page.screenshot({ path: 'artifacts/mirror-camera.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).testTracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull();
  expect(errors).toEqual([]);
});

test('denied camera access gives a recoverable message', async ({ page }) => {
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let first = true;
    navigator.mediaDevices.getUserMedia = constraints => {
      if (first) { first = false; return Promise.reject(new DOMException('Denied', 'NotAllowedError')); }
      return getUserMedia(constraints);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.locator('#camera-message')).toContainText('Camera access is blocked');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('#camera-prompt')).toBeHidden();
});

test('cancelling a pending permission request stops a late-arriving stream', async ({ page }) => {
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => new Promise(resolve => {
      (window as any).resolveCamera = async () => {
        const stream = await getUserMedia(constraints);
        (window as any).lateTracks = stream.getTracks();
        resolve(stream);
      };
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => (window as any).resolveCamera());
  await expect.poll(() => page.evaluate(() => (window as any).lateTracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-camera', 'off');
});

test('the subdued camera contribution remains horizontally mirrored and undistorted', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d')!;
      (window as any).showCalibration = false;
      const draw = () => {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1280, 720);
        if ((window as any).calibrationWhite) {
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1280, 720); return;
        }
        if (!(window as any).showCalibration) return;
        ctx.fillStyle = '#fff';
        ctx.fillRect(600, 320, 80, 80);
        ctx.fillRect(400, 300, 80, 120);
      };
      draw();
      setInterval(draw, 33);
      return canvas.captureStream(30);
    };
  });
  await start(page);
  const settleVideo = () => page.locator('video').evaluate(async video => {
    for (let frame = 0; frame < 3; frame++) await new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));
  });
  await settleVideo();
  const baseline = PNG.sync.read(await page.locator('canvas').screenshot());
  await page.evaluate(() => { (window as any).showCalibration = true; });
  await settleVideo();
  const buffer = await page.locator('canvas').screenshot({ path: 'artifacts/mirror-calibration.png' });
  const png = PNG.sync.read(buffer);
  await page.evaluate(() => { (window as any).calibrationWhite = true; });
  await settleVideo();
  const white = PNG.sync.read(await page.locator('canvas').screenshot());
  const { cx, cy, height } = await glassMetrics(page);
  // Subtract the neutral capture to isolate the live signal from intentionally
  // dominant studio reflections. Source-color fidelity is no longer the style.
  const pixel = (x: number, y: number) => {
    const offset = (Math.round(y) * png.width + Math.round(x)) * 4;
    return [0, 1, 2].map(channel => png.data[offset + channel] - baseline.data[offset + channel]);
  };
  // A white marker to the left of the source must appear on the right. Use
  // luminance, since saturated camera colors are intentionally suppressed.
  const dark = pixel(cx - height * (200 / 720), cy);
  const light = pixel(cx + height * (200 / 720), cy);
  expect(Math.abs(dark.reduce((sum, value) => sum + value, 0) / 3)).toBeLessThan(1);
  expect(light.reduce((sum, value) => sum + value, 0) / 3).toBeGreaterThan(3);
  let minX = Infinity, maxX = 0, minY = Infinity, maxY = 0;
  for (let y = cy - height * .15 | 0; y < cy + height * .15; y++) {
    for (let x = cx - height * .15 | 0; x < cx + height * .15; x++) {
      const delta = pixel(x, y).reduce((sum, value) => sum + value, 0) / 3;
      const offset = (Math.round(y) * white.width + Math.round(x)) * 4;
      const response = [0, 1, 2].reduce((sum, channel) => sum + white.data[offset + channel] - baseline.data[offset + channel], 0) / 3;
      // Half-response edges measure projection, excluding the new roughness
      // lobe's faint tails and accounting for local material/lighting gain.
      if (response > 1 && delta > response * .5) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  expect(maxX - minX).toBeGreaterThan(height * .075);
  expect(Math.abs((maxX - minX) / (maxY - minY) - 1)).toBeLessThan(.035);
});

test('mobile portrait and landscape have no overflow or visible interface during use', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect(await page.locator('.lace-border').evaluate(lace => {
    const bounds = lace.getBoundingClientRect();
    return bounds.left < 0 && bounds.top < 0 && bounds.right > innerWidth && bounds.bottom > innerHeight;
  })).toBe(true);
  await expect(page.locator('#camera-prompt')).toBeHidden();
  await page.screenshot({ path: 'artifacts/mirror-mobile.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: 'artifacts/mirror-landscape.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('WebGL failure offers an explanation without requesting a camera', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (id: string, ...args: any[]) {
      if (id === 'webgl2' || id === 'webgl') return null;
      return (getContext as any).call(this, id, ...args);
    } as typeof getContext;
  });
  await page.goto('/');
  await expect(page.locator('#camera-message')).toContainText('needs WebGL 2');
  await expect(page.locator('button:visible')).toHaveCount(0);
});

test('previously granted camera permission opens directly to the reflection', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.permissions.query = () => Promise.resolve({ state: 'granted' } as PermissionStatus);
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-camera', 'live');
  await expect(page.locator('#camera-prompt')).toBeHidden();
});

test('a lost graphics context stops capture and recovers the mirror', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_lose_context')!;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 250);
  });
  await expect(page.locator('body')).toHaveAttribute('data-camera', 'off');
  await expect(page.locator('#enable-camera')).toBeEnabled();
  await expect(page.locator('#camera-message')).toBeHidden();
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.locator('#camera-prompt')).toBeHidden();
});

test('restrained live detail preserves metallic lighting and source changes stay local', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d')!;
      (window as any).lightTest = { background: 0, highlight: false };
      const draw = () => {
        const { background, highlight } = (window as any).lightTest;
        ctx.fillStyle = `rgb(${background},${background},${background})`;
        ctx.fillRect(0, 0, 1280, 720);
        if (highlight) { ctx.fillStyle = '#ffffff'; ctx.fillRect(600, 320, 80, 80); }
      };
      draw(); setInterval(draw, 33);
      return canvas.captureStream(30);
    };
  });
  const settleVideo = () => page.locator('video').evaluate(async video => {
    for (let frame = 0; frame < 3; frame++) await new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));
  });
  const luminance = (png: PNG, x: number, y: number) => {
    const offset = (Math.round(y) * png.width + Math.round(x)) * 4;
    return png.data[offset] * .2126 + png.data[offset + 1] * .7152 + png.data[offset + 2] * .0722;
  };
  await start(page);
  await settleVideo();
  const { cx, cy, height } = await glassMetrics(page);
  const before = PNG.sync.read(await page.locator('canvas').screenshot());
  await page.evaluate(() => { (window as any).lightTest.background = 255; });
  await settleVideo();
  const bright = PNG.sync.read(await page.locator('canvas').screenshot({ path: 'artifacts/mirror-live-glass.png' }));
  // A full 255-step camera change should produce a readable but subordinate
  // response: roughly 12–35% of that range through the middle of the pane.
  // This is an art-direction regression bound, separate from optical physics.
  const deltas: number[] = [];
  for (let y = -.20; y <= .20; y += .05) {
    for (let x = -.24; x <= .24; x += .04) {
      const delta = luminance(bright, cx + x * height, cy + y * height)
        - luminance(before, cx + x * height, cy + y * height);
      deltas.push(delta);
    }
  }
  deltas.sort((a, b) => a - b);
  expect(deltas[Math.floor(deltas.length / 2)]).toBeGreaterThan(30);
  expect(deltas[Math.floor(deltas.length / 2)]).toBeLessThan(90);
  expect(Math.max(...deltas)).toBeLessThan(130);
  await page.evaluate(() => { (window as any).lightTest.background = 128; });
  await settleVideo();
  const midtone = PNG.sync.read(await page.locator('canvas').screenshot());
  const captures = [midtone, bright].map(capture => {
    const values: number[] = [];
    for (let y = -.20; y <= .20; y += .05) for (let x = -.24; x <= .24; x += .04)
      values.push(luminance(capture, cx + x * height, cy + y * height));
    return values;
  });
  // The same metallic lighting structure must remain in both midtones and
  // highlights. A plain camera rectangle would make these fields uniform.
  for (const values of captures) {
    const sorted = [...values].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * .9)] - sorted[Math.floor(sorted.length * .1)]).toBeGreaterThan(15);
  }
  const centered = captures.map(values => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.map(value => value - mean);
  });
  const covariance = centered[0].reduce((sum, value, i) => sum + value * centered[1][i], 0);
  const variance = centered.map(values => values.reduce((sum, value) => sum + value * value, 0));
  expect(covariance / Math.sqrt(variance[0] * variance[1])).toBeGreaterThan(.95);
  await page.evaluate(() => { (window as any).lightTest = { background: 0, highlight: true }; });
  await settleVideo();
  const after = PNG.sync.read(await page.locator('canvas').screenshot({ path: 'artifacts/mirror-light-spread.png' }));
  // The source square extends 40/720 pane-heights from the center. Sample beyond it.
  let spread = 0, count = 0;
  for (let y = cy - height * .02; y <= cy + height * .02; y += 2) {
    for (let x = cx + height * .09; x <= cx + height * .11; x += 2) {
      spread += luminance(after, x, y) - luminance(before, x, y);
      count++;
    }
  }
  expect(Math.abs(spread / count)).toBeLessThan(1);
  const cameraContrast = luminance(after, cx, cy) - luminance(before, cx, cy);
  const uniformContrast = luminance(bright, cx, cy) - luminance(before, cx, cy);
  // The center lies in an environmental glint. It deliberately reserves more
  // light for silver, but a small source feature must retain most of the local
  // response to a full white field (rather than becoming a blurred gray patch).
  expect(cameraContrast).toBeGreaterThan(10);
  expect(cameraContrast / uniformContrast).toBeGreaterThan(.7);
  expect(uniformContrast).toBeLessThan(deltas[Math.floor(deltas.length / 2)] * .65);
  expect(cameraContrast).toBeLessThan(100);
  // An unrelated dark area must not brighten when the source highlight appears.
  expect(Math.abs(luminance(after, cx + height * .22, cy + height * .20) - luminance(before, cx + height * .22, cy + height * .20))).toBeLessThan(2);
});
