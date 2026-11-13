import { describe, expect, it } from 'vitest';
import { createStudioDraft, openStudioDraft, MAX_STUDIO_DRAFT_CHARS } from './draft';

const hash = 'ab'.repeat(32);
const sourceSize = 1500;
const length = 90;
const segment = {
  title: 'Doctor · 1 (EN)',
  start: 0,
  end: 5.3,
  scriptPrompt: 'Interpret this segment carefully.',
  responseLimit: 120,
  speakerRole: 'doctor' as const,
  language: 'en' as const,
};

describe('Roleplay Studio resumable, SHA-256-bound project drafts', () => {
  it('roundtrips all editable metadata without copying private transcript or audio URLs', () => {
    const data = createStudioDraft(sourceSize, hash, [{
      ...segment,
      id: 'private-id',
      captionText: 'Private patient diagnosis.',
      baseAudioUrl: 'https://private-storage.example/secret',
    }] as never, length);
    expect(JSON.stringify(data)).not.toContain('private-id');
    expect(JSON.stringify(data)).not.toContain('Private patient diagnosis');
    expect(JSON.stringify(data)).not.toContain('private-storage');
    expect(data).not.toHaveProperty('sourceFileName');
    expect(data.sourceSha256).toBe(hash);
    expect(openStudioDraft(JSON.stringify(data), sourceSize, hash.toUpperCase(), length))
      .toEqual([segment]);
  });

  it('preserves an empty editing project so an admin can return later', () => {
    const saved = createStudioDraft(sourceSize, hash, [], length);
    expect(openStudioDraft(JSON.stringify(saved), sourceSize, hash, length)).toEqual([]);
  });

  it('rejects a different MP3 even if its byte count matches', () => {
    const saved = createStudioDraft(sourceSize, hash, [segment], length);
    expect(() => openStudioDraft(JSON.stringify(saved), sourceSize, 'cd'.repeat(32), length))
      .toThrow(/otro MP3/);
    expect(() => openStudioDraft(JSON.stringify(saved), sourceSize + 1, hash, length))
      .toThrow(/otro MP3/);
  });

  it('rejects malformed, oversized, unsupported, and dangerous project JSON', () => {
    const original = createStudioDraft(sourceSize, hash, [segment], length);
    const cases: unknown[] = [
      { ...original, version: 2 },
      { ...original, format: 'untrusted-format' },
      { ...original, sourceSha256: '__proto__' },
      { ...original, sourceSizeBytes: 0 },
      { ...original, segments: [{ ...segment, start: -1 }] },
      { ...original, segments: [{ ...segment, end: 100 }] },
      { ...original, segments: [{ ...segment, scriptPrompt: 'x'.repeat(5001) }] },
      { ...original, segments: [{ ...segment, language: 'de' }] },
      { ...original, segments: [{ ...segment, speakerRole: 'Patient John Doe' }] },
      { ...original, segments: Array.from({ length: 26 }, () => segment) },
    ];
    for (const input of cases) {
      expect(() => openStudioDraft(JSON.stringify(input), sourceSize, hash, length)).toThrow();
    }
    expect(() => openStudioDraft('{', sourceSize, hash, length)).toThrow();
    expect(() => openStudioDraft('x'.repeat(MAX_STUDIO_DRAFT_CHARS + 1), sourceSize, hash, length)).toThrow();
  });

  it('refuses to save incomplete numerical boundaries and unsafe metadata', () => {
    expect(() => createStudioDraft(sourceSize, hash, [{ ...segment, start: NaN }], length)).toThrow();
    expect(() => createStudioDraft(sourceSize, hash, [{ ...segment, end: 400 }], length)).toThrow();
    expect(() => createStudioDraft(sourceSize, hash, [{ ...segment, responseLimit: 600 }], length)).toThrow();
    expect(() => createStudioDraft(sourceSize, 'not-a-hash', [segment], length)).toThrow();
  });
});
