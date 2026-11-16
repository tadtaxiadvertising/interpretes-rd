import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type WorkletInstance = {
  port: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: { data: { type: string } }) => void) | null;
  };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

function createProcessor(credits: number) {
  let Constructor: (new (options: { processorOptions: { packetCredits: number } }) => WorkletInstance) | null = null;
  const basePostMessage = vi.fn();
  const source = readFileSync(resolve(process.cwd(), 'public/live-pcm-capture-worklet.js'), 'utf8');
  runInNewContext(source, {
    Float32Array,
    AudioWorkletProcessor: class {
      port = { postMessage: basePostMessage, onmessage: null };
    },
    registerProcessor(name: string, constructor: typeof Constructor) {
      expect(name).toBe('free-interpreters-live-pcm');
      Constructor = constructor;
    },
  });
  if (!Constructor) throw new Error('WORKLET_NOT_REGISTERED');
  const processor = new Constructor({ processorOptions: { packetCredits: credits } });
  return { processor, postMessage: basePostMessage };
}

const block = () => new Float32Array(1024).fill(0.25);
const output = () => new Float32Array(1024).fill(0.99);

describe('same-origin AudioWorklet packet flow control', () => {
  it('emits silence into the output graph and never forwards live mic audio there', () => {
    const { processor, postMessage } = createProcessor(1);
    const audioOutput = output();
    expect(processor.process([[block()]], [[audioOutput]])).toBe(true);
    expect(audioOutput.every(value => value === 0)).toBe(true);
    const first = postMessage.mock.calls[0]?.[0] as { type: string; samples: Float32Array };
    expect(first.type).toBe('pcm');
    expect(first.samples.length).toBe(1024);
  });

  it('halts on exhausted packet credits instead of buffering unlimited port messages', () => {
    const { processor, postMessage } = createProcessor(1);
    expect(processor.process([[block()]], [[output()]])).toBe(true);
    expect(processor.process([[block()]], [[output()]])).toBe(false);
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'overflow' });
    expect(postMessage.mock.calls.filter(([message]) => message?.type === 'pcm')).toHaveLength(1);
  });

  it('only releases additional capacity when receiving an explicit consumer credit', () => {
    const { processor, postMessage } = createProcessor(1);
    expect(processor.process([[block()]], [[output()]])).toBe(true);
    processor.port.onmessage?.({ data: { type: 'credit' } });
    expect(processor.process([[block()]], [[output()]])).toBe(true);
    expect(processor.process([[block()]], [[output()]])).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message?.type === 'pcm')).toHaveLength(2);
  });

  it('stops processing without posting further samples after shutdown', () => {
    const { processor, postMessage } = createProcessor(2);
    processor.port.onmessage?.({ data: { type: 'stop' } });
    expect(processor.process([[block()]], [[output()]])).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
