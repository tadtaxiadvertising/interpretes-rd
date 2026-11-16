/**
 * Streaming, browser-local PCM chunker for future on-device ASR adapters.
 *
 * Inputs are already decoded, mono Float32 PCM frames from a *backpressure-aware*
 * source. We never read files, record audio, retain a whole session, or send
 * samples over a network. No ASR model is included in this module.
 */

export interface LocalPcmChunkOptions {
  sampleRate: number;
  /** Defaults to 20 s. Limited to 30 s to bound model input and memory. */
  chunkDurationMs?: number;
  /** Defaults to 1 s. Repeated context for boundary continuity. */
  overlapDurationMs?: number;
  signal?: AbortSignal;
}

export interface LocalPcmChunk {
  index: number;
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
  sampleRate: number;
  /** Owns a copy. Never aliases the reusable chunk buffer. */
  samples: Float32Array;
  /** 'tail' means the final, incomplete window after end-of-stream. */
  kind: 'full' | 'tail';
}

function validateOptions(options: LocalPcmChunkOptions) {
  const sampleRate = options.sampleRate;
  const duration = options.chunkDurationMs ?? 20_000;
  const overlap = options.overlapDurationMs ?? 1_000;

  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 192_000) {
    throw new Error('INVALID_PCM_SAMPLE_RATE');
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30_000) {
    throw new Error('INVALID_PCM_CHUNK_DURATION');
  }
  if (!Number.isFinite(overlap) || overlap < 0 || overlap >= duration) {
    throw new Error('INVALID_PCM_OVERLAP');
  }

  const chunkSamples = Math.round((duration * sampleRate) / 1000);
  const overlapSamples = Math.round((overlap * sampleRate) / 1000);
  if (chunkSamples < 1 || overlapSamples >= chunkSamples) {
    throw new Error('INVALID_PCM_WINDOW');
  }
  return { sampleRate, chunkSamples, overlapSamples };
}

function ensureNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('LOCAL_PCM_PROCESSING_CANCELLED');
}

/**
 * Async iteration provides backpressure: the next frame is not requested
 * until the consumer finishes handling the previously emitted chunk.
 *
 * For a live microphone, the frame producer must *also* bound its own queue
 * and implement a clear overflow policy. This module alone cannot prevent
 * a producer from buffering unlimited input while consumption is paused.
 *
 * No timestamps are fabricated from wall-clock time: sample offsets are
 * deterministic and suitable for future ASR reconciliation.
 */
export async function* chunkLocalPcmFrames(
  frames: AsyncIterable<Float32Array>,
  options: LocalPcmChunkOptions,
): AsyncGenerator<LocalPcmChunk, void, void> {
  const { sampleRate, chunkSamples, overlapSamples } = validateOptions(options);
  const windowSamples = new Float32Array(chunkSamples);
  const maxFrameSamples = Math.max(256, sampleRate * 2);

  let filled = 0;
  let startSample = 0;
  let index = 0;
  let emittedFull = false;

  function output(length: number, kind: LocalPcmChunk['kind']): LocalPcmChunk {
    return {
      index: index++,
      startSample,
      endSample: startSample + length,
      startMs: (startSample / sampleRate) * 1000,
      endMs: ((startSample + length) / sampleRate) * 1000,
      sampleRate,
      samples: windowSamples.slice(0, length),
      kind,
    };
  }

  ensureNotCancelled(options.signal);
  for await (const frame of frames) {
    ensureNotCancelled(options.signal);
    if (!(frame instanceof Float32Array) || frame.length > maxFrameSamples) {
      throw new Error('INVALID_PCM_FRAME');
    }

    let offset = 0;
    while (offset < frame.length) {
      ensureNotCancelled(options.signal);
      const count = Math.min(chunkSamples - filled, frame.length - offset);
      windowSamples.set(frame.subarray(offset, offset + count), filled);
      filled += count;
      offset += count;

      if (filled === chunkSamples) {
        yield output(chunkSamples, 'full');
        ensureNotCancelled(options.signal);
        // Preserve overlap without retaining the entire past conversation.
        windowSamples.copyWithin(0, chunkSamples - overlapSamples, chunkSamples);
        filled = overlapSamples;
        startSample += chunkSamples - overlapSamples;
        emittedFull = true;
      }
    }
  }

  ensureNotCancelled(options.signal);
  // Do not emit a duplicate tail containing only already-emitted overlap.
  if (filled > (emittedFull ? overlapSamples : 0)) {
    yield output(filled, 'tail');
  }
}
