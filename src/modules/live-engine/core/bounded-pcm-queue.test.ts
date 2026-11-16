import { describe, expect, it } from 'vitest';
import { BoundedLocalPcmQueue } from './bounded-pcm-queue';

const queue = () => new BoundedLocalPcmQueue({ maxBufferedSamples: 6, maxFrameSamples: 4 });

describe('bounded PCM queue', () => {
  it('copies source frames and reports bounded high-water memory', async () => {
    const q = queue();
    const input = Float32Array.from([1, 2, 3]);
    q.push(input);
    input[0] = 100;
    q.push(Float32Array.from([4, 5]));
    expect(q.getStats()).toMatchObject({
      bufferedSamples: 5, bufferedFrames: 2, peakBufferedSamples: 5, acceptedSamples: 5,
    });
    expect(Array.from((await q.next()).value!)).toEqual([1, 2, 3]);
    expect(Array.from((await q.next()).value!)).toEqual([4, 5]);
    expect(q.getStats().bufferedSamples).toBe(0);
  });

  it('delivers a waiting frame directly without buffering', async () => {
    const q = queue();
    const next = q.next();
    q.push(Float32Array.from([7, 8]));
    expect(Array.from((await next).value!)).toEqual([7, 8]);
    expect(q.getStats().bufferedSamples).toBe(0);
    q.close();
  });

  it('fails closed on overload, without silently dropping speech or changing offsets', async () => {
    const q = queue();
    q.push(Float32Array.from([1, 2, 3, 4]));
    expect(() => q.push(Float32Array.from([5, 6, 7, 8]))).toThrow('LOCAL_PCM_QUEUE_OVERFLOW');
    expect(q.getStats()).toMatchObject({ closed: true, bufferedSamples: 0, bufferedFrames: 0 });
    await expect(q.next()).rejects.toThrow('LOCAL_PCM_QUEUE_OVERFLOW');
    expect(() => q.push(Float32Array.from([9]))).toThrow('LOCAL_PCM_QUEUE_OVERFLOW');
  });

  it('rejects bad frames and invalid capacities', async () => {
    expect(() => new BoundedLocalPcmQueue({ maxBufferedSamples: 2, maxFrameSamples: 3 }))
      .toThrow('INVALID_PCM_QUEUE_CAPACITY');
    const q = queue();
    expect(() => q.push(new Float32Array(5))).toThrow('INVALID_PCM_QUEUE_FRAME');
    await expect(q.next()).rejects.toThrow('INVALID_PCM_QUEUE_FRAME');
  });

  it('closes cleanly and unblocks a waiting iterator', async () => {
    const q = queue();
    const result = q.next();
    q.close();
    expect((await result).done).toBe(true);
    expect((await q.next()).done).toBe(true);
  });

  it('propagates failure to a pending consumer and prevents concurrent waits', async () => {
    const q = queue();
    const pending = q.next();
    await expect(q.next()).rejects.toThrow('LOCAL_PCM_QUEUE_CONCURRENT_READ');
    q.fail(new Error('CAPTURE_TRACK_ENDED'));
    await expect(pending).rejects.toThrow('CAPTURE_TRACK_ENDED');
  });

  it('releases resources when an async consumer returns early', async () => {
    const q = queue();
    q.push(Float32Array.from([1]));
    q.push(Float32Array.from([2]));
    for await (const frame of q) {
      expect(frame[0]).toBe(1);
      break;
    }
    expect(q.getStats()).toMatchObject({ closed: true, bufferedFrames: 0 });
  });
});
