// Derive a repeatable trim from the actual textile photograph. No drawn or
// generated lace: the inner contour is the photographed leaf-and-thread edge.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chrome) ? chrome : undefined),
  headless: true,
});
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async source => {
    const photo = new Image(); photo.src = source; await photo.decode();
    const tile = document.createElement('canvas'); tile.width = 1040; tile.height = 220;
    const ctx = tile.getContext('2d', { willReadFrequently: true });
    // Turn the real OUTER edge inward. Cut edges are beyond the viewport.
    ctx.translate(0, 220); ctx.scale(1, -1);
    ctx.drawImage(photo, 80, 0, 1040, 220, 0, 0, 1040, 220);
    const pixels = ctx.getImageData(0, 0, 1040, 220);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const light = (pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722) / 255;
      const alpha = Math.min(1, Math.max(0, (light - .51) / .23));
      // Neutral white yarn, with the photographed fiber shading still present.
      const thread = 233 + 22 * Math.min(1, Math.max(0, (light - .60) / .34));
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = thread;
      pixels.data[i + 3] = Math.round(alpha * 255);
    }
    ctx.putImageData(pixels, 0, 0);
    // A reflected repeat joins identical boundary pixels, without cutting a
    // floral motif at a CSS tile seam or stretching the photographed fibers.
    const strip = document.createElement('canvas'); strip.width = 2080; strip.height = 220;
    const out = strip.getContext('2d');
    out.drawImage(tile, 0, 0); out.translate(2080, 0); out.scale(-1, 1); out.drawImage(tile, 0, 0);
    return strip.toDataURL('image/png').split(',')[1];
  }, 'data:image/jpeg;base64,' + readFileSync('public/textiles/honiton-lace.jpg').toString('base64'));
  writeFileSync('public/textiles/honiton-white-trim.png', Buffer.from(result, 'base64'));
  console.log('Built white trim with the original textile edge and transparent openings.');
} finally { await browser.close(); }
