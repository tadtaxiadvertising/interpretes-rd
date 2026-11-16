import {
  WHISPER_MAX_SAMPLES,
  WHISPER_TINY_MODEL,
  type WhisperLanguage,
  type WhisperRequest,
  type WhisperWorkerPort,
} from './whisper-tiny-protocol';

export type WhisperInferenceEngine = (
  samples: Float32Array,
  language: WhisperLanguage,
) => Promise<string>;

export type WhisperModelLoader = (
  onProgress: (percent: number) => void,
) => Promise<WhisperInferenceEngine>;

export function normalizeWhisperError(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : '';
  return /^LOCAL_WHISPER_[A-Z0-9_]+$/.test(code)
    ? code
    : 'LOCAL_WHISPER_INFERENCE_FAILED';
}

/**
 * This dynamically imports the bundled Transformers.js code ONLY after an
 * explicit browser UI action. Fetching public model weights is an opt-in
 * browser download, while inference remains entirely on the device.
 *
 * WASM runtime assets are self-hosted from the same pinned npm package.
 * Force a single CPU thread: basic browsers may lack cross-origin isolation.
 */
export async function loadWhisperTinyWasm(
  onProgress: (percent: number) => void,
): Promise<WhisperInferenceEngine> {
  const lib = await import('@huggingface/transformers');
  lib.env.allowRemoteModels = true;
  lib.env.allowLocalModels = false;
  lib.env.useBrowserCache = true;
  lib.env.backends.onnx.wasm.numThreads = 1;
  lib.env.backends.onnx.wasm.wasmPaths = '/live-onnx-runtime/';

  const loaded = await lib.pipeline('automatic-speech-recognition', WHISPER_TINY_MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (event) => {
      const info = event as { progress?: number; loaded?: number; total?: number };
      const value = typeof info.progress === 'number'
        ? info.progress
        : info.total && typeof info.loaded === 'number'
          ? info.loaded / info.total * 100
          : null;
      if (typeof value === 'number' && Number.isFinite(value)) {
        onProgress(Math.max(0, Math.min(100, Math.round(value))));
      }
    },
  });

  return async (samples, language) => {
    const result = await loaded(samples, {
      task: 'transcribe',
      language: language === 'es' ? 'spanish' : 'english',
    });
    if (!result || typeof result !== 'object' || !('text' in result)) {
      throw new Error('LOCAL_WHISPER_INVALID_OUTPUT');
    }
    const text = result.text;
    if (typeof text !== 'string') throw new Error('LOCAL_WHISPER_INVALID_OUTPUT');
    return text.trim().slice(0, 8_000);
  };
}

/**
 * Isolated model Worker: no microphone access, no REST transcription endpoint.
 * Tests can supply a fake loader without downloading any models.
 */
export function attachWhisperTinyWorker(
  port: WhisperWorkerPort,
  loader: WhisperModelLoader = loadWhisperTinyWasm,
): void {
  let state: 'uninitialized' | 'loading' | 'ready' | 'failed' = 'uninitialized';
  let engine: WhisperInferenceEngine | null = null;
  let busy = false;

  port.onmessage = (event) => {
    const message: WhisperRequest = event.data;
    if (message?.type === 'load') {
      if (state !== 'uninitialized' || !['es', 'en'].includes(message.language)) {
        port.postMessage({ type: 'error', code: 'LOCAL_WHISPER_BAD_STATE' });
        return;
      }
      state = 'loading';
      void loader((percent) => {
        if (state === 'loading') port.postMessage({ type: 'progress', percent });
      }).then((loaded) => {
        if (state !== 'loading') return;
        engine = loaded;
        state = 'ready';
        port.postMessage({ type: 'ready' });
      }).catch(() => {
        state = 'failed';
        port.postMessage({ type: 'error', code: 'LOCAL_WHISPER_MODEL_LOAD_FAILED' });
      });
      return;
    }

    if (message?.type !== 'transcribe' || !engine || state !== 'ready' || busy) {
      port.postMessage({ type: 'error', code: 'LOCAL_WHISPER_BAD_STATE' });
      return;
    }
    if (
      !Number.isSafeInteger(message.id) || message.id < 1 ||
      !['es', 'en'].includes(message.language) ||
      !(message.samples instanceof Float32Array) ||
      message.samples.length < 1 || message.samples.length > WHISPER_MAX_SAMPLES
    ) {
      port.postMessage({ type: 'error', code: 'LOCAL_WHISPER_INVALID_AUDIO', id: message.id });
      return;
    }
    // Fail closed on malformed PCM, rather than passing NaNs into the model.
    for (const sample of message.samples) {
      if (!Number.isFinite(sample)) {
        port.postMessage({ type: 'error', code: 'LOCAL_WHISPER_INVALID_AUDIO', id: message.id });
        return;
      }
    }
    busy = true;
    // Do not run a model on pure silence (which can hallucinate speech).
    let energy = 0;
    for (const sample of message.samples) energy += sample * sample;
    const rms = Math.sqrt(energy / message.samples.length);
    if (rms < 0.002) {
      busy = false;
      port.postMessage({ type: 'result', id: message.id, text: '' });
      return;
    }
    void engine(message.samples, message.language).then((text) => {
      busy = false;
      port.postMessage({ type: 'result', id: message.id, text });
    }).catch((cause) => {
      busy = false;
      port.postMessage({ type: 'error', code: normalizeWhisperError(cause), id: message.id });
    });
  };
}
