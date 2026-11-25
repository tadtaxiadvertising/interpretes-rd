import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { loadBilingualOpeningReview } from './bilingual-opening-review';

const id = 'session-1';
const path = 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm';
const row = { required: true, sourceAudioPath: path, durationSec: 42, confirmedAt: new Date() };

function fixture(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue(rows);
  const sign = vi.fn().mockResolvedValue('https://storage.example.test/signed');
  return { query, sign, db: { $queryRaw: query } as unknown as Pick<Prisma.TransactionClient, '$queryRaw'> };
}

afterEach(() => vi.unstubAllEnvs());

describe('opening QA playback', () => {
  it('does not access the staged schema while disabled', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', '');
    const { db, query, sign } = fixture([]);
    expect(await loadBilingualOpeningReview(db, id, sign)).toEqual({ state: 'not-required' });
    expect(query).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it('signs only confirmed canonical audio and omits its raw key', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', 'true');
    const { db, query, sign } = fixture([row]);
    expect(await loadBilingualOpeningReview(db, id, sign)).toEqual({
      state: 'confirmed', durationSec: 42, audioUrl: 'https://storage.example.test/signed',
    });
    expect(query.mock.calls[0][1]).toBe(id);
    expect(sign).toHaveBeenCalledWith(path);
  });

  it('does not sign exempt, missing or invalid evidence', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', 'true');
    for (const [rows, state] of [
      [[{ required: false }], 'not-required'],
      [[], 'unavailable'],
      [[{ required: true }], 'pending'],
      [[{ ...row, sourceAudioPath: path.replace('session-1', 'other') }], 'pending'],
      [[{ ...row, durationSec: 301 }], 'pending'],
    ] as const) {
      const { db, sign } = fixture([...rows]);
      expect(await loadBilingualOpeningReview(db, id, sign)).toEqual({ state });
      expect(sign).not.toHaveBeenCalled();
    }
  });

  it('distinguishes signing failure from database outage without exposing private errors', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', 'true');
    const { db, query, sign } = fixture([row]);
    sign.mockRejectedValueOnce(new Error('private-storage-token'));
    expect(await loadBilingualOpeningReview(db, id, sign)).toEqual({ state: 'confirmed', durationSec: 42, audioUrl: null });
    query.mockRejectedValueOnce(new Error('private-database-details'));
    expect(await loadBilingualOpeningReview(db, id, sign)).toEqual({ state: 'unavailable' });
    expect(sign).toHaveBeenCalledTimes(1);
  });
});
