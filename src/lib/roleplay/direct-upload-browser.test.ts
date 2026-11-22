// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { prepareRoleplayDirectUploadBatch } from '@/lib/roleplay/direct-upload-contract';
import {
  RoleplayBrowserUploadError,
  uploadRoleplayBatchSequentially,
  type RoleplayBrowserSignedUploadSlot,
} from './direct-upload-browser';

const batchId = '123e4567-e89b-42d3-a456-426614174000';

function fixture(count: number) {
  const files = Array.from({ length: count }, (_, index) =>
    new File(['ID3' + index], 'synthetic-' + index + '.mp3', { type: 'audio/mpeg' }));
  const prepared = prepareRoleplayDirectUploadBatch(batchId, files.map((file, order) => ({
    order, mime: file.type, sizeBytes: file.size, sha256: 'a'.repeat(64),
  })));
  const slots: RoleplayBrowserSignedUploadSlot[] = prepared.items.map(item => ({
    ...item, token: 'SYNTHETIC_PRIVATE_UPLOAD_TOKEN_' + item.order,
  }));
  return { files, slots };
}

describe('future browser-to-Storage Roleplay uploader (not wired to production)', () => {
  it('uploads 25 files strictly sequentially, never buffering them together', async () => {
    const { files, slots } = fixture(25);
    let active = 0;
    let peak = 0;
    const events: string[] = [];
    const upload = vi.fn(async (slot: Pick<RoleplayBrowserSignedUploadSlot, 'path' | 'mime' | 'token'>, file: File) => {
      active++;
      peak = Math.max(peak, active);
      events.push('start:' + slot.path);
      expect(file.type).toBe('audio/mpeg');
      await Promise.resolve();
      active--;
      events.push('end:' + slot.path);
      return { error: null };
    });
    const onUploaded = vi.fn();
    const result = await uploadRoleplayBatchSequentially(batchId, files, slots, upload, { onUploaded });
    expect(result).toEqual({ uploadedCount: 25 });
    expect(upload).toHaveBeenCalledTimes(25);
    expect(peak).toBe(1);
    expect(events[0]).toBe('start:' + slots[0].path);
    expect(events[1]).toBe('end:' + slots[0].path);
    expect(events[48]).toBe('start:' + slots[24].path);
    expect(onUploaded).toHaveBeenLastCalledWith(25, 25);
  });

  it('fails closed before any upload for reordered paths, types, sizes or missing tokens', async () => {
    const { files, slots } = fixture(2);
    const send = vi.fn().mockResolvedValue({ error: null });
    const cases = [
      { files, slots: [{ ...slots[0], path: '../../cross-tenant.mp3' }, slots[1]] },
      { files, slots: [{ ...slots[0], order: 1 }, slots[1]] },
      { files, slots: [{ ...slots[0], token: '' }, slots[1]] },
      { files: [new File(['changed'], 'private.mp3', { type: 'audio/mpeg' }), files[1]], slots },
      { files: [new File(['ID3' + 0], 'private.wav', { type: 'audio/wav' }), files[1]], slots },
      { files: [...files, files[0]], slots },
    ];
    for (const candidate of cases) {
      await expect(uploadRoleplayBatchSequentially(batchId, candidate.files, candidate.slots, send))
        .rejects.toMatchObject({ code: 'INVALID_PLAN', uploadedCount: 0 });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('stops on cancellation during the first transfer without uploading the next file', async () => {
    const { files, slots } = fixture(3);
    const controller = new AbortController();
    const upload = vi.fn(async () => {
      controller.abort();
      return { error: null };
    });
    await expect(uploadRoleplayBatchSequentially(batchId, files, slots, upload, {
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'CANCELLED', uploadedCount: 0 });
    expect(upload).toHaveBeenCalledOnce();
  });

  it('never starts another transfer after a completed upload is cancelled', async () => {
    const { files, slots } = fixture(3);
    const controller = new AbortController();
    const upload = vi.fn().mockResolvedValue({ error: null });
    await expect(uploadRoleplayBatchSequentially(batchId, files, slots, upload, {
      signal: controller.signal,
      onUploaded: () => controller.abort(),
    })).rejects.toMatchObject({ code: 'CANCELLED', uploadedCount: 1 });
    expect(upload).toHaveBeenCalledOnce();
  });

  it('sanitizes rejected provider errors and never retries a partially uploaded batch', async () => {
    const { files, slots } = fixture(3);
    const upload = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockRejectedValueOnce(new Error('SIGNED_TOKEN_PRIVATE_OR_PATIENT_NAME'))
      .mockResolvedValue({ error: null });
    let error: unknown;
    try {
      await uploadRoleplayBatchSequentially(batchId, files, slots, upload);
    } catch (cause) { error = cause; }
    expect(error).toBeInstanceOf(RoleplayBrowserUploadError);
    expect(error).toMatchObject({ code: 'UPLOAD_FAILED', uploadedCount: 1 });
    expect(String(error)).not.toContain('SIGNED_TOKEN_PRIVATE_OR_PATIENT_NAME');
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('treats a failed Storage response as an upload error without leaking its payload', async () => {
    const { files, slots } = fixture(1);
    const upload = vi.fn().mockResolvedValue({
      error: { message: 'PRIVATE_STORAGE_URL_WITH_TOKEN' },
    });
    await expect(uploadRoleplayBatchSequentially(batchId, files, slots, upload))
      .rejects.toMatchObject({ code: 'UPLOAD_FAILED', uploadedCount: 0 });
    expect(upload).toHaveBeenCalledOnce();
  });

  it('does not continue if the progress listener fails after a successful upload', async () => {
    const { files, slots } = fixture(2);
    const upload = vi.fn().mockResolvedValue({ error: null });
    await expect(uploadRoleplayBatchSequentially(batchId, files, slots, upload, {
      onUploaded: () => { throw new Error('PRIVATE_CALLBACK_ERROR'); },
    })).rejects.toMatchObject({ code: 'PROGRESS_FAILED', uploadedCount: 1 });
    expect(upload).toHaveBeenCalledOnce();
  });
});
