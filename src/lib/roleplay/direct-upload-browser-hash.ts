import { inspectRoleplayAdminAudioDraft } from '@/lib/roleplay/browser-audio-preflight';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import type { RoleplayDirectUploadDeclaration } from '@/lib/roleplay/direct-upload-contract';

type HashFailureCode =
  'INVALID_FILES' | 'CRYPTO_UNAVAILABLE' | 'HASH_FAILED' | 'CANCELLED' | 'PROGRESS_FAILED';

export class RoleplayBrowserHashError extends Error {
  constructor(readonly code: HashFailureCode, readonly hashedCount: number) {
    // Never reflect private filenames, audio content, or browser/provider errors.
    super(code);
    this.name = 'RoleplayBrowserHashError';
  }
}

export interface RoleplayBrowserHashOptions {
  signal?: AbortSignal;
  onHashed?: (completed: number, total: number) => void;
}

/**
 * Prepare declarations for a FUTURE authenticated server-side reservation.
 *
 * Nothing is uploaded or persisted. Validate the whole batch before reading
 * any bytes, then hash exactly one File at a time with native Web Crypto.
 * SubtleCrypto.digest is not streaming: a single audio file (max 15 MiB) is
 * materialized at a time, never the full 25-file batch.
 *
 * Cancellation cannot interrupt an in-flight native digest, but it stops the
 * next file and prevents cancelled batches from reporting success. These
 * declarations are NOT authorization or proof of Storage integrity: the server
 * must bind them to the authenticated admin and independently verify bytes.
 */
export async function hashRoleplayFilesSequentially(
  files: readonly File[],
  options: RoleplayBrowserHashOptions = {},
): Promise<RoleplayDirectUploadDeclaration[]> {
  if (!Array.isArray(files) || files.length < 1 ||
      files.length > ROLEPLAY_MAX_SCENARIOS || typeof File === 'undefined') {
    throw new RoleplayBrowserHashError('INVALID_FILES', 0);
  }
  // The form may replace or append files during an asynchronous hash. Snapshot
  // identities and order once, before preflight or any callbacks.
  const batch = files.slice();
  if (batch.some(file => !(file instanceof File)) ||
      inspectRoleplayAdminAudioDraft(batch.map(file => ({ baseAudioFile: file }))).invalid) {
    throw new RoleplayBrowserHashError('INVALID_FILES', 0);
  }
  if (options.signal?.aborted) throw new RoleplayBrowserHashError('CANCELLED', 0);
  if (typeof crypto === 'undefined' || !crypto.subtle ||
      typeof crypto.subtle.digest !== 'function') {
    throw new RoleplayBrowserHashError('CRYPTO_UNAVAILABLE', 0);
  }

  const declarations: RoleplayDirectUploadDeclaration[] = [];
  for (const [order, file] of batch.entries()) {
    if (options.signal?.aborted) {
      throw new RoleplayBrowserHashError('CANCELLED', declarations.length);
    }
    let sha256: string;
    try {
      // ArrayBuffer is scoped to this iteration; do not gather buffers for
      // all files or send them through Next.js.
      const bytes = await file.arrayBuffer();
      if (options.signal?.aborted) {
        throw new RoleplayBrowserHashError('CANCELLED', declarations.length);
      }
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      sha256 = Array.from(new Uint8Array(digest), byte =>
        byte.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      if (error instanceof RoleplayBrowserHashError) throw error;
      throw new RoleplayBrowserHashError('HASH_FAILED', declarations.length);
    }
    if (options.signal?.aborted) {
      throw new RoleplayBrowserHashError('CANCELLED', declarations.length);
    }

    declarations.push({ order, mime: file.type, sizeBytes: file.size, sha256 });
    try {
      options.onHashed?.(declarations.length, batch.length);
    } catch {
      throw new RoleplayBrowserHashError('PROGRESS_FAILED', declarations.length);
    }
    if (options.signal?.aborted) {
      throw new RoleplayBrowserHashError('CANCELLED', declarations.length);
    }
  }

  return declarations;
}
