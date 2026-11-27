import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  css: { postcss: repositoryRoot },
  build: {
    outDir: fileURLToPath(new URL('../../build/audio-studio-benchmark', import.meta.url)),
    emptyOutDir: true,
  },
  preview: { host: '127.0.0.1', port: 4178, strictPort: true },
});
