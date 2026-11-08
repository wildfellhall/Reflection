// Development-only visual QA. Uses a public reference photograph as fake media.
// Supply an absolute/local PNG path; no physical camera is accessed.
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
const input = process.argv[2] ?? 'artifacts/portrait-reference.png';
const gain = Number(process.argv[3] ?? 1);
const prefix = process.argv[4] ?? 'material';
if (!Number.isFinite(gain) || gain <= 0) throw new Error('Camera brightness must be positive.');
if (!/^[a-z0-9-]+$/i.test(prefix)) throw new Error('Use a simple artifact filename prefix.');
if (!existsSync(input)) throw new Error('Pass a local photographic test PNG as the first argument.');
const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(localChrome) ? localChrome : undefined), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', error => { throw error; });
const errors = [];
page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
await page.addInitScript(({ source, gain }) => {
  navigator.permissions.query = () => Promise.resolve({ state: 'prompt' });
  navigator.mediaDevices.getUserMedia = async () => {
    await new Promise(resolve => { window.releaseTestCamera = resolve; });
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 960;
    const ctx = canvas.getContext('2d');
    ctx.filter = `brightness(${gain})`;
    const img = new Image(); img.src = source; await img.decode();
    const draw = () => {
      const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
      ctx.drawImage(img, (canvas.width - img.width * scale) / 2, (canvas.height - img.height * scale) / 2, img.width * scale, img.height * scale);
    };
    draw(); setInterval(draw, 33); return canvas.captureStream(30);
  };
}, { source: 'data:image/png;base64,' + readFileSync(input).toString('base64'), gain });
await page.goto(process.env.REFLECTION_URL ?? 'http://127.0.0.1:5173');
await page.waitForSelector('canvas[data-environment="ready"]');
await page.screenshot({ path: `artifacts/${prefix}-preview.png` });
await page.evaluate(() => window.releaseTestCamera());
await page.waitForFunction(() => document.body.dataset.camera === 'live');
await page.locator('video').evaluate(video => new Promise(resolve => video.requestVideoFrameCallback(() => resolve())));
await page.screenshot({ path: `artifacts/${prefix}-portrait.png` });
await page.mouse.move(1060, 220);
await page.evaluate(async () => {
  for (let i = 0; i < 35; i++) await new Promise(resolve => requestAnimationFrame(resolve));
});
await page.screenshot({ path: `artifacts/${prefix}-tilted.png` });
await page.mouse.move(-1, -1);
await page.evaluate(async () => {
  for (let i = 0; i < 35; i++) await new Promise(resolve => requestAnimationFrame(resolve));
});
await page.setViewportSize({ width: 390, height: 844 });
// Allow resized WebGL and CSS background layers to complete their next paints.
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
await page.screenshot({ path: `artifacts/${prefix}-mobile.png` });
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
console.log('Saved preview, photographic reflection, tilted material, and mobile screenshots to artifacts/.');
