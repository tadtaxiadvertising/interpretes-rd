import { describe, expect, it } from 'vitest';
import { chunkLocalPcmFrames, type LocalPcmChunk } from './local-pcm-chunks';

async function* frames(...items: Float32Array[]) {
  for (const item of items) yield item;
}

async function collect(input: AsyncIterable<Float32Array>, options: Parameters<typeof chunkLocalPcmFrames>[1]) {
  const chunks: LocalPcmChunk[] = [];
  for await (const chunk of chunkLocalPcmFrames(input, options)) chunks.push(chunk);
  return chunks;
}

const options = { sampleRate: 1_000, chunkDurationMs: 6, overlapDurationMs: 2 };

describe('bounded local PCM chunking', () => {
  it('chunks across frame boundaries with precise offsets and overlap', async () => {
    const chunks = await collect(
      frames(Float32Array.from([0, 1, 2, 3, 4]), Float32Array.from([5, 6, 7, 8, 9, 10])),
      options,
    );
    expect(chunks).toHaveLength(3);
    expect(chunks.map(c => ({ index: c.index, start: c.startSample, end: c.endSample, kind: c.kind })))
      .toEqual([
        { index: 0, start: 0, end: 6, kind: 'full' },
        { index: 1, start: 4, end: 10, kind: 'full' },
        { index: 2, start: 8, end: 11, kind: 'tail' },
      ]);
    expect(chunks.map(c => Array.from(c.samples))).toEqual([
      [0, 1, 2, 3, 4, 5],
      [4, 5, 6, 7, 8, 9],
      [8, 9, 10],
    ]);
    expect(chunks[1]).toMatchObject({ startMs: 4, endMs: 10, sampleRate: 1_000 });
  });

  it('does not re-emit duplicated overlap at exact end-of-stream', async () => {
    const chunks = await collect(frames(Float32Array.from([1, 2, 3, 4, 5, 6])), options);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('full');
  });

  it('emits short recordings once, without zero-length trailing chunks', async () => {
    const chunks = await collect(frames(new Float32Array(), Float32Array.from([1, 2])), options);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('tail');
    expect(Array.from(chunks[0].samples)).toEqual([1, 2]);
    expect(await collect(frames(new Float32Array()), options)).toEqual([]);
  });

  it('enforces producer backpressure rather than prefetching more frames', async () => {
    let fetched = 0;
    async function* source() {
      fetched += 1;
      yield Float32Array.from([0, 1, 2, 3, 4, 5]);
      fetched += 1;
      yield Float32Array.from([6]);
    }
    const iterator = chunkLocalPcmFrames(source(), options);
    const first = await iterator.next();
    expect(first.value?.kind).toBe('full');
    expect(fetched).toBe(1);
    await iterator.return();
    expect(fetched).toBe(1);
  });

  it('fails closed when cancelled while paused between emitted windows', async () => {
    const controller = new AbortController();
    const iterator = chunkLocalPcmFrames(
      frames(Float32Array.from([0, 1, 2, 3, 4, 5, 6])),
      { ...options, signal: controller.signal },
    );
    expect((await iterator.next()).value?.kind).toBe('full');
    controller.abort();
    await expect(iterator.next()).rejects.toThrow('LOCAL_PCM_PROCESSING_CANCELLED');
  });

  it('rejects malformed configuration and oversized frames', async () => {
    await expect(collect(frames(Float32Array.from([1])), { ...options, overlapDurationMs: 6 }))
      .rejects.toThrow('INVALID_PCM_OVERLAP');
    await expect(collect(frames(Float32Array.from([1])), { ...options, sampleRate: 0 }))
      .rejects.toThrow('INVALID_PCM_SAMPLE_RATE');
    await expect(collect(frames(new Float32Array(2_001)), options))
      .rejects.toThrow('INVALID_PCM_FRAME');
  });

  it('keeps each yielded output independent of the reusable window', async () => {
    const chunks = await collect(frames(Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8])), options);
    chunks[1].samples[0] = 99;
    expect(Array.from(chunks[0].samples)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
