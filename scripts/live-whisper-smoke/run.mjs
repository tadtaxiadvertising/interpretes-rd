import { chromium, firefox } from '@playwright/test';
import { build, preview } from 'vite';
import { resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const browserName = process.env.FI_LIVE_BROWSER || 'chromium';
const browserType = { chromium, firefox }[browserName];
if (!browserType) throw new Error('LOCAL_ASR_SMOKE_UNSUPPORTED_BROWSER');
const HOST = '127.0.0.1';
const PORT = 4177;
const ORIGIN = 'http://' + HOST + ':' + PORT;
const allowedModelHost = (host) =>
  host === 'huggingface.co' ||
  host.endsWith('.huggingface.co') ||
  host === 'cdn-lfs.hf.co' ||
  host.endsWith('.hf.co') ||
  host.endsWith('.xethub.hf.co');

const fixtureRoot = resolve('scripts/live-whisper-smoke');
const outDir = mkdtempSync(join(tmpdir(), 'fi-live-whisper-smoke-'));
let server = null;
let browser = null;
const pageErrors = [];
const workerUrls = [];
const browserRequestFailures = [];
const remoteRequests = [];

try {
  // Vite dev intentionally rejects importing executable .mjs out of public/.
  // Test the production-like build instead: public ONNX WASM+MJS assets are
  // copied as static files and served unchanged by Vite preview.
  await build({
    configFile: false,
    root: fixtureRoot,
    publicDir: resolve('public'),
    build: { outDir, emptyOutDir: true, sourcemap: false },
  });
  server = await preview({
    configFile: false,
    root: fixtureRoot,
    build: { outDir },
    preview: { host: HOST, port: PORT, strictPort: true },
  });
  browser = await browserType.launch({
    headless: true,
    ...(browserName === 'chromium' ? { args: ['--no-sandbox'] } : {}),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(700_000);
  page.on('pageerror', (error) => { pageErrors.push(error.message.slice(0, 1000)); });
  page.on('worker', (worker) => {
    const url = new URL(worker.url());
    // Log only origin and asset basename: no conversation or model payloads.
    workerUrls.push(url.origin + '/' + url.pathname.split('/').pop());
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    browserRequestFailures.push({
      host: url.host,
      asset: url.pathname.split('/').pop()?.slice(0, 80) ?? '',
      failure: request.failure()?.errorText?.slice(0, 180) ?? 'unknown',
    });
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== ORIGIN) {
      remoteRequests.push({ host: url.host, method: request.method() });
    }
  });

  await page.goto(ORIGIN + '/', {
    waitUntil: 'domcontentloaded',
  });
  // Even importing the UI/Worker wrapper must not download model weights
  // before a real user interaction.
  await page.waitForTimeout(800);
  if (remoteRequests.length !== 0) {
    throw new Error('WHISPER_BROWSER_MODEL_DOWNLOAD_BEFORE_USER_CLICK');
  }
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
  const esToneValidated = typeof result.es === 'string' ||
    (result.es === null && result.esToneSafetyRejected === true);
  if (result.modelId !== 'onnx-community/whisper-tiny' ||
      typeof result.en !== 'string' || !esToneValidated) {
    throw new Error('WHISPER_BROWSER_INVALID_OUTPUT');
  }
  const timings = result.timings;
  if (!timings || !['modelLoadMs', 'shortEnglishMs', 'shortSpanishMs', 'longEnglishMs',
    'shortAudioMs', 'longAudioMs', 'longWindowRealtimeFactor'].every(key =>
      Number.isFinite(timings[key]) && timings[key] > 0)) {
    throw new Error('WHISPER_BROWSER_INVALID_PERFORMANCE_METRICS');
  }
  if (timings.shortAudioMs !== 2000 || timings.longAudioMs !== 10000) {
    throw new Error('WHISPER_BROWSER_INVALID_AUDIO_DURATION');
  }
  const speech = result.speech;
  const spanishSafetyOutcome = speech?.esSafetyRejected === true
    ? speech.esWer === null
    : Number.isFinite(speech?.esWer) && speech.esWer >= 0;
  if (!speech || speech.syntheticTtsOnly !== true ||
    !['enWer', 'enInferenceMs', 'esInferenceMs', 'enAudioMs', 'esAudioMs']
      .every(key => Number.isFinite(speech[key]) && speech[key] >= 0) ||
    !spanishSafetyOutcome ||
    speech.enAudioMs <= 0 || speech.esAudioMs <= 0) {
    throw new Error('WHISPER_BROWSER_INVALID_SPEECH_SCORE');
  }
  const unexpected = remoteRequests.filter((item) =>
    !allowedModelHost(item.host) || !['GET', 'HEAD', 'OPTIONS'].includes(item.method),
  );
  if (unexpected.length) {
    throw new Error('WHISPER_BROWSER_UNEXPECTED_REMOTE_REQUEST: ' + JSON.stringify(unexpected.slice(0, 8)));
  }
  if (pageErrors.length) throw new Error('WHISPER_BROWSER_PAGE_ERRORS: ' + pageErrors.join('; '));
  const report = {
    browser: browserName,
    model: result.modelId,
    modelLoadMs: Math.round(timings.modelLoadMs),
    shortEnglishMs: Math.round(timings.shortEnglishMs),
    shortSpanishMs: Math.round(timings.shortSpanishMs),
    longEnglishMs: Math.round(timings.longEnglishMs),
    // Windows have one second overlap; this is the 9-second cadence budget
    // for a 10-second input window, NOT the speech-recognition quality score.
    window10sRealtimeFactor: Number(timings.longWindowRealtimeFactor.toFixed(3)),
    window9sCadenceFactor: Number((timings.longEnglishMs / 9000).toFixed(3)),
    shortAudioMs: timings.shortAudioMs,
    longAudioMs: timings.longAudioMs,
    remoteModelRequestCount: remoteRequests.length,
    syntheticSignalOnly: true,
    syntheticSpeechOnly: true,
    // WER is diagnostic on eSpeak TTS, NOT spontaneous or medical speech.
    enSyntheticTtsWer: Number(speech.enWer.toFixed(3)),
    esSyntheticTtsWer: speech.esWer === null ? null : Number(speech.esWer.toFixed(3)),
    esSyntheticTtsSafetyRejected: speech.esSafetyRejected,
    esSyntheticToneSafetyRejected: result.esToneSafetyRejected === true,
    enSyntheticTtsInferenceMs: Math.round(speech.enInferenceMs),
    esSyntheticTtsInferenceMs: Math.round(speech.esInferenceMs),
    enSyntheticTtsAudioMs: Math.round(speech.enAudioMs),
    esSyntheticTtsAudioMs: Math.round(speech.esAudioMs),
  };
  mkdirSync(resolve('test-results'), { recursive: true });
  writeFileSync(resolve('test-results', 'whisper-' + browserName + '-metrics.json'),
    JSON.stringify(report, null, 2) + '\n');
  console.log('PASS: ' + browserName + ' loaded the pinned Whisper model and completed EN, ES safety-check and 10s local inference calls.');
  if (speech.esSafetyRejected) {
    console.warn('QUALITY-BLOCKER: Spanish synthesized voice triggered runaway-output fail-closed protection. Do not enable professional pilot.');
  }
  console.log('PASS: All observed remote browser requests used read-only methods on model-asset hosts.');
  console.log('WHISPER_PERFORMANCE_JSON: ' + JSON.stringify(report));
  console.log('LIMITATION: TTS WER measures eSpeak-generated phrases, NOT WER on real accents, clinical accuracy, RAM, microphone stability or sustained real-time performance.');
} catch (error) {
  console.error('FAIL: ' + String(error));
  if (pageErrors.length) console.error('Browser errors: ' + JSON.stringify(pageErrors.slice(0, 5)));
  if (workerUrls.length) console.error('Observed Worker script basenames: ' + JSON.stringify(workerUrls.slice(0, 8)));
  if (browserRequestFailures.length) {
    console.error('Failed browser resources (no query strings): ' +
      JSON.stringify(browserRequestFailures.slice(0, 8)));
  }
  if (remoteRequests.length) {
    console.error('Observed remote request hosts (not paths): ' +
      JSON.stringify([...new Set(remoteRequests.map(({ host, method }) => method + ' ' + host))]));
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) {
    await new Promise((resolve, reject) => {
      server.httpServer.close((error) => error ? reject(error) : resolve());
    });
  }
  rmSync(outDir, { recursive: true, force: true });
}
