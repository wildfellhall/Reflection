// Use the photographed woven center of the same public-domain handkerchief
// as the lace. Retain the real yarn/fiber relief, neutralize uneven capture
// lighting, and recolor the cloth to the page's blush pink.
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
    const width = 300, height = 240;
    const tile = document.createElement('canvas'); tile.width = width; tile.height = height;
    const ctx = tile.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(photo, 425, 490, width, height, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const luminance = new Float32Array(width * height);
    const horizontal = new Float32Array(width * height);
    for (let i = 0; i < luminance.length; i++) {
      luminance[i] = (pixels.data[i * 4] * .2126 + pixels.data[i * 4 + 1] * .7152 + pixels.data[i * 4 + 2] * .0722) / 255;
    }
    // Remove only broad photographic shading. Thread crossings, fine fibers
    // and small irregularities remain in the local reflectance variation.
    const radius = 4;
    const clamp = (x, max) => Math.max(0, Math.min(max, x));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += luminance[y * width + clamp(x + k, width - 1)];
      horizontal[y * width + x] = sum / (2 * radius + 1);
    }
    const blush = [238, 219, 221];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += horizontal[clamp(y + k, height - 1) * width + x];
      const broad = sum / (2 * radius + 1), i = y * width + x;
      const detail = (luminance[i] - broad) / Math.max(.1, broad);
      const threadShading = 1 + Math.tanh(detail * 9) * .05;
      for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = Math.min(255, blush[c] * threadShading);
      pixels.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    // Reflected repeats meet on matching pixels on every side of the tile.
    const cloth = document.createElement('canvas'); cloth.width = width * 2; cloth.height = height * 2;
    const out = cloth.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      out.save(); out.translate(x ? width * 2 : 0, y ? height * 2 : 0);
      out.scale(x ? -1 : 1, y ? -1 : 1); out.drawImage(tile, 0, 0); out.restore();
    }
    return cloth.toDataURL('image/png').split(',')[1];
  }, 'data:image/jpeg;base64,' + readFileSync('public/textiles/honiton-lace.jpg').toString('base64'));
  writeFileSync('public/textiles/blush-woven-cloth.png', Buffer.from(result, 'base64'));
  console.log('Built blush cloth from the photographed weave.');
} finally { await browser.close(); }
