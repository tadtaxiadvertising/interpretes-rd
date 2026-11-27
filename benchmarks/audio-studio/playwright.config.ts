import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  testMatch: 'performance.spec.ts',
  outputDir: fileURLToPath(new URL('../../test-results/audio-studio-benchmark', import.meta.url)),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: 'npx --no-install vite build --config benchmarks/audio-studio/vite.config.ts && npx --no-install vite preview --config benchmarks/audio-studio/vite.config.ts',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
