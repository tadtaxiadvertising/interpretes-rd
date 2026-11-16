import { describe, expect, it, vi } from 'vitest';
import { attachWhisperTinyWorker } from './whisper-tiny-runtime';
import type { WhisperRequest, WhisperResponse, WhisperWorkerPort } from './whisper-tiny-protocol';

function setup(loader = vi.fn(async () => vi.fn(async () => ' Buenos días. '))) {
  const messages: WhisperResponse[] = [];
  const port: WhisperWorkerPort = {
    onmessage: null,
    postMessage: (message) => { messages.push(message); },
  };
  attachWhisperTinyWorker(port, loader);
  const send = (message: WhisperRequest) => port.onmessage?.({ data: message } as MessageEvent<WhisperRequest>);
  return { messages, send, loader };
}

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('local Whisper tiny Worker safety', () => {
  it('never invokes model loading without an explicit load action', async () => {
    const { send, messages, loader } = setup();
    await tick();
    expect(loader).not.toHaveBeenCalled();
    send({ type: 'transcribe', id: 1, language: 'es', samples: Float32Array.of(0.1) });
    expect(messages).toContainEqual({ type: 'error', code: 'LOCAL_WHISPER_BAD_STATE' });
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads one model and transcribes in requested language', async () => {
    const engine = vi.fn(async (_pcm: Float32Array, lang: string) => lang === 'es' ? ' Hola. ' : ' Hello. ');
    const loader = vi.fn(async () => engine);
    const { send, messages } = setup(loader);
    send({ type: 'load', language: 'es' });
    await tick();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(messages).toContainEqual({ type: 'ready' });
    const pcm = new Float32Array(16_000).fill(0.3);
    send({ type: 'transcribe', id: 1, language: 'es', samples: pcm });
    await tick();
    expect(engine).toHaveBeenCalledWith(pcm, 'es');
    expect(messages).toContainEqual({ type: 'result', id: 1, text: 'Hola.' });
  });

  it('filters silence before calling the model to prevent hallucinated words', async () => {
    const engine = vi.fn(async () => 'hallucination');
    const { send, messages } = setup(vi.fn(async () => engine));
    send({ type: 'load', language: 'en' });
    await tick();
    send({ type: 'transcribe', id: 2, language: 'en', samples: new Float32Array(16_000) });
    expect(messages).toContainEqual({ type: 'result', id: 2, text: '' });
    expect(engine).not.toHaveBeenCalled();
  });

  it('rejects non-finite or oversized audio without invoking the engine', async () => {
    const engine = vi.fn(async () => 'not called');
    const { send, messages } = setup(vi.fn(async () => engine));
    send({ type: 'load', language: 'es' });
    await tick();
    send({ type: 'transcribe', id: 3, language: 'es', samples: Float32Array.of(Number.NaN) });
    send({ type: 'transcribe', id: 4, language: 'es', samples: new Float32Array(480_001) });
    expect(messages).toContainEqual({ type: 'error', id: 3, code: 'LOCAL_WHISPER_INVALID_AUDIO' });
    expect(messages).toContainEqual({ type: 'error', id: 4, code: 'LOCAL_WHISPER_INVALID_AUDIO' });
    expect(engine).not.toHaveBeenCalled();
  });

  it('refuses concurrent inference and does not queue unbounded PCM', async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(done => { resolve = done; });
    const engine = vi.fn(() => pending);
    const { send, messages } = setup(vi.fn(async () => engine));
    send({ type: 'load', language: 'es' });
    await tick();
    const pcm = new Float32Array(2000).fill(0.2);
    send({ type: 'transcribe', id: 5, language: 'es', samples: pcm });
    send({ type: 'transcribe', id: 6, language: 'es', samples: pcm });
    expect(engine).toHaveBeenCalledTimes(1);
    expect(messages).toContainEqual({ type: 'error', code: 'LOCAL_WHISPER_BAD_STATE' });
    resolve('Listo');
    await tick();
    expect(messages).toContainEqual({ type: 'result', id: 5, text: 'Listo' });
  });
  it('fails closed if the model hallucinates an implausibly long transcript', async () => {
    const engine = vi.fn(async () => new Array(150).fill('fiebre').join(' '));
    const { send, messages } = setup(vi.fn(async () => engine));
    send({ type: 'load', language: 'es' });
    await tick();
    send({ type: 'transcribe', id: 77, language: 'es', samples: new Float32Array(4 * 16_000).fill(0.25) });
    await tick();
    expect(messages).toContainEqual({
      type: 'error',
      id: 77,
      code: 'LOCAL_WHISPER_SUSPICIOUS_OUTPUT',
    });
    expect(messages).not.toContainEqual(expect.objectContaining({ type: 'result', id: 77 }));
  });

});
