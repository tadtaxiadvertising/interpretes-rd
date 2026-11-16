import { describe, expect, it, vi } from 'vitest';
import { prepareCapturedLocalAsrChunks } from './local-asr-audio-preparation';
import type { LocalPcmCapture } from './local-pcm-capture';

function fakeCapture(data: Float32Array[], sampleRate = 48_000) {
  const stop = vi.fn();
  const capture = {
    sampleRate,
    frames: (async function* () {
      for (const frame of data) yield frame;
    })(),
    stop,
    getStats: vi.fn(),
  } as unknown as LocalPcmCapture;
  return { capture, stop };
}

describe('captured local speech preparation pipeline', () => {
  it('converts 48 kHz captured PCM into 16 kHz chunks with sample-derived offsets', async () => {
    const { capture, stop } = fakeCapture([new Float32Array(48_000).fill(0.2)]);
    const results = [];
    for await (const chunk of prepareCapturedLocalAsrChunks(capture, {
      chunkDurationMs: 500,
      overlapDurationMs: 100,
    })) results.push(chunk);

    expect(results.map(c => ({
      start: c.startSample, end: c.endSample, rate: c.sampleRate, kind: c.kind,
    }))).toEqual([
      { start: 0, end: 8000, rate: 16000, kind: 'full' },
      { start: 6400, end: 14400, rate: 16000, kind: 'full' },
      { start: 12800, end: 16000, rate: 16000, kind: 'tail' },
    ]);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('always releases microphone when an ASR consumer stops before end of stream', async () => {
    const { capture, stop } = fakeCapture([new Float32Array(48_000).fill(0.1)]);
    const iterator = prepareCapturedLocalAsrChunks(capture, {
      chunkDurationMs: 500, overlapDurationMs: 100,
    });
    expect((await iterator.next()).done).toBe(false);
    await iterator.return();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops the microphone and surfaces cancellation instead of hiding missing speech', async () => {
    const abort = new AbortController();
    const { capture, stop } = fakeCapture([new Float32Array(48_000).fill(0.1)]);
    const iterator = prepareCapturedLocalAsrChunks(capture, {
      chunkDurationMs: 500,
      signal: abort.signal,
    });
    expect((await iterator.next()).done).toBe(false);
    abort.abort();
    await expect(iterator.next()).rejects.toThrow('LOCAL_PCM_PROCESSING_CANCELLED');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('fails and frees capture rather than streaming malformed PCM into the model', async () => {
    const { capture, stop } = fakeCapture([Float32Array.of(Number.NaN)]);
    const iterator = prepareCapturedLocalAsrChunks(capture);
    await expect(iterator.next()).rejects.toThrow('NON_FINITE_LOCAL_PCM_SAMPLE');
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
