import { ROLEPLAY_DIRECT_UPLOAD_MAX_SLOTS, ROLEPLAY_ADMIN_AUDIO_MAX_BYTES, ROLEPLAY_DIRECT_UPLOAD_BATCH_MAX_BYTES } from '@/lib/roleplay-limits';
import { getAdminRoleplayAudioExtension } from '@/lib/roleplay/admin-audio-extension';

export const ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES = ROLEPLAY_ADMIN_AUDIO_MAX_BYTES;
export const ROLEPLAY_DIRECT_UPLOAD_MAX_TOTAL_BYTES =
  ROLEPLAY_DIRECT_UPLOAD_BATCH_MAX_BYTES;

export interface RoleplayDirectUploadDeclaration {
  order: number;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

export interface PreparedRoleplayUpload {
  order: number;
  mime: string;
  sizeBytes: number;
  sha256: string;
  path: string;
}

const UUID_V4_OR_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Pure validation only. This function DOES NOT grant any upload capability,
 * create signed URLs, make Storage requests, or verify object ownership.
 *
 * The future authenticated server endpoint must generate batchId itself,
 * persist an admin-bound reservation, and enforce expiration/idempotency.
 * Never pass a client-provided batch ID or path to this function.
 */
export function prepareRoleplayDirectUploadBatch(
  batchId: string,
  declarations: unknown,
): { items: PreparedRoleplayUpload[]; totalBytes: number } {
  return prepareBatch(batchId, declarations, ROLEPLAY_DIRECT_UPLOAD_MAX_SLOTS);
}

/** Offline pilot only: no paths, tokens or permissions returned. Never use as
 * the reservation/publication gate. The production wrapper above stays at 25. */
export function inspectExpandedRoleplayCapacityPilot(declarations: unknown) {
  const prepared = prepareBatch('00000000-0000-4000-8000-000000000001', declarations, 50);
  return {
    slots: prepared.items.length,
    declaredBytes: prepared.totalBytes,
    worstCaseReservedBytes: prepared.items.length * 2 * ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES,
    activationAuthorized: false as const,
  };
}

function prepareBatch(batchId: string, declarations: unknown, maxSlots: number):
  { items: PreparedRoleplayUpload[]; totalBytes: number } {
  if (typeof batchId !== 'string' || !UUID_V4_OR_V7.test(batchId)) {
    throw new Error('INVALID_ROLEPLAY_UPLOAD_BATCH_ID');
  }
  if (!Array.isArray(declarations) ||
      declarations.length < 1 || declarations.length > maxSlots) {
    throw new Error('INVALID_ROLEPLAY_UPLOAD_COUNT');
  }

  let totalBytes = 0;
  const result: PreparedRoleplayUpload[] = [];
  for (const [index, item] of declarations.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('INVALID_ROLEPLAY_UPLOAD_DECLARATION');
    }
    // Reject injected paths, signed URLs, original filenames and unknown
    // fields outright. The server alone chooses immutable object paths.
    const fields = Object.keys(item);
    if (fields.length !== 4 ||
        fields.some(key => !['order', 'mime', 'sizeBytes', 'sha256'].includes(key))) {
      throw new Error('INVALID_ROLEPLAY_UPLOAD_DECLARATION');
    }

    const declaration = item as Partial<RoleplayDirectUploadDeclaration>;
    if (declaration.order !== index ||
        typeof declaration.sizeBytes !== 'number' ||
        !Number.isSafeInteger(declaration.sizeBytes) ||
        declaration.sizeBytes < 1 ||
        declaration.sizeBytes > ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES) {
      throw new Error('INVALID_ROLEPLAY_UPLOAD_SIZE_OR_ORDER');
    }

    const mime = declaration.mime;
    const sha256 = declaration.sha256;
    const ext = typeof mime === 'string' ? getAdminRoleplayAudioExtension(mime) : null;
    // Validate both values directly so TypeScript narrows the optional
    // declaration fields before constructing a PreparedRoleplayUpload.
    if (typeof mime !== 'string' || !ext || typeof sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error('INVALID_ROLEPLAY_UPLOAD_MEDIA_OR_DIGEST');
    }

    totalBytes += declaration.sizeBytes;
    if (totalBytes > ROLEPLAY_DIRECT_UPLOAD_MAX_TOTAL_BYTES) {
      throw new Error('INVALID_ROLEPLAY_UPLOAD_TOTAL_BYTES');
    }
    result.push({
      order: index,
      mime,
      sizeBytes: declaration.sizeBytes,
      sha256,
      path: 'staging/roleplay/' + batchId + '/' + index + '.' + ext,
    });
  }

  return { items: result, totalBytes };
}
