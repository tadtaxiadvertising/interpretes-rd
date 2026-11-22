import {
  prepareRoleplayDirectUploadBatch,
  type PreparedRoleplayUpload,
} from '@/lib/roleplay/direct-upload-contract';

/**
 * A future authenticated server reservation supplies exactly one signed
 * Storage token for each canonical slot. Tokens grant temporary upload access
 * and must never be logged, stored in drafts, or returned by this helper.
 */
export interface RoleplayBrowserSignedUploadSlot extends PreparedRoleplayUpload {
  token: string;
}

export type RoleplaySignedUploadTransfer = (
  slot: Pick<RoleplayBrowserSignedUploadSlot, 'path' | 'mime' | 'token'>,
  file: File,
  signal?: AbortSignal,
) => Promise<{ error: unknown | null }>;

type UploadFailureCode = 'INVALID_PLAN' | 'CANCELLED' | 'UPLOAD_FAILED' | 'PROGRESS_FAILED';

export class RoleplayBrowserUploadError extends Error {
  constructor(readonly code: UploadFailureCode, readonly uploadedCount: number) {
    // Deliberately exclude file names, signed tokens, object paths and errors
    // from browser Storage SDKs.
    super(code);
    this.name = 'RoleplayBrowserUploadError';
  }
}

export interface RoleplayBrowserUploadOptions {
  signal?: AbortSignal;
  onUploaded?: (completed: number, total: number) => void;
}

/**
 * Sequential browser-side transfers. This is an UNWIRED transport helper:
 * no signing endpoint, Storage client, DB reservation, or UI feature flag is
 * implemented here. Only a server-owned reservation may supply the slots.
 *
 * Validates the full plan before the first byte is sent. Exactly one signed
 * upload may be in flight, even for a 25-file batch. No automatic retries or
 * cleanup: those require server-side reservation reconciliation to avoid
 * deleting a file which a successful transaction might already reference.
 *
 * The caller's Storage adapter must honor the AbortSignal if supported.
 * Regardless, an aborted batch never initiates the next upload and never
 * treats an eventually completed transfer as authorization to publish.
 * The server must independently verify every stored object's bytes + SHA.
 */
export async function uploadRoleplayBatchSequentially(
  batchId: string,
  files: readonly File[],
  slots: readonly RoleplayBrowserSignedUploadSlot[],
  transfer: RoleplaySignedUploadTransfer,
  options: RoleplayBrowserUploadOptions = {},
): Promise<{ uploadedCount: number }> {
  let canonical: ReturnType<typeof prepareRoleplayDirectUploadBatch>;
  try {
    if (!Array.isArray(files) || !Array.isArray(slots) ||
        files.length !== slots.length || typeof transfer !== 'function') {
      throw new Error('invalid input');
    }
    canonical = prepareRoleplayDirectUploadBatch(batchId, slots.map(slot => ({
      order: slot.order, mime: slot.mime, sizeBytes: slot.sizeBytes, sha256: slot.sha256,
    })));
    for (const [index, expected] of canonical.items.entries()) {
      const slot = slots[index];
      const file = files[index];
      if (slot.path !== expected.path || typeof slot.token !== 'string' ||
          slot.token.length < 1 || slot.token.length > 8192 ||
          !(file instanceof File) ||
          file.size !== expected.sizeBytes || file.type !== expected.mime) {
        throw new Error('mismatched file or signed slot');
      }
    }
  } catch {
    throw new RoleplayBrowserUploadError('INVALID_PLAN', 0);
  }

  let uploadedCount = 0;
  for (const [index, expected] of canonical.items.entries()) {
    if (options.signal?.aborted) {
      throw new RoleplayBrowserUploadError('CANCELLED', uploadedCount);
    }

    let result: { error: unknown | null };
    try {
      result = await transfer({
        path: expected.path,
        mime: expected.mime,
        token: slots[index].token,
      }, files[index], options.signal);
    } catch {
      // Do not reflect Storage errors: they may contain private object keys or
      // signed URLs. The caller can report a fixed user-facing error.
      throw new RoleplayBrowserUploadError('UPLOAD_FAILED', uploadedCount);
    }
    if (options.signal?.aborted) {
      throw new RoleplayBrowserUploadError('CANCELLED', uploadedCount);
    }
    if (!result || result.error !== null) {
      throw new RoleplayBrowserUploadError('UPLOAD_FAILED', uploadedCount);
    }
    uploadedCount++;

    try {
      options.onUploaded?.(uploadedCount, canonical.items.length);
    } catch {
      throw new RoleplayBrowserUploadError('PROGRESS_FAILED', uploadedCount);
    }
    // Cancellation from the final progress callback must not be reported as
    // a successfully completed batch. The server still reconciles any bytes.
    if (options.signal?.aborted) {
      throw new RoleplayBrowserUploadError('CANCELLED', uploadedCount);
    }
  }

  return { uploadedCount };
}
