// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  verifyRoleplayUploadByteStream, RoleplayUploadVerificationError,
} from './direct-upload-stream-verifier';
import { ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES } from './direct-upload-contract';

const bytes = new TextEncoder().encode('synthetic-roleplay-audio');
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function chunks(data: Uint8Array, split = 5): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < data.byteLength; i += split) {
        controller.enqueue(data.subarray(i, i + split));
      }
      controller.close();
    },
  });
}

describe('future Roleplay direct-upload streaming object verification', () => {
  it('verifies exact bytes and SHA-256 without collecting the whole object', async () => {
    const result = await verifyRoleplayUploadByteStream(chunks(bytes), {
      sizeBytes: bytes.byteLength,
      sha256: digest(bytes),
    });
    expect(result).toEqual({ sizeBytes: bytes.byteLength, sha256: digest(bytes) });
  });

  it('rejects altered content with an unchanged declared size', async () => {
    const changed = Uint8Array.from(bytes);
    changed[0] ^= 0xff;
    await expect(verifyRoleplayUploadByteStream(chunks(changed), {
      sizeBytes: changed.byteLength,
      sha256: digest(bytes),
    })).rejects.toMatchObject({ code: 'DIGEST_MISMATCH' });
  });

  it('rejects truncated content at EOF', async () => {
    await expect(verifyRoleplayUploadByteStream(chunks(bytes.subarray(0, bytes.length - 1)), {
      sizeBytes: bytes.byteLength,
      sha256: digest(bytes),
    })).rejects.toMatchObject({ code: 'SIZE_MISMATCH' });
  });

  it('cancels the upstream stream immediately when bytes exceed the reservation', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(20)); },
      cancel,
    });
    await expect(verifyRoleplayUploadByteStream(stream, {
      sizeBytes: 5,
      sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'SIZE_MISMATCH' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('fails closed on invalid reservations before reading any bytes', async () => {
    for (const invalid of [
      { sizeBytes: 0, sha256: 'a'.repeat(64) },
      { sizeBytes: -1, sha256: 'a'.repeat(64) },
      { sizeBytes: 1.25, sha256: 'a'.repeat(64) },
      { sizeBytes: Number.POSITIVE_INFINITY, sha256: 'a'.repeat(64) },
      { sizeBytes: ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES + 1, sha256: 'a'.repeat(64) },
      { sizeBytes: 3, sha256: 'A'.repeat(64) },
      { sizeBytes: 3, sha256: 'not-a-sha' },
    ]) {
      const stream = chunks(bytes);
      await expect(verifyRoleplayUploadByteStream(stream, invalid))
        .rejects.toMatchObject({ code: 'INVALID_EXPECTATION' });
      expect(stream.locked).toBe(false);
    }
  });

  it('does not emit private provider errors in the verification result', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('FAKE_SIGNED_TOKEN_PRIVATE')); },
    });
    try {
      await verifyRoleplayUploadByteStream(stream, {
        sizeBytes: bytes.byteLength, sha256: digest(bytes),
      });
      throw new Error('Verification should reject an inaccessible source');
    } catch (error) {
      expect(error).toBeInstanceOf(RoleplayUploadVerificationError);
      expect((error as RoleplayUploadVerificationError).code).toBe('STREAM_UNAVAILABLE');
      expect(String(error)).not.toContain('FAKE_SIGNED_TOKEN_PRIVATE');
    }
  });

  it('rejects non-byte stream chunks and cancels the source', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new DataView(new ArrayBuffer(4)) as unknown as Uint8Array); },
      cancel,
    });
    await expect(verifyRoleplayUploadByteStream(stream, {
      sizeBytes: 4, sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'INVALID_STREAM' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects aborts without touching an already-aborted stream', async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = chunks(bytes);
    await expect(verifyRoleplayUploadByteStream(stream, {
      sizeBytes: bytes.byteLength, sha256: digest(bytes),
    }, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(stream.locked).toBe(false);
  });

  it('can verify a full-size 15 MiB audio using only 64 KiB chunks', async () => {
    const chunk = new Uint8Array(64 * 1024);
    const count = ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES / chunk.byteLength;
    const hash = createHash('sha256');
    for (let i = 0; i < count; i++) hash.update(chunk);
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced === count) { controller.close(); return; }
        controller.enqueue(chunk);
        produced++;
      },
    });
    const result = await verifyRoleplayUploadByteStream(stream, {
      sizeBytes: ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES,
      sha256: hash.digest('hex'),
    });
    expect(result.sizeBytes).toBe(ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES);
    expect(produced).toBe(count);
  });
});
