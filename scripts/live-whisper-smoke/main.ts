import { loadLocalWhisperTiny } from '../../src/modules/live-engine/core/whisper-tiny-client';

interface SmokeResult {
  loaded: boolean;
  en: string | null;
  es: string | null;
  modelId: string;
  error?: string;
}

declare global {
  interface Window {
    __whisperSmoke?: SmokeResult;
  }
}

const button = document.getElementById('run') as HTMLButtonElement | null;
const status = document.getElementById('status') as HTMLOutputElement | null;
if (!button || !status) throw new Error('LOCAL_ASR_SMOKE_MARKUP_MISSING');

const run = button;
const output = status;
function report(value: string) {
  output.textContent = value;
}

function makeSyntheticVoiceLikePcm(): Float32Array {
  // Deliberately non-silent and fully generated. This does NOT test word
  // accuracy, which requires an authorized recorded-voice fixture.
  const rate = 16_000;
  const length = rate * 2;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const envelope = 0.14 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3.8 * t));
    samples[i] = envelope * (
      Math.sin(2 * Math.PI * 190 * t) +
      0.33 * Math.sin(2 * Math.PI * 570 * t) +
      0.17 * Math.sin(2 * Math.PI * 950 * t)
    );
  }
  return samples;
}

run.addEventListener('click', () => {
  run.disabled = true;
  report('loading');
  let model: Awaited<ReturnType<typeof loadLocalWhisperTiny>> | null = null;

  void (async () => {
    try {
      model = await loadLocalWhisperTiny({
        language: 'en',
        onProgress: () => { /* Do not log per-file download URLs or payloads. */ },
      });
      report('model-ready');
      const pcm = makeSyntheticVoiceLikePcm();
      const en = await model.transcribe(pcm, 'en');
      const es = await model.transcribe(pcm, 'es');
      window.__whisperSmoke = {
        loaded: true,
        modelId: model.modelId,
        en,
        es,
      };
      report('inference-complete');
    } catch (error) {
      window.__whisperSmoke = {
        loaded: false,
        modelId: 'onnx-community/whisper-tiny',
        en: null, es: null,
        error: error instanceof Error ? error.message : 'LOCAL_ASR_SMOKE_UNKNOWN',
      };
      report('failed');
    } finally {
      model?.close();
    }
  })();
});
