import { loadLocalWhisperTiny } from '../../src/modules/live-engine/core/whisper-tiny-client';
import { wordErrorRate } from './wer';

interface SmokeResult {
  loaded: boolean;
  en: string | null;
  es: string | null;
  modelId: string;
  timings?: {
    modelLoadMs: number;
    shortEnglishMs: number;
    shortSpanishMs: number;
    longEnglishMs: number;
    shortAudioMs: number;
    longAudioMs: number;
    longWindowRealtimeFactor: number;
  };
  speech?: {
    enWer: number;
    esWer: number;
    enInferenceMs: number;
    esInferenceMs: number;
    enAudioMs: number;
    esAudioMs: number;
    syntheticTtsOnly: true;
  };
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

function makeSyntheticVoiceLikePcm(seconds = 2): Float32Array {
  // Deliberately non-silent and fully generated. This does NOT test word
  // accuracy, which requires an authorized recorded-voice fixture.
  const rate = 16_000;
  const length = rate * seconds;
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

async function syntheticSpeechFixture(language: 'en' | 'es'): Promise<Float32Array> {
  const response = await fetch('/live-whisper-fixture/' + language + '.f32', {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('WHISPER_SYNTHETIC_SPEECH_FIXTURE_MISSING');
  const raw = await response.arrayBuffer();
  if (!raw.byteLength || raw.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0 ||
      raw.byteLength > 30 * 16_000 * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('WHISPER_SYNTHETIC_SPEECH_FIXTURE_INVALID');
  }
  const samples = new Float32Array(raw);
  if (!samples.every(Number.isFinite)) {
    throw new Error('WHISPER_SYNTHETIC_SPEECH_FIXTURE_NONFINITE');
  }
  return samples;
}

run.addEventListener('click', () => {
  run.disabled = true;
  report('loading');
  let model: Awaited<ReturnType<typeof loadLocalWhisperTiny>> | null = null;

  void (async () => {
    try {
      const loadStart = performance.now();
      model = await loadLocalWhisperTiny({
        language: 'en',
        onProgress: () => { /* Do not log per-file download URLs or payloads. */ },
      }, () => new Worker(
        // Vite test-only Worker factory: builds the EXACT real entrypoint and
        // runtime while keeping Next's webpackChunkName hint in production.
        // The session injection is already supported by the production client.
        new URL('../../src/modules/live-engine/core/whisper-tiny.worker.ts', import.meta.url),
        { type: 'module', name: 'free-interpreters-whisper-tiny-smoke' },
      ));
      const modelLoadMs = performance.now() - loadStart;
      report('model-ready');
      const pcm = makeSyntheticVoiceLikePcm();
      const englishStart = performance.now();
      const en = await model.transcribe(pcm, 'en');
      const shortEnglishMs = performance.now() - englishStart;
      const spanishStart = performance.now();
      const es = await model.transcribe(pcm, 'es');
      const shortSpanishMs = performance.now() - spanishStart;

      // The user-facing PCM chunker emits 10-second windows with one second
      // of overlap. This measures a realistic *window duration* in the actual
      // model, without claiming synthetic tones prove speech accuracy.
      const longPcm = makeSyntheticVoiceLikePcm(10);
      report('long-window-inference');
      const longStart = performance.now();
      const longEnglish = await model.transcribe(longPcm, 'en');
      const longEnglishMs = performance.now() - longStart;
      if (typeof longEnglish !== 'string') {
        throw new Error('LOCAL_WHISPER_INVALID_LONG_OUTPUT');
      }
      report('synthetic-speech-inference');
      // Entirely generated in CI with espeak-ng; no user's spoken content,
      // cloud TTS or third-party voice recordings. WER is diagnostic only.
      const enSpeechPcm = await syntheticSpeechFixture('en');
      const esSpeechPcm = await syntheticSpeechFixture('es');
      const enSpeechStart = performance.now();
      const enSpeech = await model.transcribe(enSpeechPcm, 'en');
      const enSpeechMs = performance.now() - enSpeechStart;
      const esSpeechStart = performance.now();
      const esSpeech = await model.transcribe(esSpeechPcm, 'es');
      const esSpeechMs = performance.now() - esSpeechStart;
      const enWer = wordErrorRate(
        'The patient has a fever and needs to see the doctor.', enSpeech,
      );
      const esWer = wordErrorRate(
        'El paciente tiene fiebre y necesita ver al doctor.', esSpeech,
      );
      if (!Number.isFinite(enWer) || !Number.isFinite(esWer)) {
        throw new Error('WHISPER_SYNTHETIC_SPEECH_INVALID_WER');
      }

      window.__whisperSmoke = {
        loaded: true,
        modelId: model.modelId,
        en,
        es,
        speech: {
          enWer,
          esWer,
          enInferenceMs: enSpeechMs,
          esInferenceMs: esSpeechMs,
          enAudioMs: enSpeechPcm.length / 16,
          esAudioMs: esSpeechPcm.length / 16,
          syntheticTtsOnly: true,
        },
        timings: {
          modelLoadMs,
          shortEnglishMs,
          shortSpanishMs,
          longEnglishMs,
          shortAudioMs: 2_000,
          longAudioMs: 10_000,
          longWindowRealtimeFactor: longEnglishMs / 10_000,
        },
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
