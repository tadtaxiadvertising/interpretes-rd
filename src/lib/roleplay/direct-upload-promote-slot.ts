import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { PreparedRoleplayUpload } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations, isRoleplayDirectUploadRequestKey } from './direct-upload-reservation-fingerprint';
import { planVerifiedClinicalPublication } from './direct-upload-final-reference';
import type { RoleplayUploadReservationSnapshot, TrustedRoleplayUploadEvidence } from './direct-upload-publication-gate';
import { ROLEPLAY_UPLOAD_RESERVATION_TTL_MS } from './direct-upload-reservation';

type Store = Pick<PrismaClient, 'roleplayUploadReservation'>;
export type FinalObjectPort = {
  // A trusted adapter must refuse overwrites, including concurrent copies.
  // Existing destinations must be verified independently, never replaced.
  copyIfAbsent(source: string, destination: string): Promise<void>;
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
export async function promoteVerifiedClinicalSlot(db: Store, port: FinalObjectPort, actor: string, requestKey: string, order: number) {
  const { reservation, plans } = await loadVerifiedPublication(db, actor, requestKey);
  const plan = Number.isSafeInteger(order) ? plans[order] : undefined;
  if (!plan) throw new Error('INVALID_FINAL_SLOT');
  try {
    await port.copyIfAbsent(plan.item.path, plan.destination);
  } catch {
    // A lost acknowledgement or another worker may have created the final
    // object. Only byte verification can recover; never overwrite.
  }
  const actual = await port.verify({ ...plan.item, path: plan.destination });
  if (actual.sizeBytes !== plan.item.sizeBytes || actual.sha256 !== plan.item.sha256 ||
      Date.now() >= reservation.expiresAtMs) throw new Error('FINAL_AUDIO_UNVERIFIED');
  return { order, reference: plan.reference, sizeBytes: actual.sizeBytes, sha256: actual.sha256 };
}
