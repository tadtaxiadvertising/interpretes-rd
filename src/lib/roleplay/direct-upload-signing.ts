import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
import { claimRoleplayDirectUploadReservation } from './direct-upload-reservation-ledger';
import { fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';
import { ROLEPLAY_UPLOAD_RESERVATION_TTL_MS } from './direct-upload-reservation';
import { requirePrivateRoleplayAudioBucket } from './private-audio-bucket-readiness';

type Store = Pick<PrismaClient, 'roleplayUploadReservation'>;
type Storage = Parameters<typeof requirePrivateRoleplayAudioBucket>[0] & {
  from(bucket: string): { createSignedUploadUrl(path: string, options: { upsert: false }): Promise<{ data: { path: string; token: string } | null; error: unknown }> };
};

/** No re-sign on ambiguous requests. A separate reconciliation service must
 * inspect old uploads. This grants staging uploads only, not publication. */
export async function reserveAndSignDirectUpload(db: Store, storage: Storage, actorUserId: string,
  requestKey: string, declarations: unknown) {
  const bucket = await requirePrivateRoleplayAudioBucket(storage);
  const claim = await claimRoleplayDirectUploadReservation(db, actorUserId, requestKey, declarations, Date.now());
  if (claim.kind !== 'CREATED') return claim;
  const row = await db.roleplayUploadReservation.findUnique({
    where: { actorUserId_requestKey: { actorUserId, requestKey } },
    select: { id: true, actorUserId: true, requestKey: true, status: true, items: true,
      declarationHash: true, createdAt: true, expiresAt: true },
  });
  const canonical = prepareRoleplayDirectUploadBatch(claim.batchId, declarations);
  const now = Date.now();
  if (!row || row.id !== claim.batchId || row.actorUserId !== actorUserId || row.requestKey !== requestKey ||
      row.status !== 'RESERVED' || row.declarationHash !== fingerprintRoleplayDirectUploadDeclarations(canonical.items) ||
      !Array.isArray(row.items) || row.items.length !== canonical.items.length ||
      row.createdAt.getTime() > now || row.expiresAt.getTime() <= now ||
      row.expiresAt.getTime() - row.createdAt.getTime() !== ROLEPLAY_UPLOAD_RESERVATION_TTL_MS ||
      canonical.items.some((item, i) => {
        const stored = row.items as unknown as Array<Record<string, unknown>>;
        return !stored[i] || Object.entries(item).some(([key, value]) => stored[i][key] !== value);
      })) throw new Error('DIRECT_UPLOAD_RESERVATION_INVALID');
  const slots = [];
  for (const item of canonical.items) {
    if (Date.now() >= row.expiresAt.getTime()) throw new Error('DIRECT_UPLOAD_RESERVATION_EXPIRED');
    await requirePrivateRoleplayAudioBucket(storage);
    const result = await storage.from(bucket).createSignedUploadUrl(item.path, { upsert: false });
    if (result.error || result.data?.path !== item.path || typeof result.data.token !== 'string' ||
        !result.data.token || result.data.token.length > 8192) throw new Error('DIRECT_UPLOAD_SIGNING_FAILED');
    slots.push({ ...item, token: result.data.token });
  }
  if (Date.now() >= row.expiresAt.getTime()) throw new Error('DIRECT_UPLOAD_RESERVATION_EXPIRED');
  return { kind: 'CREATED' as const, batchId: row.id, expiresAt: row.expiresAt.toISOString(), slots };
}
