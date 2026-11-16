import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalPcmCapture } from './local-pcm-capture';

const micStop = vi.fn();
const track = {
  stop: micStop,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
const stream = {
  getAudioTracks: () => [track],
  getTracks: () => [track],
} as unknown as MediaStream;
const getUserMedia = vi.fn(async (): Promise<MediaStream> => stream);

const source = { connect: vi.fn(), disconnect: vi.fn() };
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  sampleRate = 1600;
  audioWorklet = { addModule: vi.fn(async (_url: string) => {}) };
  destination = {};
  createMediaStreamSource = vi.fn(() => source);
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() { FakeAudioContext.instances.push(this); }
}
class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  static lastOptions: unknown = null;
  port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  onprocessorerror: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(_context?: unknown, _name?: string, options?: unknown) {
    FakeAudioWorkletNode.instances.push(this);
    FakeAudioWorkletNode.lastOptions = options;
  }

  receive(samples: unknown) {
    this.port.onmessage?.({ data: { type: 'pcm', samples } } as MessageEvent);
  }
}

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  FakeAudioContext.instances.length = 0;
  FakeAudioWorkletNode.instances.length = 0;
  FakeAudioWorkletNode.lastOptions = null;
});

describe('browser-local AudioWorklet PCM capture', () => {
  it('starts only on request and routes PCM through a same-origin worklet', async () => {
    const capture = await startLocalPcmCapture();
    const ctx = FakeAudioContext.instances[0];
    const node = FakeAudioWorkletNode.instances[0];
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith('/live-pcm-capture-worklet.js');
    expect(capture.sampleRate).toBe(1600);
    expect(FakeAudioWorkletNode.lastOptions).toMatchObject({
      processorOptions: { packetCredits: 4 },
    });
    const frame = Float32Array.from([1, 2, 3]);
    node.receive(frame);
    frame[0] = 99;
    const next = await capture.frames[Symbol.asyncIterator]().next();
    expect(Array.from(next.value!)).toEqual([1, 2, 3]);
    expect(capture.getStats().acceptedSamples).toBe(3);

    capture.stop();
    capture.stop();
    expect(micStop).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(node.disconnect).toHaveBeenCalledTimes(1);
    expect(node.port.close).toHaveBeenCalledTimes(1);
    expect((await capture.frames[Symbol.asyncIterator]().next()).done).toBe(true);
  });

  it('stops immediately rather than silently dropping audio when inference stalls', async () => {
    const capture = await startLocalPcmCapture();
    const node = FakeAudioWorkletNode.instances[0];
    // At fake 1600 Hz the queue holds a maximum of 3200 samples.
    for (let i = 0; i < 4; i += 1) node.receive(new Float32Array(1024));
    expect(capture.getStats()).toMatchObject({ closed: true, bufferedSamples: 0 });
    expect(micStop).toHaveBeenCalledTimes(1);
    await expect(capture.frames[Symbol.asyncIterator]().next()).rejects.toThrow('LOCAL_PCM_QUEUE_OVERFLOW');
  });

  it('releases late microphone permission grants after cancellation', async () => {
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const pending = startLocalPcmCapture({ signal: controller.signal });
    controller.abort();
    resolve(stream);
    await expect(pending).rejects.toThrow('LOCAL_PCM_CAPTURE_CANCELLED');
    expect(micStop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('fails closed in insecure contexts before requesting permission', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(startLocalPcmCapture()).rejects.toThrow('LOCAL_PCM_CAPTURE_UNSUPPORTED');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('releases resources when the worklet fails', async () => {
    const capture = await startLocalPcmCapture();
    FakeAudioWorkletNode.instances[0].onprocessorerror?.();
    expect(micStop).toHaveBeenCalledTimes(1);
    await expect(capture.frames[Symbol.asyncIterator]().next()).rejects.toThrow('LOCAL_PCM_PROCESSOR_FAILED');
  });
  it('returns packet credits only when the consumer advances', async () => {
    const capture = await startLocalPcmCapture();
    const node = FakeAudioWorkletNode.instances[0];
    const reader = capture.frames[Symbol.asyncIterator]();
    node.receive(Float32Array.from([1]));
    expect((await reader.next()).value?.[0]).toBe(1);
    expect(node.port.postMessage).not.toHaveBeenCalledWith({ type: 'credit' });
    node.receive(Float32Array.from([2]));
    expect((await reader.next()).value?.[0]).toBe(2);
    expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'credit' });
    capture.stop();
  });

  it('reports transport overflow instead of silently dropping microphone audio', async () => {
    const capture = await startLocalPcmCapture();
    const node = FakeAudioWorkletNode.instances[0];
    node.port.onmessage?.({ data: { type: 'overflow' } } as MessageEvent);
    expect(micStop).toHaveBeenCalledTimes(1);
    await expect(capture.frames[Symbol.asyncIterator]().next())
      .rejects.toThrow('LOCAL_PCM_TRANSPORT_OVERFLOW');
  });

  it('releases microphone immediately when an audio consumer breaks iteration', async () => {
    const capture = await startLocalPcmCapture();
    const node = FakeAudioWorkletNode.instances[0];
    node.receive(Float32Array.from([1, 2]));
    for await (const frame of capture.frames) {
      expect(Array.from(frame)).toEqual([1, 2]);
      break;
    }
    expect(micStop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
  });

});
