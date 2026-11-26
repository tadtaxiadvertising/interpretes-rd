// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPasswordWorkGate } from '../../../interpreters-api/src/lib/password-work-gate';

describe('API password-work admission gate', () => {
  it('rejects excess work without starting or queueing it and recovers', async () => {
    const gate = createPasswordWorkGate(2);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const tasks = [gate(() => pending), gate(() => pending)];
    let started = false;
    try {
      await expect(gate(async () => { started = true; })).rejects.toMatchObject({ statusCode: 503 });
      expect(started).toBe(false);
    } finally {
      release();
      await Promise.all(tasks);
    }
    await expect(gate(async () => 42)).resolves.toBe(42);
  });

  it('releases a slot when the work rejects or throws synchronously', async () => {
    const gate = createPasswordWorkGate(1);
    await expect(gate(async () => { throw new Error('synthetic failure'); })).rejects.toThrow('synthetic failure');
    await expect(gate(() => { throw new Error('synthetic sync failure'); })).rejects.toThrow('synthetic sync failure');
    await expect(gate(async () => true)).resolves.toBe(true);
  });

  it.each([0, -1, 1.5, Infinity, NaN])('rejects invalid concurrency budget %s', budget => {
    expect(() => createPasswordWorkGate(budget)).toThrow();
  });
});
