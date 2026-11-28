import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { inspectDirectRolloutMetadata } from './direct-upload-rollout-inspection';

function fixture() {
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: vi.fn() };
  tx.$queryRaw.mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ opening: false, capability: false, release_gate: false, assignment_hash: false }])
    .mockResolvedValueOnce([{ present: true }])
    .mockResolvedValueOnce([
      { id: 'roleplay-audio-private', name: 'roleplay-audio-private', public: false, file_size_limit: '15728640',
        allowed_mime_types: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4'], private_detail: 'not returned' },
      { id: 'roleplay-opening-private', name: 'roleplay-opening-private', public: true, file_size_limit: '15728640',
        allowed_mime_types: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'] },
    ]);
  const transaction = vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  return { tx, transaction, db: { $transaction: transaction } as unknown as Pick<PrismaClient, '$transaction'> };
}

describe('runtime rollout metadata inspection', () => {
  it('uses one bounded read-only transaction and projects fixed metadata only', async () => {
    const f = fixture();
    const result = await inspectDirectRolloutMetadata(f.db);
    expect(result).toMatchObject({
      schemaMetadataReady: false,
      buckets: [
        { id: 'roleplay-audio-private', state: 'metadata-ready' },
        { id: 'roleplay-opening-private', state: 'review-required' },
      ],
    });
    expect(result?.tableChecks).toHaveLength(9);
    expect(result?.triggerChecks).toHaveLength(11);
    expect(JSON.stringify(result)).not.toContain('not returned');
    expect(f.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000,
    });
    expect(f.tx.$executeRaw.mock.calls[0][0][0]).toBe('SET TRANSACTION READ ONLY');
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(5);
  });

  it('does not expose SQL or credentials when a metadata query fails', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockReset().mockRejectedValue(new Error('PRIVATE_CONNECTION_DETAILS'));
    expect(await inspectDirectRolloutMetadata(f.db)).toBeNull();
  });
});
