import { createHash } from 'node:crypto';
import type { PreparedRoleplayUpload } from '@/lib/roleplay/direct-upload-contract';

const REQUEST_KEY_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function isRoleplayDirectUploadRequestKey(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_KEY_PATTERN.test(value);
}

/**
 * Stable digest of ALREADY VALIDATED declarations, independent of batch UUID,
 * clock, staging paths or upload tokens. Shared by the original INSERT claim
 * and future read-only reconciliation so equivalent requests cannot drift.
 * Only call after prepareNewRoleplayUploadReservation has validated all items.
 */
export function fingerprintRoleplayDirectUploadDeclarations(
  items: readonly Pick<PreparedRoleplayUpload, 'order' | 'mime' | 'sizeBytes' | 'sha256'>[],
): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    items: items.map(({ order, mime, sizeBytes, sha256 }) =>
      ({ order, mime, sizeBytes, sha256 })),
  })).digest('hex');
}
