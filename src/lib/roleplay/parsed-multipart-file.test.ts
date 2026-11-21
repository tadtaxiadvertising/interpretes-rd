// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { isParsedMultipartFile } from './parsed-multipart-file';

describe('Roleplay FormData native file detection', () => {
  it('accepts a parsed file even when the ambient File constructor differs', () => {
    const parsed = new File(['ID3'], 'segment.mp3', { type: 'audio/mpeg' });
    vi.stubGlobal('File', class DifferentRealmFile {});
    try {
      expect(parsed instanceof File).toBe(false);
      expect(isParsedMultipartFile(parsed)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('accepts the file returned by a bounded native multipart parser', async () => {
    const form = new FormData();
    form.append('scenarioAudios', new File(['ID3'], 'segment.mp3', { type: 'audio/mpeg' }));
    const request = new Request('http://localhost/upload', { method: 'POST', body: form });
    const { readBoundedMultipartFormData } = await import('@/lib/roleplay-studio/bounded-multipart');
    const parsed = await readBoundedMultipartFormData(request, 1024);
    expect(isParsedMultipartFile(parsed.get('scenarioAudios'))).toBe(true);
  });

  it('rejects text, Blob without filename and incomplete impostors', () => {
    expect(isParsedMultipartFile('segment.mp3')).toBe(false);
    expect(isParsedMultipartFile(new Blob(['ID3'], { type: 'audio/mpeg' }))).toBe(false);
    expect(isParsedMultipartFile(null)).toBe(false);
    expect(isParsedMultipartFile({ name: 'segment.mp3', type: 'audio/mpeg', size: 3 })).toBe(false);
    expect(isParsedMultipartFile({ [Symbol.toStringTag]: 'File', name: 'segment.mp3', type: 'audio/mpeg', size: 3 })).toBe(false);
  });
});
