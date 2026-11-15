import { describe, expect, it, vi } from 'vitest';
import {
  listRoleplayMp3Paths,
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
