import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { PreparedRoleplayUpload } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations, isRoleplayDirectUploadRequestKey } from './direct-upload-reservation-fingerprint';
import { planVerifiedClinicalPublication } from './direct-upload-final-reference';
import type { RoleplayUploadReservationSnapshot, TrustedRoleplayUploadEvidence } from './direct-upload-publication-gate';
import { ROLEPLAY_UPLOAD_RESERVATION_TTL_MS } from './direct-upload-reservation';

type Store = Pick<PrismaClient, 'roleplayUploadReservation'>;
export type FinalObjectPort = {
  // Caller must obtain the durable one-shot claim before invoking copy.
  // The adapter alone does not prove concurrent non-overwrite semantics.
  // Existing destinations must be verified independently, never replaced.
  copyIfAbsent(source: PreparedRoleplayUpload, destination: string): Promise<void>;
  verify(item: PreparedRoleplayUpload): Promise<{sizeBytes: number; sha256: string}>;
};

export async function loadVerifiedPublication(db: Store, actor: string, requestKey: string) {
  if (!actor || !isRoleplayDirectUploadRequestKey(requestKey)) throw new Error('INVALID_PUBLICATION_REQUEST');
  const row = await db.roleplayUploadReservation.findUnique({
    where: { actorUserId_requestKey: { actorUserId: actor, requestKey } },
    select: { id: true, actorUserId: true, requestKey: true, status: true, items: true, verifiedObjects: true,
      declarationHash: true, createdAt: true, expiresAt: true },
  });
  if (!row || row.actorUserId !== actor || row.requestKey !== requestKey || row.status !== 'VERIFIED' ||
      !Array.isArray(row.items) || !Array.isArray(row.verifiedObjects) ||
      row.expiresAt.getTime() - row.createdAt.getTime() !== ROLEPLAY_UPLOAD_RESERVATION_TTL_MS) {
    throw new Error('PUBLICATION_NOT_READY');
  }
  const reservation: RoleplayUploadReservationSnapshot = {
    batchId: row.id, ownerUserId: actor, status: 'VERIFIED', createdAtMs: row.createdAt.getTime(),
    expiresAtMs: row.expiresAt.getTime(), items: row.items as unknown as PreparedRoleplayUpload[],
  };
  const evidence = row.verifiedObjects as unknown as TrustedRoleplayUploadEvidence[];
  const plans = planVerifiedClinicalPublication(reservation, evidence, actor, Date.now());
  if (row.declarationHash !== fingerprintRoleplayDirectUploadDeclarations(plans.map(p => p.item))) throw new Error('PUBLICATION_NOT_READY');
  return { reservation, evidence, plans };
}

/** Only a trusted server/worker can invoke this; never accept a final URL,
 * destination, or claimed integrity proof from the client. No deletes or
 * session writes, including when a copy response is lost. */
export async function promoteVerifiedClinicalSlot(db: Store & Pick<PrismaClient,'$queryRaw'>, port: FinalObjectPort, actor: string, requestKey: string, order: number) {
  const { reservation, plans } = await loadVerifiedPublication(db, actor, requestKey);
  const plan = Number.isSafeInteger(order) ? plans[order] : undefined;
  if (!plan) throw new Error('INVALID_FINAL_SLOT');
  // Autocommit the permanent claim BEFORE network I/O. Never hold a DB
  // transaction across Storage or recycle a claim if a response is lost.
  const claimed=await db.$queryRaw<{order:number}[]>`
    INSERT INTO public.roleplay_final_write_claims
      (reservation_id,slot_order,actor_user_id,request_key,reference,size_bytes,sha256)
    SELECT id,${order}::integer,${actor},${requestKey}::uuid,${plan.reference},${plan.item.sizeBytes}::integer,${plan.item.sha256}
    FROM public.roleplay_upload_reservations
    WHERE id=${reservation.batchId}::uuid AND actor_user_id=${actor}
      AND request_key=${requestKey}::uuid AND status='VERIFIED' AND expires_at>clock_timestamp()
    ON CONFLICT (reservation_id,slot_order) DO NOTHING
    RETURNING slot_order AS "order"
  `;
  if(claimed.length===1 && claimed[0].order===order){
    if(Date.now()>=reservation.expiresAtMs) throw new Error('FINAL_AUDIO_UNVERIFIED');
    try{
      await port.copyIfAbsent(plan.item,plan.destination);
    }catch{
      // Remote acknowledgement may have been lost. Read and verify only.
    }
  }else if(claimed.length===0){
    const previous=await db.$queryRaw<{order:number}[]>`
      SELECT slot_order AS "order" FROM public.roleplay_final_write_claims
      WHERE reservation_id=${reservation.batchId}::uuid AND slot_order=${order}::integer
        AND actor_user_id=${actor} AND request_key=${requestKey}::uuid
        AND reference=${plan.reference} AND size_bytes=${plan.item.sizeBytes}::integer
        AND sha256=${plan.item.sha256}
    `;
    if(previous.length!==1 || previous[0].order!==order) throw new Error('FINAL_WRITE_CLAIM_UNAVAILABLE');
    // A second caller can verify, never send another write, even after expiry
    // of the original request or a crash before any bytes were transferred.
  }else throw new Error('FINAL_WRITE_CLAIM_UNAVAILABLE');
  const actual = await port.verify({ ...plan.item, path: plan.destination });
  if (actual.sizeBytes !== plan.item.sizeBytes || actual.sha256 !== plan.item.sha256 ||
      Date.now() >= reservation.expiresAtMs) throw new Error('FINAL_AUDIO_UNVERIFIED');
  return { order, reference: plan.reference, sizeBytes: actual.sizeBytes, sha256: actual.sha256 };
}
