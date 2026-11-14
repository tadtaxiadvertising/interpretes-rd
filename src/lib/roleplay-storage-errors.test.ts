import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  info: vi.fn(),
  remove: vi.fn(),
  signed: vi.fn(),
  signedUpload: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        info: storage.info,
        remove: storage.remove,
        createSignedUrl: storage.signed,
        createSignedUploadUrl: storage.signedUpload,
      }),
    },
  }),
}));

import {
  confirmUpload,
  createSignedUploadUrl,
  getAdminReviewUrl,
  getPlaybackUrl,
  getSignedAudioUrl,
  getValidationUrl,
} from './roleplay';

const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-for-isolated-tests';

afterAll(() => {
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

describe('Roleplay Storage errors never expose provider error messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.info.mockResolvedValue({ data: { metadata: { size: 5 } }, error: null });
    storage.remove.mockResolvedValue({ error: null });
  });

  it('redacts provider tokens when issuing a signed upload URL', async () => {
    storage.signedUpload.mockResolvedValue({
      data: null,
      error: { message: 'PRIVATE_UPLOAD_TOKEN https://storage.internal.invalid' },
    });
    await expect(createSignedUploadUrl('session-1', 'audio/webm', true))
      .rejects.toThrow('Failed to create signed upload URL');
    await expect(createSignedUploadUrl('session-1', 'audio/webm', true))
      .rejects.not.toThrow(/PRIVATE_UPLOAD_TOKEN|storage.internal.invalid/);
  });

  it.each([
    ['candidate playback', () => getPlaybackUrl('base/a.webm')],
    ['invite validation', () => getValidationUrl('base/a.webm')],
    ['admin review', () => getAdminReviewUrl('base/a.webm')],
    ['short-lived refresh', () => getSignedAudioUrl('base/a.webm')],
    ['confirmed base audio', () => confirmUpload('base/a.webm', 15 * 1024 * 1024)],
  ] as const)('redacts provider tokens when signing %s', async (_name, getUrl) => {
    storage.signed.mockResolvedValue({
      data: null,
      error: { message: 'PRIVATE_STORAGE_TOKEN connection-string=db.internal.invalid' },
    });
    let captured: unknown;
    try {
      await getUrl();
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('Failed to create signed URL');
    expect(JSON.stringify(captured)).not.toContain('PRIVATE_STORAGE_TOKEN');
    expect((captured as Error).message).not.toContain('db.internal.invalid');
  });

  it('does not log tokens if cleanup of an oversized recording also fails', async () => {
    storage.info.mockResolvedValue({
      data: { metadata: { size: 16 * 1024 * 1024 } },
      error: null,
    });
    storage.remove.mockResolvedValue({
      error: { message: 'PRIVATE_CLEANUP_TOKEN https://storage.internal.invalid' },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(confirmUpload('responses/session/scenario/recording.webm', 15 * 1024 * 1024))
        .rejects.toThrow('Uploaded audio size is invalid or exceeds the allowed limit');
      expect(storage.remove).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith('Failed to remove rejected Roleplay audio object:', 'StorageError');
      expect(JSON.stringify(spy.mock.calls)).not.toContain('PRIVATE_CLEANUP_TOKEN');
      expect(JSON.stringify(spy.mock.calls)).not.toContain('storage.internal.invalid');
    } finally {
      spy.mockRestore();
    }
  });
});
