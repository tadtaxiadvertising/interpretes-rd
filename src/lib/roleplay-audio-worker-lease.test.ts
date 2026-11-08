import { describe, expect, it, vi } from 'vitest';
import { markResponseProcessingIfLeaseOwned } from './roleplay-audio-worker-lease';

describe('markResponseProcessingIfLeaseOwned', () => {
  it('does not change response state after the worker loses its lease', async () => {
    const renewOwnedLease = vi.fn().mockResolvedValue(false);
    const markResponseProcessing = vi.fn().mockResolvedValue(1);

    const result = await markResponseProcessingIfLeaseOwned({
      renewOwnedLease,
      markResponseProcessing,
    });

    expect(result).toBe(false);
    expect(renewOwnedLease).toHaveBeenCalledOnce();
    expect(markResponseProcessing).not.toHaveBeenCalled();
  });

  it('renews ownership before marking the response as processing', async () => {
    const calls: string[] = [];
    const result = await markResponseProcessingIfLeaseOwned({
      renewOwnedLease: async () => {
        calls.push('lease');
        return true;
      },
      markResponseProcessing: async () => {
        calls.push('response');
        return 1;
      },
    });

    expect(result).toBe(true);
    expect(calls).toEqual(['lease', 'response']);
  });

  it('fails the transaction when the source response is missing', async () => {
    await expect(markResponseProcessingIfLeaseOwned({
      renewOwnedLease: async () => true,
      markResponseProcessing: async () => 0,
    })).rejects.toThrow('The source response no longer exists for this conversion job');
  });
});
