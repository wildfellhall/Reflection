// Visual QA with a bundled public-domain fixture, never a physical camera.
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined), headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const settle = () => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => requestAnimationFrame(resolve));
});
page.on('pageerror', error => errors.push(error.message));
page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
await page.addInitScript(source => {
  navigator.permissions.query = () => Promise.resolve({ state: 'prompt' });
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 960;
    const context = canvas.getContext('2d'), image = new Image(); image.src = source; await image.decode();
    const draw = () => context.drawImage(image, -120, 0, 960, 960);
    draw(); setInterval(draw, 90); return canvas.captureStream(10);
  };
}, 'data:image/png;base64,' + readFileSync('tests/fixtures/expression-portrait.png').toString('base64'));
try {
  await page.goto(process.env.REFLECTION_URL ?? 'http://127.0.0.1:5173');
  await page.waitForSelector('canvas[data-environment="ready"]');
  await page.waitForSelector('.reflection-note:not([hidden])', { timeout: 28000 });
  const status = await page.locator('#expression-status').textContent();
  if (!status.includes('suggested by expression cues')) throw new Error(status);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'artifacts/reflection-writing.png' });
  await page.screenshot({ path: 'artifacts/vanity-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  await page.screenshot({ path: 'artifacts/reflection-mobile.png' });
  await page.screenshot({ path: 'artifacts/vanity-mobile.png' });
  await page.getByRole('textbox').fill('A good society needs room for lives it cannot measure.');
  await settle();
  await page.screenshot({ path: 'artifacts/reflection-mobile-writing.png' });
  await page.locator('#mirror-stage').click({ position: { x: 195, y: 180 } });
  await page.evaluate(() => {
    const animation = document.querySelector('.reflection-note').getAnimations().find(animation => animation.playState === 'running');
    if (!animation) throw new Error('The offering animation did not start.');
    animation.pause(); animation.currentTime = 650;
  });
  await settle();
  await page.screenshot({ path: 'artifacts/reflection-sending.png' });
  await page.evaluate(() => document.querySelector('.reflection-note').getAnimations().forEach(animation => animation.play()));
  await page.waitForSelector('.reflection-note', { state: 'hidden' });
  await settle();
  await page.screenshot({ path: 'artifacts/reflection-sent.png' });
  await page.reload();
  await page.waitForSelector('canvas[data-environment="ready"]');
  if (await page.locator('.reflection-note').isVisible()) throw new Error('A sent session reopened its writing note.');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Verified expression inference, writing and the send animation; saved desktop/mobile previews.');
} finally { await browser.close(); }
