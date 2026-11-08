// Keep the optional expression feature entirely same-origin and reproducible.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const copies = [
  ...['blazeface.json', 'blazeface.bin', 'emotion.json', 'emotion.bin'].map(name =>
    [`node_modules/@vladmandic/human/models/${name}`, `models/${name}`]),
  ...['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-threaded-simd.wasm'].map(name =>
    [`node_modules/@tensorflow/tfjs-backend-wasm/wasm-out/${name}`, `wasm/${name}`]),
  ['node_modules/@vladmandic/human/LICENSE', 'HUMAN-LICENSE.txt'],
];
const hashes = [];
for (const [source, relative] of copies) {
  const destination = new URL(`public/expression/${relative}`, root);
  await mkdir(new URL('./', destination), { recursive: true });
  await copyFile(new URL(source, root), destination);
  hashes.push(`${createHash('sha256').update(await readFile(destination)).digest('hex')}  ${relative}`);
}
await writeFile(new URL('public/expression/SHA256SUMS', root), hashes.join('\n') + '\n');
console.log('Prepared local face detector, expression model and WASM runtime.');
