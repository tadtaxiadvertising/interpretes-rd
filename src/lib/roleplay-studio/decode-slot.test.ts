import { describe, expect, it, vi } from 'vitest';
import { withStudioDecodeSlot } from './decode-slot';

function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>(resolve => { finish = resolve; });
  return { promise, finish };
}

describe('studio decode serialization', () => {
  it('does not start a second decoder until a cancelled native task settles', async () => {
    const first = new AbortController();
    const native = deferred();
    const order: string[] = [];
    const a = withStudioDecodeSlot(first.signal, async () => {
      order.push('waveform');
      await native.promise;
      order.push('released');
    });
    const rejection = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    first.abort();
    const b = withStudioDecodeSlot(new AbortController().signal, async () => {
      order.push('conversion');
      return 'ready';
    });
    await Promise.resolve();
    expect(order).toEqual(['waveform']);
    native.finish();
    await rejection;
    await expect(b).resolves.toBe('ready');
    expect(order).toEqual(['waveform','released','conversion']);
  });

  it('skips queued cancellation before allocating and recovers after a rejected decode', async () => {
    const native = deferred();
    const first = withStudioDecodeSlot(new AbortController().signal, async () => {
      await native.promise;
      throw new Error('decoder rejected');
    });
    const firstRejected = expect(first).rejects.toThrow('decoder rejected');
    const waiting = new AbortController();
    const allocate = vi.fn(async () => 'unexpected');
    const cancelled = withStudioDecodeSlot(waiting.signal, allocate);
    const cancelledRejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    waiting.abort();
    const final = withStudioDecodeSlot(new AbortController().signal, async () => 'next');
    native.finish();
    await firstRejected;
    await cancelledRejected;
    await expect(final).resolves.toBe('next');
    expect(allocate).not.toHaveBeenCalled();
  });
});
