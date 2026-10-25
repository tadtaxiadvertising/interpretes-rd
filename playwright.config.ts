import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

if (process.env.E2E_ALLOW_RUN !== 'true') {
  throw new Error(
    'Playwright is disabled by default. Set E2E_ALLOW_RUN=true only when the app is configured for an isolated E2E database.'
  );
}

const configuredBaseURL = process.env.BASE_URL || 'http://localhost:3001';
const configuredBase = new URL(configuredBaseURL);
const isLocalTarget = ['localhost', '127.0.0.1', '::1'].includes(configuredBase.hostname);
if (!isLocalTarget && process.env.E2E_ALLOW_REMOTE_TARGET !== 'true') {
  throw new Error(
    'Remote Playwright targets are disabled by default. Set E2E_ALLOW_REMOTE_TARGET=true only for an approved test environment.'
  );
}

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_START_SERVER === 'true'
    ? {
        command: 'npm run start',
        url: configuredBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
