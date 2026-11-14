import { describe, expect, it } from 'vitest';
import { safeRoleplayAudioJobError } from './roleplay-audio-worker-errors';

describe('Roleplay audio worker error redaction', () => {
  it.each([
    new Error('postgresql://private:PRIVATE_DB_PASSWORD@db.internal.invalid'),
    new Error('Unexpected token PRIVATE_STORAGE_TOKEN'),
    new Error('FFmpeg exited with code 1: /tmp/private-recording.webm Invalid data found while processing input'),
    new Error('Failed to download source audio: PRIVATE_DOWNLOAD_TOKEN'),
    new Error('Failed to upload MP3: PRIVATE_UPLOAD_TOKEN'),
    new Error('FFmpeg process error: PRIVATE_EXECUTION_PATH'),
    new Error('Recording is 200 seconds long; the maximum is 120 seconds PRIVATE_TOKEN'),
    { message: 'PRIVATE_EXTERNAL_ERROR' },
    null,
  ])('never copies untrusted diagnostics verbatim into job history or response records', (error) => {
    const value = safeRoleplayAudioJobError(error);
    expect(value.length).toBeGreaterThan(0);
    expect(value.length).toBeLessThan(500);
    expect(value).not.toMatch(/PRIVATE_|db\.internal\.invalid|\/tmp\/|postgresql:\/\//);
  });

  it('keeps safe, actionable categories for known processing errors', () => {
    expect(safeRoleplayAudioJobError(
      new Error('Source audio is empty or exceeds the 15 MB processing limit'),
    )).toBe('Source audio is empty or exceeds the 15 MB processing limit');
    expect(safeRoleplayAudioJobError(
      new Error('Failed to download source audio: PRIVATE_CONNECTION'),
    )).toBe('Failed to download source audio');
    expect(safeRoleplayAudioJobError(
      new Error('FFmpeg exited with code 1: /tmp/private.webm'),
    )).toBe('FFmpeg conversion failed');
    expect(safeRoleplayAudioJobError(
      new Error('Recording is 202 seconds long; the maximum is 180 seconds'),
    )).toBe('Recording exceeds duration limit (202s / 180s)');
    expect(safeRoleplayAudioJobError(new Error('Unknown Prisma failure')))
      .toBe('Roleplay audio processing failed');
  });

  it('does not trust an Error.name that contains an attacker-controlled token', () => {
    const error = new Error('Database unavailable');
    error.name = 'Bearer PRIVATE_SERVICE_ROLE_KEY';
    expect(safeRoleplayAudioJobError(error)).toBe('Roleplay audio processing failed');
  });
});
