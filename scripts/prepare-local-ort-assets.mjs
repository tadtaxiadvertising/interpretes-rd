import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Copy only the ONNX Runtime binaries supplied by the installed package.
 * Do not download at build time: npm ci already pins the exact runtime.
 * Keep .mjs and .wasm from the same version. No external network here.
 */
const root = process.cwd();
const sourceCandidates = [
  join(root, 'node_modules', 'onnxruntime-web', 'dist'),
  join(root, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'dist'),
];
const source = sourceCandidates.find(existsSync);
if (!source) {
  console.error('LOCAL_ASR_ONNX_RUNTIME_MISSING: run npm ci before building.');
  process.exit(1);
}
const files = readdirSync(source).filter((name) =>
  name.startsWith('ort-wasm') && (name.endsWith('.mjs') || name.endsWith('.wasm')),
);
if (!files.some((name) => name.endsWith('.wasm')) || !files.some((name) => name.endsWith('.mjs'))) {
  console.error('LOCAL_ASR_ONNX_RUNTIME_INCOMPLETE: expected matching WASM and ESM files.');
  process.exit(1);
}
const target = resolve(root, 'public', 'live-onnx-runtime');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const filename of files) cpSync(join(source, filename), join(target, filename));
console.log('Prepared ' + files.length + ' local ONNX Runtime files from pinned dependency.');
