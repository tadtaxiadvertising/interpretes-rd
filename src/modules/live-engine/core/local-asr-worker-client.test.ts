import { describe, expect, it, vi } from 'vitest';
import { attachLocalAsrAudioWorker } from './local-asr-worker-runtime';
import { prepareCapturedLocalAsrChunksInWorker } from './local-asr-worker-client';
import type { LocalPcmCapture } from './local-pcm-capture';
import type {
  HostToLocalAsrWorker,
  LocalAsrWorkerEndpoint,
  LocalAsrWorkerHandle,
  LocalAsrWorkerToHost,
} from './local-asr-worker-protocol';
import { BoundedLocalPcmQueue } from './bounded-pcm-queue';

class InMemoryAsrWorker implements LocalAsrWorkerHandle {
  onmessage: ((event: MessageEvent<LocalAsrWorkerToHost>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  messagesFromHost: HostToLocalAsrWorker[] = [];
  messagesFromWorker: LocalAsrWorkerToHost[] = [];

  private endpoint: LocalAsrWorkerEndpoint = {
    onmessage: null,
    postMessage: (data) => {
      this.messagesFromWorker.push(data);
      queueMicrotask(() => {
        if (!this.terminated) this.onmessage?.({ data } as MessageEvent<LocalAsrWorkerToHost>);
      });
    },
  };

  constructor() { attachLocalAsrAudioWorker(this.endpoint); }

  postMessage(data: HostToLocalAsrWorker): void {
    this.messagesFromHost.push(data);
    queueMicrotask(() => {
      if (!this.terminated) this.endpoint.onmessage?.({ data } as MessageEvent<HostToLocalAsrWorker>);
    });
  }

  terminate(): void { this.terminated = true; }
}

function fakeCapture(source: AsyncIterable<Float32Array>, sampleRate = 48_000) {
  const stop = vi.fn();
  const capture = {
    sampleRate, frames: source, stop, getStats: vi.fn(),
  } as unknown as LocalPcmCapture;
  return { capture, stop };
}

async function* frames(...items: Float32Array[]) {
  for (const frame of items) yield frame;
}

describe('off-main-thread local ASR audio preparation protocol', () => {
  it('streams 48 kHz microphone frames through actual Worker runtime to 16 kHz windows', async () => {
    const { capture, stop } = fakeCapture(frames(new Float32Array(48_000).fill(0.25)));
    const worker = new InMemoryAsrWorker();
    const chunks = [];
    for await (const chunk of prepareCapturedLocalAsrChunksInWorker(capture, {
      chunkDurationMs: 500, overlapDurationMs: 100,
    }, () => worker)) chunks.push(chunk);

    expect(chunks.map(c => ({
      start: c.startSample, end: c.endSample, kind: c.kind, rate: c.sampleRate,
    }))).toEqual([
      { start: 0, end: 8_000, kind: 'full', rate: 16_000 },
      { start: 6_400, end: 14_400, kind: 'full', rate: 16_000 },
      { start: 12_800, end: 16_000, kind: 'tail', rate: 16_000 },
    ]);
    expect(Math.abs(chunks[0].samples[200] - 0.25)).toBeLessThan(0.001);
    expect(worker.terminated).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(worker.messagesFromHost.filter(m => m.type === 'next')).toHaveLength(4);
    expect(worker.messagesFromWorker.filter(m => m.type === 'need-frame')).toHaveLength(2);
  });

  it('requests no further audio until the consumer requests another output window', async () => {
    let fetched = 0;
    async function* source() {
      for (let i = 0; i < 80; i += 1) {
        fetched++;
        yield new Float32Array(1_024).fill(0.1);
      }
    }
    const { capture, stop } = fakeCapture(source());
    const worker = new InMemoryAsrWorker();
    const iterator = prepareCapturedLocalAsrChunksInWorker(capture, {
      chunkDurationMs: 500, overlapDurationMs: 100,
    }, () => worker);
    const first = await iterator.next();
    if (first.done) throw new Error('EXPECTED_FIRST_WORKER_WINDOW');
    const fetchedAtYield = fetched;
    expect(fetchedAtYield).toBeGreaterThan(0);
    expect(fetchedAtYield).toBeLessThan(80);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetched).toBe(fetchedAtYield);
    expect(worker.messagesFromHost.filter(m => m.type === 'next')).toHaveLength(1);
    await iterator.return();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(true);
  });

  it('cancels a pending microphone frame request without waiting for new audio', async () => {
    const queue = new BoundedLocalPcmQueue({ maxBufferedSamples: 1_024, maxFrameSamples: 1_024 });
    const stop = vi.fn(() => queue.close());
    const capture = {
      sampleRate: 48_000, frames: queue, stop, getStats: () => queue.getStats(),
    } satisfies LocalPcmCapture;
    const worker = new InMemoryAsrWorker();
    const abort = new AbortController();
    const iterator = prepareCapturedLocalAsrChunksInWorker(capture, {
      signal: abort.signal,
    }, () => worker);
    const pending = iterator.next();
    // Deliver init and the first 'need-frame' before cancelling.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    abort.abort();
    await expect(pending).rejects.toThrow('LOCAL_ASR_WORKER_CANCELLED');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(queue.getStats().closed).toBe(true);
    expect(worker.terminated).toBe(true);
  });

  it('propagates invalid PCM and stops the microphone instead of returning corrupt windows', async () => {
    const { capture, stop } = fakeCapture(frames(Float32Array.of(Number.NaN)));
    const worker = new InMemoryAsrWorker();
    const iterator = prepareCapturedLocalAsrChunksInWorker(capture, {}, () => worker);
    await expect(iterator.next()).rejects.toThrow('NON_FINITE_LOCAL_PCM_SAMPLE');
    expect(worker.terminated).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('terminates a crashed Worker and rejects the pending window', async () => {
    const queue = new BoundedLocalPcmQueue({ maxBufferedSamples: 1024, maxFrameSamples: 1024 });
    const stop = vi.fn(() => queue.close());
    const capture = {
      sampleRate: 48_000, frames: queue, stop, getStats: () => queue.getStats(),
    } satisfies LocalPcmCapture;
    const worker = new InMemoryAsrWorker();
    const iterator = prepareCapturedLocalAsrChunksInWorker(capture, {}, () => worker);
    const pending = iterator.next();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    worker.onerror?.(new ErrorEvent('error'));
    await expect(pending).rejects.toThrow('LOCAL_ASR_WORKER_CRASHED');
    expect(worker.terminated).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('rejects browsers without Web Workers before reading microphone frames', async () => {
    // The caller may use an injected Worker only for controlled tests.
    const { capture, stop } = fakeCapture(frames(new Float32Array(1024)));
    const original = globalThis.Worker;
    vi.stubGlobal('Worker', undefined);
    try {
      const iterator = prepareCapturedLocalAsrChunksInWorker(capture);
      await expect(iterator.next()).rejects.toThrow('LOCAL_ASR_WORKER_UNSUPPORTED');
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal('Worker', original);
      vi.unstubAllGlobals();
    }
  });
});
