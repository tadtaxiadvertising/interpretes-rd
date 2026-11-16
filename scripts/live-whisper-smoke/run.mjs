import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { resolve } from 'node:path';

const HOST = '127.0.0.1';
const PORT = 4177;
const ORIGIN = 'http://' + HOST + ':' + PORT;
const allowedModelHost = (host) =>
  host === 'huggingface.co' ||
  host.endsWith('.huggingface.co') ||
  host === 'cdn-lfs.hf.co' ||
  host.endsWith('.hf.co') ||
  host.endsWith('.xethub.hf.co');

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  publicDir: resolve('public'),
  server: { host: HOST, port: PORT, strictPort: true },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
let browser = null;
const pageErrors = [];
const remoteRequests = [];

try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(700_000);
  page.on('pageerror', (error) => { pageErrors.push(error.message.slice(0, 1000)); });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== ORIGIN) {
      remoteRequests.push({ host: url.host, method: request.method() });
    }
  });

  await page.goto(ORIGIN + '/scripts/live-whisper-smoke/index.html', {
    waitUntil: 'domcontentloaded',
  });
  // The only model-loading operation occurs from a user click.
  await page.getByRole('button', { name: 'Run explicit local model smoke' }).click();
  await page.waitForFunction(() => {
    const state = document.getElementById('status')?.textContent;
    return state === 'inference-complete' || state === 'failed';
  }, null, { timeout: 690_000 });

  const result = await page.evaluate(() => window.__whisperSmoke);
  if (!result?.loaded) {
    throw new Error('WHISPER_BROWSER_MODEL_FAILED: ' + (result?.error ?? 'unknown'));
  }
  if (result.modelId !== 'onnx-community/whisper-tiny' ||
      typeof result.en !== 'string' || typeof result.es !== 'string') {
    throw new Error('WHISPER_BROWSER_INVALID_OUTPUT');
  }
  const unexpected = remoteRequests.filter((item) =>
    !allowedModelHost(item.host) || !['GET', 'HEAD', 'OPTIONS'].includes(item.method),
  );
  if (unexpected.length) {
    throw new Error('WHISPER_BROWSER_UNEXPECTED_REMOTE_REQUEST: ' + JSON.stringify(unexpected.slice(0, 8)));
  }
  if (pageErrors.length) throw new Error('WHISPER_BROWSER_PAGE_ERRORS: ' + pageErrors.join('; '));
  console.log('PASS: Chromium loaded the pinned Whisper tiny model and completed both ES/EN local inference calls.');
  console.log('PASS: All observed remote browser requests were model-asset retrievals using GET/HEAD/OPTIONS.');
  console.log('LIMITATION: Synthetic voiced signal is not a word-accuracy or professional real-time benchmark.');
  console.log('Third-party model request count: ' + remoteRequests.length);
} catch (error) {
  console.error('FAIL: ' + String(error));
  if (pageErrors.length) console.error('Browser errors: ' + JSON.stringify(pageErrors.slice(0, 5)));
  if (remoteRequests.length) {
    console.error('Observed remote request hosts (not paths): ' +
      JSON.stringify([...new Set(remoteRequests.map(({ host, method }) => method + ' ' + host))]));
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
