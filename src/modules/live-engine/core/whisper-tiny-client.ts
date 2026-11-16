import {
  WHISPER_MAX_SAMPLES,
  type WhisperLanguage,
  type WhisperWorkerHandle,
} from './whisper-tiny-protocol';

export interface LocalWhisperSession {
  readonly modelId: string;
  transcribe(samples: Float32Array, language: WhisperLanguage): Promise<string>;
  close(): void;
}

interface LoadWhisperOptions {
  language: WhisperLanguage;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

function asError(message: string): Error {
  return new Error(/^LOCAL_WHISPER_[A-Z0-9_]+$/.test(message)
    ? message : 'LOCAL_WHISPER_FAILED');
}

/**
 * Initialize the model only from a deliberate user interaction. A loading
 * model can fetch public weights directly from Hugging Face to the user's
 * browser cache. No audio is sent to Hugging Face or Free Interpreters.
 *
 * Cancellation always TERMINATES the Worker, so long-running native WASM
 * inference does not need to support cooperative cancellation.
 */
export async function loadLocalWhisperTiny(
  options: LoadWhisperOptions,
  makeWorker?: () => WhisperWorkerHandle,
): Promise<LocalWhisperSession> {
  if (options.signal?.aborted) throw new Error('LOCAL_WHISPER_CANCELLED');
  if (!makeWorker && (typeof window === 'undefined' || typeof Worker === 'undefined')) {
    throw new Error('LOCAL_WHISPER_UNSUPPORTED');
  }

  const worker = makeWorker
    ? makeWorker()
    : new Worker(new URL('./whisper-tiny.worker.ts', import.meta.url), {
        type: 'module',
        name: 'free-interpreters-whisper-tiny',
      });
  let closed = false;
  let loaded = false;
  let nextId = 0;
  let loadResolve!: () => void;
  let loadReject!: (error: Error) => void;
  const load = new Promise<void>((resolve, reject) => {
    loadResolve = resolve;
    loadReject = reject;
  });
  // Avoid unhandled promise rejections when cancellation precedes await load.
  void load.catch(() => undefined);
  let pending: { id: number; resolve: (text: string) => void; reject: (error: Error) => void } | null = null;

  function close(reason = new Error('LOCAL_WHISPER_CANCELLED')): void {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener('abort', onAbort);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    if (!loaded) loadReject(reason);
    pending?.reject(reason);
    pending = null;
  }
  function onAbort() { close(); }

  worker.onmessage = (event) => {
    if (closed) return;
    const message = event.data;
    switch (message?.type) {
      case 'progress':
        if (!loaded && Number.isFinite(message.percent)) options.onProgress?.(Math.max(0, Math.min(100, message.percent)));
        break;
      case 'ready':
        if (loaded) { close(new Error('LOCAL_WHISPER_BAD_STATE')); return; }
        loaded = true;
        loadResolve();
        break;
      case 'result': {
        const current = pending;
        if (!current || current.id !== message.id || typeof message.text !== 'string') {
          close(new Error('LOCAL_WHISPER_BAD_RESULT'));
          return;
        }
        pending = null;
        current.resolve(message.text.trim());
        break;
      }
      case 'error': {
        const error = asError(message.code);
        if (!loaded) { close(error); return; }
        if (pending && (message.id === undefined || message.id === pending.id)) {
          const current = pending;
          pending = null;
          current.reject(error);
        } else close(error);
        break;
      }
      default:
        close(new Error('LOCAL_WHISPER_BAD_MESSAGE'));
    }
  };
  worker.onerror = () => close(new Error('LOCAL_WHISPER_CRASHED'));
  worker.onmessageerror = () => close(new Error('LOCAL_WHISPER_MESSAGE_ERROR'));

  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) {
    close();
    throw new Error('LOCAL_WHISPER_CANCELLED');
  }
  try {
    worker.postMessage({ type: 'load', language: options.language });
    await load;
    if (closed) throw new Error('LOCAL_WHISPER_CANCELLED');
    return {
      modelId: 'onnx-community/whisper-tiny',
      async transcribe(samples, language) {
        if (closed) throw new Error('LOCAL_WHISPER_CANCELLED');
        if (pending) throw new Error('LOCAL_WHISPER_BUSY');
        if (!(samples instanceof Float32Array) || !samples.length || samples.length > WHISPER_MAX_SAMPLES) {
          throw new Error('LOCAL_WHISPER_INVALID_AUDIO');
        }
        const copy = new Float32Array(samples);
        const id = ++nextId;
        return new Promise<string>((resolve, reject) => {
          pending = { id, resolve, reject };
          try {
            worker.postMessage({ type: 'transcribe', id, language, samples: copy }, [copy.buffer]);
          } catch {
            pending = null;
            reject(new Error('LOCAL_WHISPER_MESSAGE_ERROR'));
            close(new Error('LOCAL_WHISPER_MESSAGE_ERROR'));
          }
        });
      },
      close: () => close(),
    };
  } catch (cause) {
    close(cause instanceof Error ? cause : new Error('LOCAL_WHISPER_LOAD_FAILED'));
    throw cause;
  }
}
