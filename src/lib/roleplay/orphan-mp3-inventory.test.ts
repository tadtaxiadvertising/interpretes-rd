import { describe, expect, it, vi } from 'vitest';
import {
  listRoleplayAudioObjects,
  listRoleplayMp3Paths,
  summarizeRoleplayAudioInventory,
  summarizeRoleplayMp3Inventory,
} from './orphan-mp3-inventory';

type Reader = Parameters<typeof listRoleplayMp3Paths>[0];

function readerWithList(list: ReturnType<typeof vi.fn>): Reader {
  return {
    storage: { from: () => ({ list }) },
  } as unknown as Reader;
}

describe('read-only Roleplay MP3 inventory', () => {
  it('paginates every Storage folder rather than silently truncating after 1000 entries', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      name: `${String(index).padStart(4, '0')}.mp3`,
      id: `file-${index}`, metadata: { size: 4 },
    }));
    const list = vi.fn(async (prefix: string, options: { limit: number; offset: number }) => {
      if (prefix === 'responses' && options.offset === 0) return { data: firstPage, error: null };
      if (prefix === 'responses' && options.offset === 1000) {
        return { data: [{ name: 'nested', id: null, metadata: null }], error: null };
      }
      if (prefix === 'responses/nested') {
        return { data: [
          { name: 'source.mp3', id: 'source-id', metadata: {} },
          { name: 'ignored.webm', id: 'webm-id', metadata: {} },
        ], error: null };
      }
      throw new Error('unexpected folder or page');
    });
    const paths = await listRoleplayMp3Paths(readerWithList(list));
    expect(paths).toHaveLength(1001);
    expect(paths).toContain('responses/nested/source.mp3');
    expect(paths).not.toContain('responses/nested/ignored.webm');
    expect(list).toHaveBeenCalledWith('responses', expect.objectContaining({
      limit: 1000, offset: 1000, sortBy: { column: 'name', order: 'asc' },
    }));
  });

  it('does not misclassify a referenced original MP3 as an orphan', () => {
    const summary = summarizeRoleplayMp3Inventory([
      'responses/session/scenario/original.mp3',
      'responses/session/scenario/converted.mp3',
      'responses/session/scenario/unused.mp3',
      'responses/session/scenario/unused.mp3',
    ], [{
      sourceAudioPath: 'responses/session/scenario/original.mp3',
      processedAudioPath: 'responses/session/scenario/converted.mp3',
    }]);
    expect(summary).toEqual({
      scannedMp3Objects: 3,
      referencedMp3Objects: 2,
      unreferencedMp3Candidates: 1,
    });
    expect(JSON.stringify(summary)).not.toContain('responses/session');
  });

  it('treats MP3 files referenced by conversion jobs as owned instead of orphan candidates', () => {
    const mp3 = 'responses/session-1/scenario-2/original.mp3';
    const summary = summarizeRoleplayMp3Inventory(
      [mp3, 'responses/session-1/scenario-2/unreferenced.mp3'],
      [],
      [{ sourceAudioPath: mp3 }],
    );
    expect(summary).toEqual({
      scannedMp3Objects: 2,
      referencedMp3Objects: 1,
      unreferencedMp3Candidates: 1,
    });
    expect(JSON.stringify(summary)).not.toContain(mp3);
  });

  it('preserves backwards-compatible MP3 summary calls with no job array', () => {
    expect(summarizeRoleplayMp3Inventory(['responses/orphan.mp3'], [])).toEqual({
      scannedMp3Objects: 1,
      referencedMp3Objects: 0,
      unreferencedMp3Candidates: 1,
    });
  });

  it('does not surface Storage error messages or private tokens when listing fails', async () => {
    const list = vi.fn().mockResolvedValue({
      data: null, error: { message: 'https://internal.invalid?token=PRIVATE_TOKEN' },
    });
    await expect(listRoleplayMp3Paths(readerWithList(list)))
      .rejects.toThrow('Roleplay audio inventory could not list Storage objects');
  });

  it('fails closed on thrown Storage exceptions and malformed responses', async () => {
    const throws = vi.fn().mockRejectedValue(new Error('secret storage credentials'));
    await expect(listRoleplayMp3Paths(readerWithList(throws)))
      .rejects.toThrow('Roleplay audio inventory could not list Storage objects');

    const malformed = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(listRoleplayMp3Paths(readerWithList(malformed)))
      .rejects.toThrow('Roleplay audio inventory could not list Storage objects');
  });

  it('returns zero candidates for an empty bucket without deleting anything', async () => {
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    expect(await listRoleplayMp3Paths(readerWithList(list))).toEqual([]);
    expect(summarizeRoleplayMp3Inventory([], [])).toEqual({
      scannedMp3Objects: 0,
      referencedMp3Objects: 0,
      unreferencedMp3Candidates: 0,
    });
  });
});


describe('read-only inventory for all Roleplay response audio formats', () => {
  it('visits nested folders and includes supported source formats with Storage timestamps', async () => {
    const list = vi.fn(async (prefix: string) => {
      if (prefix === 'responses') return {
        data: [{ name: 'session-1', id: null, metadata: null }], error: null,
      };
      if (prefix === 'responses/session-1') return {
        data: [
          { name: 'capture.webm', id: 'a', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
          { name: 'capture.MP4', id: 'b', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
          { name: 'capture.ogg', id: 'c', created_at: null, updated_at: null },
          { name: 'capture.mp3', id: 'd', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
          { name: 'metadata.json', id: 'e' },
        ], error: null,
      };
      throw new Error('Unexpected folder');
    });
    const items = await listRoleplayAudioObjects(readerWithList(list));
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.path)).toEqual([
      'responses/session-1/capture.webm',
      'responses/session-1/capture.MP4',
      'responses/session-1/capture.ogg',
      'responses/session-1/capture.mp3',
    ]);
    expect(items[0].createdAt).toBe('2026-10-01T00:00:00Z');
    expect(items[2].updatedAt).toBeNull();
  });

  it('protects confirmed sources, conversions and all queued or completed audio jobs', () => {
    const timestamp = '2026-10-01T00:00:00Z';
    const now = Date.parse('2026-11-15T00:00:00Z');
    const file = (path: string, createdAt: string | null = timestamp, updatedAt: string | null = timestamp) =>
      ({ path, createdAt, updatedAt });
    const objects = [
      file('responses/a/original.webm'),
      file('responses/a/conversion.mp3'),
      file('responses/b/pending.ogg'),
      file('responses/c/old-unreferenced.mp4'),
      file('responses/c/new-unreferenced.webm', '2026-11-14T00:00:00Z', '2026-11-14T00:00:00Z'),
      file('responses/c/missing-timestamp.mp3', null, null),
      file('responses/c/future.mp4', '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z'),
      file('responses/c/updated-recently.webm', timestamp, '2026-11-14T00:00:00Z'),
    ];
    const summary = summarizeRoleplayAudioInventory(
      objects,
      [{ sourceAudioPath: 'responses/a/original.webm', processedAudioPath: 'responses/a/conversion.mp3' }],
      [{ sourceAudioPath: 'responses/b/pending.ogg' }],
      now,
    );
    expect(summary).toEqual({
      scannedAudioObjects: 8,
      referencedAudioObjects: 3,
      unreferencedYoungerThan14Days: 2,
      unreferencedUnknownAge: 2,
      unreferencedOlderThan14Days: 1,
    });
    expect(JSON.stringify(summary)).not.toContain('responses/');
  });

  it('never treats inconsistent duplicate listings as reliable age evidence', () => {
    const file = (date: string) => ({
      path: 'responses/s/scenario/duplicate.webm',
      createdAt: date,
      updatedAt: date,
    });
    const now = Date.parse('2026-11-15T00:00:00Z');
    const summary = summarizeRoleplayAudioInventory([
      file('2026-10-01T00:00:00Z'),
      file('2026-11-14T00:00:00Z'),
    ], [], [], now);
    expect(summary.unreferencedOlderThan14Days).toBe(0);
    expect(summary.unreferencedUnknownAge).toBe(1);
    expect(summary.scannedAudioObjects).toBe(1);
  });

  it('does not classify invalid dates or missing timestamps as aged orphans', () => {
    const summary = summarizeRoleplayAudioInventory([
      { path: 'responses/a/x.webm', createdAt: 'invalid', updatedAt: 'invalid' },
      { path: 'responses/a/y.mp3', createdAt: null, updatedAt: '2026-01-01T00:00:00Z' },
    ], [], [], Date.parse('2026-11-15T00:00:00Z'));
    expect(summary.unreferencedOlderThan14Days).toBe(0);
    expect(summary.unreferencedUnknownAge).toBe(2);
  });

  it('rejects provider listing errors without reflecting a path or bearer token', async () => {
    const list = vi.fn().mockRejectedValue(new Error('https://secret.invalid/audio?token=SECRET'));
    await expect(listRoleplayAudioObjects(readerWithList(list)))
      .rejects.toThrow('Roleplay audio inventory could not list Storage objects');
  });
});
