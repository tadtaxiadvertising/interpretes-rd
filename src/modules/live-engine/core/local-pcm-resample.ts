/**
 * Bounded-memory, browser-local band-limited PCM resampling to 16 kHz mono.
 *
 * Frames come from the AudioWorklet source; they are already mono Float32 PCM.
 * No audio is downloaded, recorded, uploaded or retained beyond a small
 * circular filter history and one 1024-sample output frame.
 *
 * This is not an ASR engine. Run it in a dedicated Worker before depending on
 * it for low-latency production use: filtering consumes CPU.
 */
export const LOCAL_ASR_SAMPLE_RATE = 16_000;
const FILTER_RADIUS = 32; // 65-tap symmetric, windowed-sinc low-pass filter.
const OUTPUT_FRAME_SAMPLES = 1024;

export interface LocalPcmResampleOptions {
  sourceSampleRate: number;
  signal?: AbortSignal;
}

function validateSampleRate(rate: number): void {
  if (!Number.isSafeInteger(rate) || rate < 8_000 || rate > 192_000) {
    throw new Error('INVALID_LOCAL_PCM_RESAMPLE_RATE');
  }
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('LOCAL_PCM_RESAMPLE_CANCELLED');
}

/**
 * Resample with Blackman-windowed sinc. The cutoff is below the lower Nyquist
 * limit for each input/output rate pair, reducing downsampling aliasing.
 *
 * The output sample position is computed from an absolute integer index to
 * avoid drift after millions of samples. At stream boundaries the nearest
 * endpoint is extended; there are no gaps or duplicated frames at boundaries.
 *
 * The output duration is ceil(inputSamples * 16000 / sourceSampleRate).
 * Output frames are independent copies (<=1024 samples).
 */
export async function* resampleLocalPcmTo16k(
  frames: AsyncIterable<Float32Array>,
  options: LocalPcmResampleOptions,
): AsyncGenerator<Float32Array, void, void> {
  const sourceRate = options.sourceSampleRate;
  validateSampleRate(sourceRate);
  checkCancelled(options.signal);

  const maxFrameSamples = sourceRate * 2;

  // A 16 kHz capture must retain exact PCM values, with no unnecessary filter.
  if (sourceRate === LOCAL_ASR_SAMPLE_RATE) {
    for await (const frame of frames) {
      checkCancelled(options.signal);
      if (!(frame instanceof Float32Array) || frame.length > maxFrameSamples) {
        throw new Error('INVALID_LOCAL_PCM_RESAMPLE_FRAME');
      }
      for (let offset = 0; offset < frame.length; offset += OUTPUT_FRAME_SAMPLES) {
        checkCancelled(options.signal);
        const result = frame.slice(offset, offset + OUTPUT_FRAME_SAMPLES);
        for (const sample of result) {
          if (!Number.isFinite(sample)) throw new Error('NON_FINITE_LOCAL_PCM_SAMPLE');
        }
        yield result;
      }
    }
    checkCancelled(options.signal);
    return;
  }

  // The ring stores slightly more than the entire 65-tap active filter window.
  const ring = new Float32Array(2 * FILTER_RADIUS + 8);
  const cutoff = 0.92 * Math.min(1, LOCAL_ASR_SAMPLE_RATE / sourceRate);
  const ratio = sourceRate / LOCAL_ASR_SAMPLE_RATE;
  let received = 0;
  let nextOutputIndex = 0;
  let firstSample = 0;
  let lastSample = 0;
  let output = new Float32Array(OUTPUT_FRAME_SAMPLES);
  let outputLength = 0;

  function filterAt(position: number): number {
    const center = Math.floor(position);
    let weighted = 0;
    let sumWeights = 0;
    for (let offset = -FILTER_RADIUS; offset <= FILTER_RADIUS; offset += 1) {
      const sourceIndex = center + offset;
      const distance = position - sourceIndex;
      const x = Math.abs(distance) / FILTER_RADIUS;
      if (x >= 1) continue;

      // Windowed, normalized low-pass sinc. At edges, use endpoint extension
      // rather than treating missing microphone samples as silent gaps.
      const argument = Math.PI * cutoff * distance;
      const sinc = Math.abs(argument) < 1e-10 ? 1 : Math.sin(argument) / argument;
      const window = 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x);
      const weight = cutoff * sinc * window;

      let value: number;
      if (sourceIndex < 0) value = firstSample;
      else if (sourceIndex >= received) value = lastSample;
      else {
        if (sourceIndex < received - ring.length) {
          throw new Error('LOCAL_PCM_RESAMPLE_HISTORY_LOST');
        }
        value = ring[sourceIndex % ring.length];
      }
      weighted += value * weight;
      sumWeights += weight;
    }
    if (!Number.isFinite(sumWeights) || Math.abs(sumWeights) < 1e-12) {
      throw new Error('LOCAL_PCM_RESAMPLE_FILTER_FAILED');
    }
    return weighted / sumWeights;
  }

  function appendResult(value: number): Float32Array | null {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_LOCAL_PCM_OUTPUT');
    output[outputLength++] = value;
    if (outputLength !== OUTPUT_FRAME_SAMPLES) return null;
    const completed = output;
    output = new Float32Array(OUTPUT_FRAME_SAMPLES);
    outputLength = 0;
    return completed;
  }

  for await (const frame of frames) {
    checkCancelled(options.signal);
    if (!(frame instanceof Float32Array) || frame.length > maxFrameSamples) {
      throw new Error('INVALID_LOCAL_PCM_RESAMPLE_FRAME');
    }

    for (const sample of frame) {
      checkCancelled(options.signal);
      if (!Number.isFinite(sample)) throw new Error('NON_FINITE_LOCAL_PCM_SAMPLE');
      if (received === 0) firstSample = sample;
      lastSample = sample;
      ring[received % ring.length] = sample;
      received += 1;

      // Wait for enough future context before emitting each filtered sample.
      // This adds <= 32 input samples of latency, independent of stream size.
      while (Math.floor(nextOutputIndex * ratio) + FILTER_RADIUS < received) {
        checkCancelled(options.signal);
        const completed = appendResult(filterAt(nextOutputIndex * ratio));
        nextOutputIndex += 1;
        if (completed) yield completed;
      }
    }
  }

  checkCancelled(options.signal);
  // At EOF extend the last sample, outputting the exact source duration.
  // The absolute index prevents a cumulative rounding/timestamp drift.
  while (nextOutputIndex * sourceRate < received * LOCAL_ASR_SAMPLE_RATE) {
    checkCancelled(options.signal);
    const completed = appendResult(filterAt(nextOutputIndex * ratio));
    nextOutputIndex += 1;
    if (completed) yield completed;
  }
  if (outputLength > 0) yield output.slice(0, outputLength);
}
