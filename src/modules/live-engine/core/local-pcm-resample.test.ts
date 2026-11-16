import { describe, expect, it } from 'vitest';
import { LOCAL_ASR_SAMPLE_RATE, resampleLocalPcmTo16k } from './local-pcm-resample';

async function* frames(...items: Float32Array[]) {
  for (const item of items) yield item;
}

async function collect(source: AsyncIterable<Float32Array>, rate: number, signal?: AbortSignal) {
  const chunks: Float32Array[] = [];
  for await (const chunk of resampleLocalPcmTo16k(source, { sourceSampleRate: rate, signal })) {
    expect(chunk.length).toBeGreaterThan(0);
    expect(chunk.length).toBeLessThanOrEqual(1024);
    chunks.push(chunk);
  }
  return Float32Array.from(chunks.flatMap(chunk => Array.from(chunk)));
}

function tone(sampleRate: number, hz: number, seconds = 1, amplitude = 0.6) {
  return Float32Array.from(
    { length: sampleRate * seconds },
    (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / sampleRate),
  );
}

function rms(samples: Float32Array, start = 0, end = samples.length) {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += samples[i] ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe('streaming local 16 kHz PCM resampling', () => {
  it('preserves sample count and DC amplitude for both common browser rates', async () => {
    for (const sourceRate of [44_100, 48_000]) {
      const result = await collect(frames(new Float32Array(sourceRate).fill(0.25)), sourceRate);
      expect(result.length).toBe(LOCAL_ASR_SAMPLE_RATE);
      expect(result.every(sample => Math.abs(sample - 0.25) < 0.001)).toBe(true);
    }
  });

  it('keeps the exact same output across unrelated input frame boundaries', async () => {
    const source = tone(44_100, 830, 1);
    const whole = await collect(frames(source), 44_100);
    const inputFrames: Float32Array[] = [];
    for (let i = 0; i < source.length; i += 317) inputFrames.push(source.slice(i, i + 317));
    const split = await collect(frames(...inputFrames), 44_100);
    expect(split.length).toBe(16_000);
    expect(Array.from(split)).toEqual(Array.from(whole));
  });

  it('retains normal speech-band tones and suppresses higher-frequency aliasing', async () => {
    const pass = await collect(frames(tone(48_000, 1_000)), 48_000);
    const reject = await collect(frames(tone(48_000, 12_000)), 48_000);
    const passRms = rms(pass, 300, 15_700);
    const rejectRms = rms(reject, 300, 15_700);
    expect(passRms).toBeGreaterThan(0.30);
    expect(rejectRms).toBeLessThan(passRms * 0.04);
  });

  it('does not modify 16 kHz native capture samples, including frame boundaries', async () => {
    const input = tone(16_000, 660, 1);
    const output = await collect(frames(input.slice(0, 711), input.slice(711)), 16_000);
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it('uses absolute sample counts without losing or duplicating time for short and empty input', async () => {
    const empty = await collect(frames(new Float32Array()), 48_000);
    expect(empty.length).toBe(0);
    const single = await collect(frames(Float32Array.of(0.3)), 48_000);
    expect(single.length).toBe(1);
    expect(single[0]).toBeCloseTo(0.3, 5);
    const oneAndHalf = await collect(frames(new Float32Array(66_150).fill(0.2)), 44_100);
    expect(oneAndHalf.length).toBe(24_000);
  });

  it('supports lower-rate input without claiming to recover lost frequency detail', async () => {
    const result = await collect(frames(tone(8_000, 1_000)), 8_000);
    expect(result.length).toBe(16_000);
    expect(rms(result, 300, 15_700)).toBeGreaterThan(0.25);
  });

  it('fails closed on invalid rates, malformed frames and non-finite PCM', async () => {
    await expect(collect(frames(Float32Array.of(1)), 0))
      .rejects.toThrow('INVALID_LOCAL_PCM_RESAMPLE_RATE');
    await expect(collect(frames(Float32Array.of(1)), 44_100.5))
      .rejects.toThrow('INVALID_LOCAL_PCM_RESAMPLE_RATE');
    await expect(collect(frames(new Float32Array(96_001)), 48_000))
      .rejects.toThrow('INVALID_LOCAL_PCM_RESAMPLE_FRAME');
    await expect(collect(frames(Float32Array.from([1, Number.NaN])), 48_000))
      .rejects.toThrow('NON_FINITE_LOCAL_PCM_SAMPLE');
    await expect(collect(frames(Float32Array.from([1, Number.POSITIVE_INFINITY])), 16_000))
      .rejects.toThrow('NON_FINITE_LOCAL_PCM_SAMPLE');
  });

  it('does not prefetch further input while the consumer holds a completed output frame', async () => {
    let fetched = 0;
    async function* source() {
      fetched += 1;
      yield tone(48_000, 200);
      fetched += 1;
      yield Float32Array.of(0);
    }
    const iterator = resampleLocalPcmTo16k(source(), { sourceSampleRate: 48_000 });
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value?.length).toBe(1024);
    expect(fetched).toBe(1);
    await iterator.return();
    expect(fetched).toBe(1);
  });

  it('honors cancellation after yielding a frame and before processing more samples', async () => {
    const abort = new AbortController();
    const iterator = resampleLocalPcmTo16k(frames(tone(48_000, 330)), {
      sourceSampleRate: 48_000, signal: abort.signal,
    });
    expect((await iterator.next()).done).toBe(false);
    abort.abort();
    await expect(iterator.next()).rejects.toThrow('LOCAL_PCM_RESAMPLE_CANCELLED');
  });

  it('provides independent output buffers, even when the next frame is processed', async () => {
    const iterator = resampleLocalPcmTo16k(frames(new Float32Array(48_000).fill(0.3)), {
      sourceSampleRate: 48_000,
    });
    const first = await iterator.next();
    if (first.done) throw new Error('Missing first resampled frame');
    const snapshot = first.value.slice();
    const second = await iterator.next();
    if (second.done) throw new Error('Missing second resampled frame');
    second.value[0] = 90;
    expect(Array.from(first.value)).toEqual(Array.from(snapshot));
    await iterator.return();
  });
});
