import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { canProgressPastBilingualOpening } from './bilingual-opening-guard';

const id = 'session-1';
const evidence = { required: true, sourceAudioPath: 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm', durationSec: 42, confirmedAt: new Date() };
function fixture(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue(rows);
  return { query, db: { $queryRaw: query } as unknown as Pick<Prisma.TransactionClient, '$queryRaw'> };
}
afterEach(() => vi.unstubAllEnvs());

describe('bilingual opening progression guard', () => {
  it('does not access the staged schema until explicitly enabled', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', '');
    const { db, query } = fixture([]);
    await expect(canProgressPastBilingualOpening(db, id)).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('allows exempt sessions and confirmed required sessions', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', 'true');
    for (const row of [{ required: false }, evidence]) {
      const { db, query } = fixture([row]);
      await expect(canProgressPastBilingualOpening(db, id)).resolves.toBe(true);
      expect(query.mock.calls[0][1]).toBe(id);
    }
  });

  it('rejects absent sessions, pending openings and invalid persisted evidence', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', 'true');
    for (const rows of [[], [{ required: true }], [{ ...evidence, durationSec: 0 }],
      [{ ...evidence, sourceAudioPath: evidence.sourceAudioPath.replace('session-1', 'session-2') }],
      [{ ...evidence, confirmedAt: new Date(NaN) }], [{ ...evidence, required: null }]]) {
      await expect(canProgressPastBilingualOpening(fixture(rows).db, id)).resolves.toBe(false);
    }
  });

  it('does not fail open during database outages', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', 'true');
    const { db, query } = fixture([]);
    query.mockRejectedValueOnce(new Error('unavailable'));
    await expect(canProgressPastBilingualOpening(db, id)).rejects.toThrow();
  });
});
