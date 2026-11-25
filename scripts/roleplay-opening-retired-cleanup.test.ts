import { describe, expect, it, vi } from 'vitest';
import { cleanRetiredOpeningBatch, matchesHostedOpeningProject } from './roleplay-opening-retired-cleanup';

const path = 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm';
const candidate = { path, sessionId: 'session-1' };
function fixture() {
  return { candidates: vi.fn().mockResolvedValue([candidate]), stillEligible: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(undefined), absent: vi.fn().mockResolvedValue(true) };
}
describe('retired opening cleanup', () => {
  it('previews by default and limits inventory to ten objects', async () => {
    const port = fixture();
    expect(await cleanRetiredOpeningBatch(port)).toEqual({ candidates: 1, removed: 0, skipped: 0 });
    expect(port.candidates).toHaveBeenCalledWith(10);
    expect(port.remove).not.toHaveBeenCalled();
  });
  it('rechecks eligibility before deletion and verifies absence', async () => {
    const port = fixture();
    expect(await cleanRetiredOpeningBatch(port, true)).toEqual({ candidates: 1, removed: 1, skipped: 0 });
    expect(port.stillEligible).toHaveBeenCalledWith(candidate);
    expect(port.remove).toHaveBeenCalledWith(path);
    expect(port.absent).toHaveBeenCalledWith(path);
    expect(port.stillEligible.mock.invocationCallOrder[0]).toBeLessThan(port.remove.mock.invocationCallOrder[0]);
  });
  it('skips paths no longer eligible', async () => {
    const port = fixture();
    port.stillEligible.mockResolvedValue(false);
    expect(await cleanRetiredOpeningBatch(port, true)).toEqual({ candidates: 1, removed: 0, skipped: 1 });
    expect(port.remove).not.toHaveBeenCalled();
  });
  it('rejects foreign, duplicate or oversized inventories before deletion', async () => {
    for (const rows of [[{ ...candidate, sessionId: 'other' }], [candidate, candidate],
      Array.from({ length: 11 }, () => candidate)]) {
      const port = fixture();
      port.candidates.mockResolvedValue(rows);
      await expect(cleanRetiredOpeningBatch(port, true)).rejects.toThrow();
      expect(port.remove).not.toHaveBeenCalled();
    }
  });
  it('stops immediately on uncertain deletion', async () => {
    const port = fixture();
    port.candidates.mockResolvedValue([candidate, { ...candidate, path: path.replace('174000','174001') }]);
    port.absent.mockResolvedValueOnce(false);
    await expect(cleanRetiredOpeningBatch(port, true)).rejects.toThrow('Opening deletion not verified');
    expect(port.remove).toHaveBeenCalledTimes(1);
  });
});
describe('cleanup target identity', () => {
  const ref = 'abcdefghijklmnopqrst';
  const url = 'https://' + ref + '.supabase.co';
  it('accepts matching hosted direct and session-pooler projects', () => {
    expect(matchesHostedOpeningProject(url, 'postgresql://postgres@db.' + ref + '.supabase.co:5432/postgres')).toBe(true);
    expect(matchesHostedOpeningProject(url, 'postgresql://postgres.' + ref + '@aws-0-us-east-1.pooler.supabase.com:5432/postgres')).toBe(true);
  });
  it('rejects different projects, custom endpoints and transaction poolers', () => {
    expect(matchesHostedOpeningProject(url, 'postgresql://postgres@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres')).toBe(false);
    expect(matchesHostedOpeningProject(url, 'postgresql://postgres.' + ref + '@aws-0-us-east-1.pooler.supabase.com:6543/postgres')).toBe(false);
    expect(matchesHostedOpeningProject('https://custom.example', 'postgresql://postgres@db.' + ref + '.supabase.co:5432/postgres')).toBe(false);
  });
});
