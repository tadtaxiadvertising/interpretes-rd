import { describe, expect, it, vi } from 'vitest';
import { attachWhisperTinyWorker } from './whisper-tiny-runtime';
import { loadLocalWhisperTiny } from './whisper-tiny-client';
import type {
  WhisperRequest, WhisperResponse, WhisperWorkerPort, WhisperWorkerHandle,
} from './whisper-tiny-protocol';

class SimulatedWorker implements WhisperWorkerHandle {
  onmessage: ((event: MessageEvent<WhisperResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  sent: WhisperRequest[] = [];
  readonly endpoint: WhisperWorkerPort = {
    onmessage: null,
    postMessage: (response) => {
      queueMicrotask(() => {
        if (!this.terminated) this.onmessage?.({ data: response } as MessageEvent<WhisperResponse>);
      });
    },
  };
  constructor(loader: Parameters<typeof attachWhisperTinyWorker>[1]) {
    attachWhisperTinyWorker(this.endpoint, loader);
  }
  postMessage(message: WhisperRequest): void {
    this.sent.push(message);
    queueMicrotask(() => {
      if (!this.terminated) this.endpoint.onmessage?.({ data: message } as MessageEvent<WhisperRequest>);
    });
  }
  terminate(): void { this.terminated = true; }
}

describe('local Whisper tiny model session', () => {
  it('initializes only after explicitly requested and transcribes ES/EN on-device', async () => {
    const model = vi.fn(async (_samples: Float32Array, language: string) => language === 'es' ? 'Hola' : 'Hello');
    const loader = vi.fn(async () => model);
    const worker = new SimulatedWorker(loader);
    expect(loader).not.toHaveBeenCalled();
    const session = await loadLocalWhisperTiny({ language: 'es' }, () => worker);
    expect(loader).toHaveBeenCalledTimes(1);
    const samples = new Float32Array(16_000).fill(0.5);
    const first = await session.transcribe(samples, 'es');
    expect(first).toBe('Hola');
    expect(await session.transcribe(samples, 'en')).toBe('Hello');
    expect(samples[0]).toBe(0.5);
    expect(worker.sent.filter(m => m.type === 'transcribe')).toHaveLength(2);
    session.close();
    session.close();
    expect(worker.terminated).toBe(true);
    await expect(session.transcribe(samples, 'en')).rejects.toThrow('LOCAL_WHISPER_CANCELLED');
  });

  it('terminates model downloads immediately upon cancellation', async () => {
    const loader = vi.fn(() => new Promise<() => Promise<string>>(() => {}));
    const worker = new SimulatedWorker(loader);
    const abort = new AbortController();
    const pending = loadLocalWhisperTiny({ language: 'en', signal: abort.signal }, () => worker);
    // Ensure worker receives 'load', then cancel even though download remains pending.
    await Promise.resolve();
    abort.abort();
    await expect(pending).rejects.toThrow('LOCAL_WHISPER_CANCELLED');
    expect(worker.terminated).toBe(true);
  });

  it('rejects attempts to overlap inference windows instead of accumulating PCM', async () => {
    let release!: (text: string) => void;
    const model = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const worker = new SimulatedWorker(vi.fn(async () => model));
    const session = await loadLocalWhisperTiny({ language: 'es' }, () => worker);
    const pcm = new Float32Array(16_000).fill(0.3);
    const first = session.transcribe(pcm, 'es');
    await expect(session.transcribe(pcm, 'es')).rejects.toThrow('LOCAL_WHISPER_BUSY');
    await Promise.resolve();
    release('Primero');
    expect(await first).toBe('Primero');
    session.close();
  });

  it('cleans up on Worker crash while input is in flight', async () => {
    const model = vi.fn(() => new Promise<string>(() => {}));
    const worker = new SimulatedWorker(vi.fn(async () => model));
    const session = await loadLocalWhisperTiny({ language: 'es' }, () => worker);
    const active = session.transcribe(new Float32Array(2000).fill(0.5), 'es');
    worker.onerror?.(new ErrorEvent('error'));
    await expect(active).rejects.toThrow('LOCAL_WHISPER_CRASHED');
    expect(worker.terminated).toBe(true);
  });

  it('does not touch Worker API on a missing/disabled browser before consent', async () => {
    vi.stubGlobal('Worker', undefined);
    try {
      await expect(loadLocalWhisperTiny({ language: 'es' }))
        .rejects.toThrow('LOCAL_WHISPER_UNSUPPORTED');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
