import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
import { claimRoleplayDirectUploadReservation } from './direct-upload-reservation-ledger';
import { fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';
import { ROLEPLAY_UPLOAD_RESERVATION_TTL_MS } from './direct-upload-reservation';
import { requirePrivateRoleplayAudioBucket } from './private-audio-bucket-readiness';

type Store = Pick<PrismaClient, 'roleplayUploadReservation' | '$queryRaw'>;
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
  // Commit irreversible signing intent before the first provider call.
  // A lost response, partial signing or failed network call is never refundable.
  // Missing migration, missing charge, or inconsistent budget fails closed.
  const charges = await db.$queryRaw<{slots:number}[]>`
    UPDATE public.roleplay_direct_upload_budget_charges c SET capability_state='SIGNING_STARTED'
    FROM public.roleplay_direct_upload_budget b,public.roleplay_upload_reservations r
    WHERE b.singleton=true AND r.id=c.reservation_id AND c.reservation_id=${row.id}::uuid
      AND c.actor_user_id=${actorUserId} AND c.request_key=${requestKey}::uuid
      AND r.actor_user_id=c.actor_user_id AND r.request_key=c.request_key
      AND r.status='RESERVED' AND r.expires_at>clock_timestamp()
      AND r.declaration_hash=${row.declarationHash} AND c.slots=${canonical.items.length}::integer
      AND c.capability_state='UNISSUED'
      AND b.allocated_slots>=c.slots AND b.allocated_slots<=b.max_slots
    RETURNING c.slots
  `;
  if(charges.length!==1 || charges[0].slots!==canonical.items.length)
    throw new Error('DIRECT_UPLOAD_BUDGET_UNAVAILABLE');
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
