import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ExpressionWindow, type Observation } from '../src/reflection/expressions';
import { COMPLETED_PREFIX, SESSION_KEY } from '../src/reflection/ReflectionStore';
import { THEMES, PROMPTS, ALL_PROMPTS, nextPrompt } from '../src/reflection/prompts';

const observation: Observation = { faces: 1, confidence: .95, size: 120, scores: { happy: .85, neutral: .1 } };

test('a prompt theme needs sustained evidence, with margin over competing expressions', () => {
  const stable = new ExpressionWindow();
  for (let i = 0; i < 4; i++) expect(stable.add(observation, i * 450)).toBeNull();
  expect(stable.add(observation, 1800)?.expression).toBe('happy');
  const alternating = new ExpressionWindow(), uncertain = new ExpressionWindow();
  for (let i = 0; i < 14; i++) {
    expect(alternating.add({ ...observation, scores: i % 2 ? { happy: .85, sad: .05 } : { happy: .05, sad: .85 } }, i * 450)).toBeNull();
    expect(uncertain.add({ ...observation, scores: { happy: .4, neutral: .37, surprise: .23 } }, i * 450)).toBeNull();
  }
});

test('missing faces, multiple people and invalid quality reset accumulated evidence', () => {
  for (const invalid of [{ faces: 0 }, { faces: 2 }, { confidence: .5 }, { size: 40 }, { scores: { happy: NaN } }]) {
    const window = new ExpressionWindow();
    for (let i = 0; i < 4; i++) window.add(observation, i * 450);
    expect(window.add({ ...observation, ...invalid }, 1800)).toBeNull();
    expect(window.add(observation, 2250)).toBeNull();
  }
});

test('expression themes offer distinct prompts and a camera-independent open path', () => {
  expect(THEMES.happy).toBe('flourishing'); expect(THEMES.sad).toBe('care');
  expect(THEMES.angry).toBe('justice'); expect(THEMES.fear).toBe('freedom');
  expect(THEMES.disgust).toBe('norms'); expect(THEMES.surprise).toBe('knowledge');
  expect(THEMES.neutral).toBe('identity');
  for (const theme of Object.values(THEMES)) {
    const first = nextPrompt(theme)!, second = nextPrompt(theme, new Set(), first.id)!;
    expect(second).not.toBe(first);
    expect(PROMPTS[theme]).toContain(second);
  }
});

async function fakeCamera(page: Page, photo = false) {
  const source = photo ? 'data:image/png;base64,' + (await readFile('tests/fixtures/expression-portrait.png')).toString('base64') : '';
  await page.addInitScript(source => {
    navigator.permissions.query = () => Promise.resolve({ state: 'prompt' } as PermissionStatus);
    (window as any).cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).cameraCalls++;
      const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 960;
      const context = canvas.getContext('2d')!;
      let image: HTMLImageElement | undefined;
      if (source) { image = new Image(); image.src = source; await image.decode(); }
      const draw = () => {
        context.fillStyle = '#39332c'; context.fillRect(0, 0, 720, 960);
        if (image) context.drawImage(image, -120, 0, 960, 960);
      };
      draw(); setInterval(draw, 90);
      return canvas.captureStream(10);
    };
  }, source);
}

test('automatic prompts and hues stay paired, change with cues, and freeze while writing', async ({ page }) => {
  // Exercise the actual scheduler/UI with deterministic results; the next test
  // separately exercises the real model, worker, image capture and assets.
  await page.route('**/__reflection-fixture', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
  await page.goto('/__reflection-fixture');
  await page.clock.install();
  await page.evaluate(async () => {
    const path = '/src/reflection/ReflectionPanel.ts';
    const { ReflectionPanel } = await import(path);
    const w = window as any;
    w.cue = 'happy'; w.reads = 0; w.hues = [];
    const reader = async () => { w.reads++; return { reading: { expression: w.cue, confidence: .9 }, reason: 'matched' }; };
    w.panel = new ReflectionPanel(document.querySelector('main'), (hue: string) => w.hues.push(hue), reader);
    w.panel.setVideo(document.createElement('video'));
  });
  await page.clock.fastForward(400);
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.flourishing[0].text);
  await expect(page.getByRole('textbox')).not.toBeFocused();
  await expect(page.locator('button,dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).hues.at(-1))).toBe('happy');
  await page.evaluate(() => { (window as any).cue = 'angry'; });
  await page.clock.fastForward(15000);
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.justice[0].text);
  expect(await page.evaluate(() => (window as any).hues.at(-1))).toBe('angry');
  await page.getByRole('textbox').fill('A society must make room for principled disagreement.');
  await page.getByRole('textbox').blur();
  const reads = await page.evaluate(() => (window as any).reads);
  await page.evaluate(() => { (window as any).cue = 'sad'; });
  await page.clock.fastForward(60000);
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.justice[0].text);
  expect(await page.evaluate(() => (window as any).reads)).toBe(reads);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Keep a copy' }).click();
  const download = await downloaded, text = await readFile((await download.path())!, 'utf8');
  expect(text).toContain(PROMPTS.justice[0].text); expect(text).toContain('principled disagreement');
  await page.getByRole('textbox').fill(''); await page.getByRole('textbox').blur();
  await page.clock.fastForward(1500);
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.justice[0].text);
  expect(await page.evaluate(() => (window as any).hues.at(-1))).toBe('angry');
  expect(await page.evaluate(() => (window as any).reads)).toBe(reads);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), SESSION_KEY)).toMatchObject({ promptId: 'justice-001', started: true, sent: false, draft: '' });
});

test('the real local model automatically selects a philosophical prompt from simulated video', async ({ page }) => {
  await fakeCamera(page, true);
  const remote: string[] = [], models = new Set<string>(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    if (!r.url().startsWith('http://127.0.0.1:5173/')) remote.push(r.url());
    if (r.url().includes('/expression/models/')) models.add(new URL(r.url()).pathname.split('/').pop()!);
    if (r.method() === 'POST') remote.push(`POST ${r.url()}`);
  });
  await page.goto('/');
  await expect(page.locator('.reflection-note')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#expression-status')).toContainText('suggested by expression cues');
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.flourishing[0].text);
  await expect(page.locator('button')).toHaveCount(0);
  expect([...models].sort()).toEqual(['blazeface.bin', 'blazeface.json', 'emotion.bin', 'emotion.json']);
  await expect.poll(() => page.workers().length).toBe(0);
  expect(remote).toEqual([]); expect(errors).toEqual([]);
});

test('no face produces an open prompt rather than an invented expression', async ({ page }) => {
  await fakeCamera(page); await page.goto('/');
  await expect(page.locator('.reflection-note')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#expression-status')).toContainText('wasn’t clearly visible');
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.open[0].text);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('Escape cancels automatic analysis and capture; Enter resumes automatically', async ({ page }) => {
  await fakeCamera(page); await page.goto('/');
  await expect.poll(() => page.workers().length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.workers().length).toBe(0);
  await expect(page.locator('body')).toHaveAttribute('data-camera', 'off');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-camera', 'live');
  await expect.poll(() => page.workers().length).toBe(1);
});

test('failed model loading automatically supplies an open prompt and releases the worker', async ({ page }) => {
  await fakeCamera(page, true);
  await page.route('**/expression/models/emotion.json', route => route.abort());
  await page.goto('/');
  await expect(page.locator('.reflection-note')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#expression-status')).toContainText('unavailable');
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.open[0].text);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('the automatic note leaves the mirror visible on narrow screens, including while writing', async ({ page }) => {
  await fakeCamera(page, true); await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.locator('.reflection-note')).toBeVisible({ timeout: 25000 });
  for (const draft of ['', 'Freedom means more than choosing among predetermined options.']) {
    if (draft) await page.getByRole('textbox').fill(draft);
    await expect.poll(() => page.evaluate(() => {
      const note = document.querySelector('.reflection-note')!.getBoundingClientRect();
      const stage = document.querySelector('#mirror-stage')!.getBoundingClientRect();
      return note.left >= 0 && note.right <= innerWidth && note.bottom <= innerHeight
        && stage.bottom <= note.top && stage.height > 250;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
});

test('192 permanent prompt IDs are unique and completion never cycles back', () => {
  expect(ALL_PROMPTS).toHaveLength(192);
  expect(new Set(ALL_PROMPTS.map(prompt => prompt.id)).size).toBe(192);
  expect(new Set(ALL_PROMPTS.map(prompt => prompt.text)).size).toBe(192);
  for (const prompts of Object.values(PROMPTS)) expect(prompts).toHaveLength(24);
  const completed = new Set(PROMPTS.flourishing.map(prompt => prompt.id));
  expect(nextPrompt('flourishing', completed)?.theme).toBe('open');
  completed.add(PROMPTS.open[0].id);
  expect(nextPrompt('flourishing', completed)?.id).toBe(PROMPTS.open[1].id);
  ALL_PROMPTS.forEach(prompt => completed.add(prompt.id));
  expect(nextPrompt('flourishing', completed)).toBeNull();
});

async function sessionFixture(page: Page, cue = 'happy') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/__session-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <link rel="stylesheet" href="/src/style.css"><main><div id="mirror-stage" tabindex="0"><canvas data-glass-center-y="260"></canvas></div></main>
    <script type="module">
      import { ReflectionPanel } from '/src/reflection/ReflectionPanel.ts';
      window.cue = ${JSON.stringify(cue)}; window.reads = 0; window.hues = [];
      const reader = async () => {
        window.reads++;
        if (window.defer) return new Promise(resolve => { window.resolveReading = resolve; });
        return { reading: { expression: window.cue, confidence: .9 }, reason: 'matched' };
      };
      window.panel = new ReflectionPanel(document.querySelector('main'), hue => window.hues.push(hue), reader);
      window.panel.setVideo(document.createElement('video'));
      document.querySelector('#mirror-stage').addEventListener('click', () => window.panel.send());
      window.ready = true;
    </script>` }));
  await page.clock.install();
  await page.goto('/__session-fixture');
  await page.waitForFunction(() => (window as any).ready);
  await page.clock.fastForward(400);
}

test('typing locks the tab across erasure, camera restarts, visibility changes and reloads', async ({ page }) => {
  await sessionFixture(page);
  await page.getByRole('textbox').fill('A thought that can be reconsidered.');
  await page.reload(); await page.waitForFunction(() => (window as any).ready);
  await expect(page.getByRole('textbox')).toHaveValue('A thought that can be reconsidered.');
  await page.getByRole('textbox').fill(''); await page.getByRole('textbox').blur();
  await page.evaluate(() => {
    const w = window as any;
    w.cue = 'sad'; w.panel.setVideo(null); w.panel.setVideo(document.createElement('video'));
    w.panel.cameraUnavailable(); document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(60000);
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.flourishing[0].text);
  expect(await page.evaluate(() => (window as any).reads)).toBe(0);
  await page.reload(); await page.waitForFunction(() => (window as any).ready);
  await page.clock.fastForward(60000);
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.flourishing[0].text);
  await expect(page.getByRole('textbox')).toHaveValue('');
  expect(await page.evaluate(() => (window as any).reads)).toBe(0);
});

test('a late expression result cannot replace a question after the first keystroke', async ({ page }) => {
  await sessionFixture(page);
  await page.evaluate(() => { (window as any).defer = true; });
  await page.clock.fastForward(15000);
  await page.waitForFunction(() => Boolean((window as any).resolveReading));
  await page.getByRole('textbox').fill('Who gets to decide what counts as enough?');
  await page.evaluate(() => (window as any).resolveReading({ reading: { expression: 'angry', confidence: .9 }, reason: 'matched' }));
  await page.clock.fastForward(30000);
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.flourishing[0].text);
  expect(await page.evaluate(() => (window as any).hues.at(-1))).toBe('happy');
});

test('sending clears words, closes this tab session, and retires the question for future tabs', async ({ page, context }) => {
  await sessionFixture(page);
  await page.getByRole('textbox').fill('Shared flourishing needs more than aggregate prosperity.');
  await page.getByRole('textbox').press('Control+Enter');
  await expect(page.locator('.reflection-note')).toBeHidden();
  await expect(page.locator('#expression-status')).toContainText('no more will appear');
  expect(await page.evaluate(key => localStorage.getItem(key), COMPLETED_PREFIX + 'flourishing-001')).toBe('1');
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), SESSION_KEY)).toMatchObject({ sent: true, draft: '' });
  expect(await page.locator('textarea').inputValue()).toBe('');
  expect(await page.evaluate(() => Object.values(localStorage).join(' '))).not.toContain('Shared flourishing');
  await page.reload(); await page.waitForFunction(() => (window as any).ready);
  await page.clock.fastForward(60000);
  await expect(page.locator('.reflection-note')).toBeHidden();
  expect(await page.evaluate(() => (window as any).reads)).toBe(0);
  const nextTab = await context.newPage();
  await sessionFixture(nextTab);
  await expect(nextTab.locator('#writing-prompt')).toHaveText(PROMPTS.flourishing[1].text);
  await nextTab.close();
});

test('completions from different tabs are both preserved', async ({ page, context }) => {
  await sessionFixture(page, 'happy');
  const other = await context.newPage(); await sessionFixture(other, 'sad');
  await page.getByRole('textbox').fill('A good life has room for other people.');
  await other.getByRole('textbox').fill('Care requires more than an audience.');
  await Promise.all([page.getByRole('textbox').press('Control+Enter'), other.getByRole('textbox').press('Control+Enter')]);
  await expect(page.locator('.reflection-note')).toBeHidden(); await expect(other.locator('.reflection-note')).toBeHidden();
  expect(await page.evaluate(prefix => ['flourishing-001', 'care-001'].map(id => localStorage.getItem(prefix + id)), COMPLETED_PREFIX)).toEqual(['1', '1']);
  await other.close();
});

test('unavailable durable storage preserves the response and does not falsely confirm sending', async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage) throw new DOMException('Storage denied', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  await sessionFixture(page);
  await page.getByRole('textbox').fill('Words that should not vanish on failure.');
  await page.getByRole('textbox').press('Control+Enter');
  await expect(page.locator('.reflection-notice')).toContainText('Your words are still here');
  await expect(page.getByRole('textbox')).toHaveValue('Words that should not vanish on failure.');
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), SESSION_KEY)).toMatchObject({ sent: false, draft: 'Words that should not vanish on failure.' });
  await page.getByRole('textbox').blur(); await page.clock.fastForward(60000);
  await expect(page.locator('#writing-prompt')).toHaveText(PROMPTS.flourishing[0].text);
});

test('an exhausted collection leaves the mirror clear instead of repeating a completed question', async ({ page }) => {
  await page.addInitScript(({ ids, prefix }) => { ids.forEach(id => localStorage.setItem(prefix + id, '1')); }, { ids: ALL_PROMPTS.map(prompt => prompt.id), prefix: COMPLETED_PREFIX });
  await sessionFixture(page);
  await expect(page.locator('.reflection-note')).toBeHidden();
  await expect(page.locator('#expression-status')).toContainText('Every question');
  await page.clock.fastForward(60000);
  expect(await page.evaluate(() => (window as any).reads)).toBe(1);
});

test('touching the actual mirror sends a response without adding a separate button', async ({ page }) => {
  await fakeCamera(page, true); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.reflection-note')).toBeVisible({ timeout: 25000 });
  await page.getByRole('textbox').fill('Public beauty should be available to everyone.');
  await expect(page.locator('button')).toHaveCount(0);
  await page.locator('#mirror-stage').click({ position: { x: 640, y: 320 } });
  await expect(page.locator('.reflection-note')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-camera', 'live');
  expect(await page.evaluate(key => localStorage.getItem(key), COMPLETED_PREFIX + 'flourishing-001')).toBe('1');
  expect(page.workers()).toHaveLength(0);
});
