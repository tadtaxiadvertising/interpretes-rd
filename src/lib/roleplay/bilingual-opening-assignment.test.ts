import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { openingAssignmentEnabled, readOpeningRequirement, insertOpeningRequiredSession } from './bilingual-opening-assignment';

const flags = ['ROLEPLAY_BILINGUAL_OPENING_API_ENABLED','ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED','ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED'] as const;
const data = { interpreterId: 7, recruitmentCandidateId: null, baseAudioUrl: '', status: 'DRAFT' } as const;
function enabled() { for (const flag of flags) vi.stubEnv(flag, 'true'); }
function fixture() {
  const query = vi.fn();
  return { query, tx: { $queryRaw: query } as unknown as Pick<Prisma.TransactionClient, '$queryRaw'> };
}
afterEach(() => vi.unstubAllEnvs());

describe('opening assignment snapshot', () => {
  it('requires all three rollout flags before creating a required session', async () => {
    for (const flag of flags) {
      enabled();
      vi.stubEnv(flag, '');
      const { tx, query } = fixture();
      expect(openingAssignmentEnabled()).toBe(false);
      await expect(insertOpeningRequiredSession(tx, data)).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    }
  });
  it('sets the requirement at insert rather than modifying an existing session', async () => {
    enabled();
    const { tx, query } = fixture();
    const date = new Date();
    query.mockImplementation(async (_sql, id) => [{ id, updatedAt: date }]);
    const result = await insertOpeningRequiredSession(tx, data);
    expect(result).toMatchObject({ id: expect.any(String), updatedAt: date, status: 'DRAFT' });
    expect(query.mock.calls[0][0].join('')).toContain('requires_bilingual_opening');
    expect(query.mock.calls[0][0].join('')).toContain('INSERT INTO public.roleplay_sessions');
    expect(query.mock.calls[0].slice(1)).toEqual([result.id, 7, null, '', null, 'DRAFT']);
  });
  it('rejects ambiguous owner or missing persisted requirement', async () => {
    enabled();
    const { tx, query } = fixture();
    await expect(insertOpeningRequiredSession(tx, { ...data, recruitmentCandidateId: 9 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValueOnce([{ required: true }]).mockResolvedValueOnce([{ required: false }]).mockResolvedValueOnce([]);
    await expect(readOpeningRequirement(tx, 'session')).resolves.toBe(true);
    await expect(readOpeningRequirement(tx, 'session')).resolves.toBe(false);
    await expect(readOpeningRequirement(tx, 'session')).rejects.toThrow();
  });
});
