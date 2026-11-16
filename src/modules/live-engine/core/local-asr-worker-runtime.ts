import { chunkLocalPcmFrames, type LocalPcmChunk } from './local-pcm-chunks';
import { LOCAL_ASR_SAMPLE_RATE, resampleLocalPcmTo16k } from './local-pcm-resample';
import type { LocalAsrWorkerEndpoint, HostToLocalAsrWorker } from './local-asr-worker-protocol';

type FrameResult = Float32Array | null;
type InputWaiter = { resolve: (frame: FrameResult) => void; reject: (reason: Error) => void };

function safeErrorCode(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  return /^(LOCAL_|INVALID_|NON_FINITE_)[A-Z0-9_]+$/.test(message)
    ? message
    : 'LOCAL_ASR_WORKER_FAILED';
}

/**
 * Bind a dedicated browser Worker to the resampler and PCM chunker.
 *
 * The Worker never starts capture and never calls a network API. It requests
 * exactly one audio input frame from its parent when it needs one and emits
 * exactly one completed chunk for each parent 'next' request. This prevents
 * either MessagePort direction from accumulating unlimited PCM buffers.
 */
export function attachLocalAsrAudioWorker(endpoint: LocalAsrWorkerEndpoint): void {
  let started = false;
  let ended = false;
  let busy = false;
  let pendingInput: InputWaiter | null = null;
  let chunks: AsyncGenerator<LocalPcmChunk, void, void> | null = null;

  function fail(cause: unknown): void {
    if (ended) return;
    ended = true;
    pendingInput?.reject(new Error('LOCAL_ASR_WORKER_STOPPED'));
    pendingInput = null;
    endpoint.postMessage({ type: 'error', code: safeErrorCode(cause) });
  }

  async function* inputFrames(): AsyncGenerator<Float32Array, void, void> {
    while (true) {
      const frame = await new Promise<FrameResult>((resolve, reject) => {
        if (pendingInput || ended) {
          reject(new Error('LOCAL_ASR_INVALID_INPUT_STATE'));
          return;
        }
        pendingInput = { resolve, reject };
        endpoint.postMessage({ type: 'need-frame' });
      });
      if (frame === null) return;
      yield frame;
    }
  }

  function initialize(message: Extract<HostToLocalAsrWorker, { type: 'init' }>): void {
    if (started) { fail(new Error('LOCAL_ASR_DUPLICATE_INIT')); return; }
    started = true;
    chunks = chunkLocalPcmFrames(
      resampleLocalPcmTo16k(inputFrames(), { sourceSampleRate: message.sourceSampleRate }),
      {
        sampleRate: LOCAL_ASR_SAMPLE_RATE,
        chunkDurationMs: message.chunkDurationMs,
        overlapDurationMs: message.overlapDurationMs,
      },
    );
    endpoint.postMessage({ type: 'ready' });
  }

  function deliverFrame(message: HostToLocalAsrWorker): void {
    const waiter = pendingInput;
    if (!waiter) { fail(new Error('LOCAL_ASR_UNEXPECTED_INPUT')); return; }
    pendingInput = null;
    if (message.type === 'frame') {
      if (!(message.samples instanceof Float32Array) || message.samples.length > 384_000) {
        waiter.reject(new Error('INVALID_LOCAL_PCM_RESAMPLE_FRAME'));
      } else {
        waiter.resolve(message.samples);
      }
    } else if (message.type === 'input-end') {
      waiter.resolve(null);
    } else if (message.type === 'input-error') {
      waiter.reject(new Error(message.code.startsWith('LOCAL_') ? message.code : 'LOCAL_ASR_SOURCE_FAILED'));
    }
  }

  function requestChunk(): void {
    if (!started || !chunks || ended || busy) {
      fail(new Error('LOCAL_ASR_INVALID_REQUEST_STATE'));
      return;
    }
    busy = true;
    void chunks.next().then(result => {
      if (ended) return;
      busy = false;
      if (result.done) {
        ended = true;
        endpoint.postMessage({ type: 'done' });
        return;
      }
      const chunk = result.value;
      const buffer = chunk.samples.buffer;
      if (!(buffer instanceof ArrayBuffer)) {
        fail(new Error('LOCAL_ASR_INVALID_WORKER_BUFFER'));
        return;
      }
      endpoint.postMessage({ type: 'chunk', chunk }, [buffer]);
    }).catch(fail);
  }

  endpoint.onmessage = (event) => {
    if (ended) return;
    const message = event.data;
    switch (message?.type) {
      case 'init':
        initialize(message);
        break;
      case 'next':
        requestChunk();
        break;
      case 'frame':
      case 'input-end':
      case 'input-error':
        deliverFrame(message);
        break;
      default:
        fail(new Error('LOCAL_ASR_INVALID_WORKER_MESSAGE'));
    }
  };
}
