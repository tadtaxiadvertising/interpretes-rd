// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  createLongMediaDraft, fingerprintLocalMedia, mediaKind, openLongMediaDraft,
  usesLocalLongMode, validateLocalMedia,
} from './long-media';

const hash = 'ab'.repeat(32);
const source = new File(['ID3'], 'medical.mp4', { type: 'video/mp4' });
const segments = [{
  title: 'Médico · 1', start: 14400, end: 14430, scriptPrompt: 'Interpretar con fidelidad',
  responseLimit: 120, speakerRole: 'doctor' as const, language: 'es' as const,
}];

describe('local-only long media projects', () => {
  it('keeps videos and large MP3s away from the legacy full-upload export path', () => {
    expect(mediaKind(source)).toBe('video');
    expect(usesLocalLongMode(source, 120)).toBe(true);
    expect(usesLocalLongMode(new File(['x'], 'a.mp3'), 43200)).toBe(true);
    expect(usesLocalLongMode(new File(['x'], 'a.mp3'), 90)).toBe(false);
    expect(() => validateLocalMedia(new File(['x'], 'a.exe'))).toThrow(/Formato no admitido/);
    const oversized = new File(['x'], 'huge.mp4');
    Object.defineProperty(oversized, 'size', { value: 8 * 1024 ** 3 + 1 });
    expect(() => validateLocalMedia(oversized)).toThrow(/8 GiB/);
  });

  it('persists only reviewed metadata and ties it to the sampled source fingerprint', () => {
    const draft = createLongMediaDraft(222, hash, segments, 21600);
    const json = JSON.stringify(draft);
    expect(json).not.toContain('medical.mp4');
    expect(json).not.toContain('Patient: private transcription');
    expect(openLongMediaDraft(json, 222, hash, 21600)).toEqual(segments);
    expect(() => openLongMediaDraft(json, 223, hash, 21600)).toThrow(/otra grabación/);
    expect(() => openLongMediaDraft(json, 222, 'cd'.repeat(32), 21600)).toThrow(/otra grabación/);
    expect(() => createLongMediaDraft(222, hash,
      [{ ...segments[0], end: 44000 }], 43200)).toThrow(/límites/);
  });

  it('persists v2 disjoint cuts and fails closed on forged ranges', () => {
    const compound = { ...segments[0], start: 14000, end: 14450,
      ranges: [{ start: 14000, end: 14010 }, { start: 14400, end: 14450 }] };
    const project = createLongMediaDraft(222, hash, [compound], 21600);
    expect(project.version).toBe(2);
    expect(openLongMediaDraft(JSON.stringify(project), 222, hash, 21600)).toEqual([compound]);
    expect(() => openLongMediaDraft(
      JSON.stringify({ ...project, version: 1 }), 222, hash, 21600)).toThrow();
    expect(() => createLongMediaDraft(222, hash,
      [{ ...compound, ranges: [{ start: 14000, end: 14010 }, { start: 14009, end: 14450 }] }],
      21600)).toThrow(/límites/);
  });

  it('fingerprints only bounded slices and never calls file.arrayBuffer on the whole source', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const file = new File([new Uint8Array(512 * 1024)], 'long.webm');
    const wholeRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('unexpected full read'));
    const digest = await fingerprintLocalMedia(file);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(wholeRead).not.toHaveBeenCalled();
    expect(await fingerprintLocalMedia(file)).toBe(digest);
    wholeRead.mockRestore();
    vi.unstubAllGlobals();
  });
});
