import type { LocalPcmCapture } from './local-pcm-capture';
import type { LocalPcmChunk } from './local-pcm-chunks';
import type {
  HostToLocalAsrWorker,
  LocalAsrWorkerHandle,
  LocalAsrWorkerToHost,
} from './local-asr-worker-protocol';

export interface LocalAsrWorkerOptions {
  chunkDurationMs?: number;
  overlapDurationMs?: number;
  signal?: AbortSignal;
}

function makeError(code: string): Error {
  return new Error(/^((LOCAL_|INVALID_|NON_FINITE_)[A-Z0-9_]+)$/.test(code)
    ? code : 'LOCAL_ASR_WORKER_FAILED');
}

/**
 * Consumes the bounded AudioWorklet source with exactly one PCM frame request
 * and one returned ASR window in flight. PCM is transferred (never uploaded).
 *
 * The model and resampling execute in a Worker, not on the UI thread.
 * This module does NOT load ASR model weights or run speech recognition.
 */
export async function* prepareCapturedLocalAsrChunksInWorker(
  capture: LocalPcmCapture,
  options: LocalAsrWorkerOptions = {},
  createWorker?: () => LocalAsrWorkerHandle,
): AsyncGenerator<LocalPcmChunk, void, void> {
  let worker: LocalAsrWorkerHandle | null = null;
  let source: AsyncIterator<Float32Array> | null = null;
  let closed = false;
  let fetchingFrame = false;
  let readySettled = false;
  let readyResolve!: () => void;
  let readyReject!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // If Worker construction fails before `await ready`, shutdown will reject
  // this promise. Attach a handler now to prevent an unhandled rejection.
  void ready.catch(() => undefined);
  let pendingChunk: {
    resolve: (value: IteratorResult<LocalPcmChunk, void>) => void;
    reject: (reason: Error) => void;
  } | null = null;
  let failure: Error | null = null;

  function shutdown(reason = new Error('LOCAL_ASR_WORKER_CANCELLED')): void {
    if (closed) return;
    closed = true;
    failure = reason;
    options.signal?.removeEventListener('abort', onAbort);
    if (!readySettled) {
      readySettled = true;
      readyReject(reason);
    }
    pendingChunk?.reject(reason);
    pendingChunk = null;
    worker?.terminate();
    capture.stop();
  }

  function onAbort(): void {
    shutdown(new Error('LOCAL_ASR_WORKER_CANCELLED'));
  }

  async function forwardOneFrame(): Promise<void> {
    if (closed) return;
    if (!worker || !source || fetchingFrame) {
      shutdown(new Error('LOCAL_ASR_CONCURRENT_INPUT_REQUEST'));
      return;
    }
    fetchingFrame = true;
    try {
      const result = await source.next();
      if (closed || !worker) return;
      if (result.done) {
        worker.postMessage({ type: 'input-end' });
        return;
      }
      if (!(result.value instanceof Float32Array) || result.value.length > 384_000) {
        worker.postMessage({ type: 'input-error', code: 'INVALID_LOCAL_PCM_RESAMPLE_FRAME' });
        return;
      }
      // Preserve producer buffer ownership. This bounded copy is transferred,
      // not serialized into a JSON payload or sent over the network.
      const samples = new Float32Array(result.value);
      worker.postMessage({ type: 'frame', samples }, [samples.buffer]);
    } catch (cause) {
      if (closed || !worker) return;
      const message = cause instanceof Error ? cause.message : '';
      const code = /^LOCAL_[A-Z0-9_]+$/.test(message)
        ? message : 'LOCAL_ASR_SOURCE_FAILED';
      worker.postMessage({ type: 'input-error', code });
    } finally {
      fetchingFrame = false;
    }
  }

  function onWorkerMessage(event: MessageEvent<LocalAsrWorkerToHost>): void {
    if (closed) return;
    const message = event.data;
    switch (message?.type) {
      case 'ready':
        if (readySettled) {
          shutdown(new Error('LOCAL_ASR_DUPLICATE_READY'));
          return;
        }
        readySettled = true;
        readyResolve();
        break;
      case 'need-frame':
        void forwardOneFrame();
        break;
      case 'chunk': {
        const current = pendingChunk;
        const chunk = message.chunk;
        if (!current || !(chunk?.samples instanceof Float32Array) ||
            chunk.sampleRate !== 16_000 || !Number.isSafeInteger(chunk.startSample) ||
            !Number.isSafeInteger(chunk.endSample) || chunk.endSample < chunk.startSample) {
          shutdown(new Error('LOCAL_ASR_INVALID_WORKER_CHUNK'));
          return;
        }
        pendingChunk = null;
        current.resolve({ value: chunk, done: false });
        break;
      }
      case 'done': {
        const current = pendingChunk;
        if (!current) { shutdown(new Error('LOCAL_ASR_UNEXPECTED_DONE')); return; }
        pendingChunk = null;
        current.resolve({ value: undefined, done: true });
        break;
      }
      case 'error':
        shutdown(makeError(message.code));
        break;
      default:
        shutdown(new Error('LOCAL_ASR_INVALID_WORKER_MESSAGE'));
    }
  }

  try {
    if (options.signal?.aborted) throw new Error('LOCAL_ASR_WORKER_CANCELLED');
    if (!createWorker && (typeof window === 'undefined' || typeof Worker === 'undefined')) {
      throw new Error('LOCAL_ASR_WORKER_UNSUPPORTED');
    }
    worker = createWorker
      ? createWorker()
      : new Worker(new URL('./local-asr-audio.worker.ts', import.meta.url), {
          type: 'module',
          name: 'free-interpreters-local-audio',
        });
    source = capture.frames[Symbol.asyncIterator]();
    worker.onmessage = onWorkerMessage;
    worker.onerror = () => shutdown(new Error('LOCAL_ASR_WORKER_CRASHED'));
    worker.onmessageerror = () => shutdown(new Error('LOCAL_ASR_WORKER_MESSAGE_ERROR'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) throw new Error('LOCAL_ASR_WORKER_CANCELLED');

    worker.postMessage({
      type: 'init',
      sourceSampleRate: capture.sampleRate,
      chunkDurationMs: options.chunkDurationMs,
      overlapDurationMs: options.overlapDurationMs,
    } satisfies HostToLocalAsrWorker);
    await ready;

    while (!closed) {
      const result = await new Promise<IteratorResult<LocalPcmChunk, void>>((resolve, reject) => {
        if (closed || !worker || pendingChunk) {
          reject(failure ?? new Error('LOCAL_ASR_INVALID_WORKER_STATE'));
          return;
        }
        pendingChunk = { resolve, reject };
        try {
          worker.postMessage({ type: 'next' });
        } catch {
          shutdown(new Error('LOCAL_ASR_WORKER_MESSAGE_ERROR'));
        }
      });
      if (result.done) return;
      yield result.value;
    }
    throw failure ?? new Error('LOCAL_ASR_WORKER_CANCELLED');
  } finally {
    shutdown();
  }
}
