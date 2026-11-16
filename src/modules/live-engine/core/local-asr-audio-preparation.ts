import type { LocalPcmCapture } from './local-pcm-capture';
import { chunkLocalPcmFrames, type LocalPcmChunk } from './local-pcm-chunks';
import { LOCAL_ASR_SAMPLE_RATE, resampleLocalPcmTo16k } from './local-pcm-resample';

export interface LocalAsrAudioOptions {
  chunkDurationMs?: number;
  overlapDurationMs?: number;
  signal?: AbortSignal;
}

/**
 * Connects the existing bounded AudioWorklet source to 16 kHz ASR windows.
 *
 * No model invocation, recording or networking happens here. The capture must
 * be started in a separate, explicit user action. The generator is one-shot:
 * completion, consumer cancellation, and errors always stop the microphone.
 *
 * The filter currently runs on the consuming JS thread. Prior to enabling
 * real-time inference, move the resampling/ASR path to a Worker and benchmark
 * whether it can keep pace on low-end devices.
 */
export async function* prepareCapturedLocalAsrChunks(
  capture: LocalPcmCapture,
  options: LocalAsrAudioOptions = {},
): AsyncGenerator<LocalPcmChunk, void, void> {
  // Aborting while waiting for an input frame must unblock the reader. A mere
  // token check in the resampler would not wake a stalled async iterator.
  const onAbort = () => capture.stop();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (options.signal?.aborted) throw new Error('LOCAL_PCM_PROCESSING_CANCELLED');
    yield* chunkLocalPcmFrames(
      resampleLocalPcmTo16k(capture.frames, {
        sourceSampleRate: capture.sampleRate,
        signal: options.signal,
      }),
      {
        sampleRate: LOCAL_ASR_SAMPLE_RATE,
        chunkDurationMs: options.chunkDurationMs,
        overlapDurationMs: options.overlapDurationMs,
        signal: options.signal,
      },
    );
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    capture.stop();
  }
}
