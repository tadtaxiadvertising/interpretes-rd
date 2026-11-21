import { createHash, timingSafeEqual } from 'node:crypto';
import { ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES } from '@/lib/roleplay/direct-upload-contract';
import type { PreparedRoleplayUpload } from '@/lib/roleplay/direct-upload-contract';

type VerificationFailure = 'INVALID_EXPECTATION' | 'INVALID_STREAM' |
  'SIZE_MISMATCH' | 'DIGEST_MISMATCH' | 'CANCELLED' | 'STREAM_UNAVAILABLE';

export class RoleplayUploadVerificationError extends Error {
  constructor(readonly code: VerificationFailure) {
    // Never include paths, object data, signatures or provider exceptions.
    super(code);
    this.name = 'RoleplayUploadVerificationError';
  }
}

/**
 * Verify ONE previously reserved Storage object from a trusted byte stream.
 *
 * This helper performs NO Storage reads on its own, grants NO capabilities
 * and does not make a client-provided path authoritative. Callers must
 * authenticate the reservation owner and verify the object key separately.
 * Verification requires exact length AND digest: Storage info() alone cannot
 * prove the uploaded content matches the client-declared SHA-256.
 *
 * Memory remains O(largest stream chunk), not O(file size). A future worker
 * can invoke this sequentially for each reserved upload without materializing
 * a complete MP3 in the Next.js process.
 */
export async function verifyRoleplayUploadByteStream(
  stream: ReadableStream<Uint8Array>,
  expected: Pick<PreparedRoleplayUpload, 'sizeBytes' | 'sha256'>,
  signal?: AbortSignal,
): Promise<{ sizeBytes: number; sha256: string }> {
  if (!expected || !Number.isSafeInteger(expected.sizeBytes) ||
      expected.sizeBytes < 1 || expected.sizeBytes > ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES ||
      typeof expected.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
    throw new RoleplayUploadVerificationError('INVALID_EXPECTATION');
  }
  if (!stream || typeof stream.getReader !== 'function') {
    throw new RoleplayUploadVerificationError('INVALID_STREAM');
  }
  if (signal?.aborted) {
    throw new RoleplayUploadVerificationError('CANCELLED');
  }

  const reader = stream.getReader();
  const abortReader = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abortReader, { once: true });

  let finished = false;
  let sizeBytes = 0;
  const hash = createHash('sha256');

  try {
    while (true) {
      if (signal?.aborted) throw new RoleplayUploadVerificationError('CANCELLED');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new RoleplayUploadVerificationError('CANCELLED');
      if (done) break;
      // ArrayBuffer.isView accepts native typed arrays from other JS realms.
      if (!ArrayBuffer.isView(value) ||
          Object.prototype.toString.call(value) !== '[object Uint8Array]') {
        throw new RoleplayUploadVerificationError('INVALID_STREAM');
      }
      if (value.byteLength > expected.sizeBytes - sizeBytes) {
        throw new RoleplayUploadVerificationError('SIZE_MISMATCH');
      }
      sizeBytes += value.byteLength;
      hash.update(value);
    }

    if (sizeBytes !== expected.sizeBytes) {
      throw new RoleplayUploadVerificationError('SIZE_MISMATCH');
    }
    const digest = hash.digest();
    const wanted = Buffer.from(expected.sha256, 'hex');
    if (!timingSafeEqual(digest, wanted)) {
      throw new RoleplayUploadVerificationError('DIGEST_MISMATCH');
    }
    finished = true;
    return { sizeBytes, sha256: digest.toString('hex') };
  } catch (error) {
    if (error instanceof RoleplayUploadVerificationError) throw error;
    throw new RoleplayUploadVerificationError('STREAM_UNAVAILABLE');
  } finally {
    signal?.removeEventListener('abort', abortReader);
    if (!finished) {
      try { await reader.cancel(); } catch { /* Always preserve the original rejection. */ }
    }
    reader.releaseLock();
  }
}
