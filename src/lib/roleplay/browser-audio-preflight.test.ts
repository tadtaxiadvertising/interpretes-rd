import { describe, expect, it } from 'vitest';
import { inspectRoleplayAdminAudioDraft } from './browser-audio-preflight';

const max = 15 * 1024 * 1024;
const clip = (size = 3, type = 'audio/mpeg', sha256?: string) =>
  ({ baseAudioFile: { size, type }, ...(sha256 ? { sha256 } : {}) });

describe('Roleplay admin: browser multipart preflight (no file reads)', () => {
  it('accepts all 25 clips at 15 MiB and computes their total without reading bytes', () => {
    const batch = Array.from({ length: 25 }, () => clip(max));
    expect(inspectRoleplayAdminAudioDraft(batch)).toEqual({ totalBytes: 25 * max });
  });

  it('accepts the four exact MIME types supported by the server', () => {
    const batch = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4']
      .map(mime => clip(10, mime, 'a'.repeat(64)));
    expect(inspectRoleplayAdminAudioDraft(batch)).toEqual({ totalBytes: 40 });
  });

  it('rejects a missing clip and batch lengths outside 1–25', () => {
    expect(inspectRoleplayAdminAudioDraft([]).invalid?.message).toContain('Cantidad');
    expect(inspectRoleplayAdminAudioDraft(Array.from({ length: 26 }, () => clip())).invalid?.message)
      .toContain('Cantidad');
    expect(inspectRoleplayAdminAudioDraft([clip(), { baseAudioFile: null }]).invalid)
      .toMatchObject({ index: 1, message: 'El escenario 2 necesita un audio válido.' });
  });

  it('rejects oversized and empty files before a fetch', () => {
    for (const size of [0, -1, 1.5, Number.POSITIVE_INFINITY, max + 1]) {
      expect(inspectRoleplayAdminAudioDraft([clip(10), clip(size)]).invalid)
        .toMatchObject({ index: 1, message: expect.stringContaining('15 MiB') });
    }
  });

  it('rejects unsupported or parameterized MIME and invalid checksums', () => {
    expect(inspectRoleplayAdminAudioDraft([clip(3, 'audio/mpeg; filename=token')]).invalid?.message)
      .toContain('MP3, WAV, WebM o MP4');
    expect(inspectRoleplayAdminAudioDraft([clip(3, 'application/octet-stream')]).invalid?.message)
      .toContain('MP3, WAV, WebM o MP4');
    expect(inspectRoleplayAdminAudioDraft([clip(3, 'audio/mpeg', 'NOT_VALID')]).invalid?.message)
      .toContain('SHA-256');
    expect(inspectRoleplayAdminAudioDraft([clip(3, 'audio/mpeg', 'A'.repeat(64))]).invalid?.message)
      .toContain('SHA-256');
  });

  it('never reflects an upload filename or client metadata into an error', () => {
    const malicious = { baseAudioFile: { size: max + 1, type: 'audio/mpeg', name: 'PRIVATE_PATIENT_NAME.mp3' } };
    const result = inspectRoleplayAdminAudioDraft([malicious]);
    expect(result.invalid?.message).not.toContain('PRIVATE_PATIENT_NAME');
  });
});
