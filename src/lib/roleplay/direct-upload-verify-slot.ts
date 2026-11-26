import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prepareRoleplayDirectUploadBatch, type PreparedRoleplayUpload } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations, isRoleplayDirectUploadRequestKey } from './direct-upload-reservation-fingerprint';
import { validateRoleplayDirectUploadPublication, type TrustedRoleplayUploadEvidence } from './direct-upload-publication-gate';
import { ROLEPLAY_UPLOAD_RESERVATION_TTL_MS } from './direct-upload-reservation';

type Store = Pick<PrismaClient, 'roleplayUploadReservation'>;
type Verify = (item: PreparedRoleplayUpload) => Promise<{ sizeBytes: number; sha256: string }>;
export type VerifySlotResult =
  | { kind: 'NOT_FOUND' | 'CLOSED' | 'EXPIRED' | 'OUT_OF_ORDER' | 'RETRY' }
  | { kind: 'PROGRESS'; verifiedCount: number; total: number; complete: boolean };

async function loadDirectUploadSlot(db: Store, actor: string, requestKey: string, order: number) {
  if (!actor || !isRoleplayDirectUploadRequestKey(requestKey) || !Number.isInteger(order) || order < 0 || order >= 25) throw new Error('INVALID_VERIFY_REQUEST');
  const row = await db.roleplayUploadReservation.findUnique({
    where: { actorUserId_requestKey: { actorUserId: actor, requestKey } },
    select: { id: true, actorUserId: true, requestKey: true, status: true, items: true, verifiedObjects: true,
      declarationHash: true, createdAt: true, expiresAt: true },
  });
  if (!row || row.actorUserId !== actor || row.requestKey !== requestKey) return { kind: 'NOT_FOUND' as const };
  if (row.status !== 'RESERVED' && row.status !== 'VERIFIED') return { kind: 'CLOSED' as const };
  const now = Date.now(), created = row.createdAt.getTime(), expires = row.expiresAt.getTime();
  if (!Number.isSafeInteger(created) || created <= 0 || created > now || expires - created !== ROLEPLAY_UPLOAD_RESERVATION_TTL_MS) throw new Error('INVALID_RESERVATION');
  if (now >= expires) return { kind: 'EXPIRED' as const };
  if (!Array.isArray(row.items) || !Array.isArray(row.verifiedObjects)) throw new Error('INVALID_RESERVATION');
  const stored = row.items as unknown as PreparedRoleplayUpload[];
  const { items } = prepareRoleplayDirectUploadBatch(row.id, stored.map(({ order, mime, sizeBytes, sha256 }) => ({ order, mime, sizeBytes, sha256 })));
  if (fingerprintRoleplayDirectUploadDeclarations(items) !== row.declarationHash ||
      items.some((item, i) => Object.entries(item).some(([key,value]) => (stored[i] as unknown as Record<string,unknown>)[key] !== value))) throw new Error('INVALID_RESERVATION');
  const evidence = row.verifiedObjects as unknown as TrustedRoleplayUploadEvidence[];
  if (evidence.length > items.length || (row.status === 'VERIFIED') !== (evidence.length === items.length)) throw new Error('INVALID_EVIDENCE');
  for (const [i, proof] of evidence.entries()) {
    const item = items[i];
    if (!proof || Object.keys(proof).length !== 5 || proof.order !== i || proof.path !== item.path ||
        proof.sizeBytes !== item.sizeBytes || proof.sha256 !== item.sha256 ||
        !Number.isSafeInteger(proof.verifiedAtMs) || proof.verifiedAtMs < created || proof.verifiedAtMs > now ||
        proof.verifiedAtMs >= expires) throw new Error('INVALID_EVIDENCE');
  }
  return { kind: 'READY' as const, row, items, evidence, now, created, expires };
}

export type InspectSlotResult = VerifySlotResult | { kind: 'PRESENT_UNVERIFIED' | 'NOT_OBSERVED'; verifiedCount: number; total: number };

/** Read-only reconciliation; NOT_OBSERVED is not proof of absence and does
 * not authorize another reservation, signing, deletion or overwrite. */
export async function inspectDirectUploadSlot(db: Store, actor: string, requestKey: string, order: number,
  observe: (item: PreparedRoleplayUpload) => Promise<boolean>): Promise<InspectSlotResult> {
  const state = await loadDirectUploadSlot(db, actor, requestKey, order);
  if (state.kind !== 'READY') return state;
  const {items,evidence,expires} = state;
  if (order < evidence.length) return {kind:'PROGRESS',verifiedCount:evidence.length,total:items.length,complete:evidence.length===items.length};
  if (order !== evidence.length || order >= items.length) return {kind:'OUT_OF_ORDER'};
  const present = await observe(items[order]);
  if (typeof present !== 'boolean') throw new Error('STORAGE_OBSERVATION_UNAVAILABLE');
  if (Date.now() >= expires) return {kind:'EXPIRED'};
  return {kind:present?'PRESENT_UNVERIFIED':'NOT_OBSERVED',verifiedCount:evidence.length,total:items.length};
}

export async function verifyDirectUploadSlot(db: Store, actor: string, requestKey: string, order: number, verify: Verify): Promise<VerifySlotResult> {
  const state = await loadDirectUploadSlot(db, actor, requestKey, order);
  if (state.kind !== 'READY') return state;
  const {row,items,evidence,now,created,expires} = state;
  const progress = (count: number): VerifySlotResult => ({ kind: 'PROGRESS', verifiedCount: count, total: items.length, complete: count === items.length });
  if (order < evidence.length) return progress(evidence.length);
  if (order !== evidence.length || order >= items.length) return { kind: 'OUT_OF_ORDER' };
  const item = items[order];
  const result = await verify(item);
  const verifiedAtMs = Date.now();
  if (verifiedAtMs >= expires) return { kind: 'EXPIRED' };
  if (result.sizeBytes !== item.sizeBytes || result.sha256 !== item.sha256 || verifiedAtMs < now) throw new Error('INVALID_VERIFICATION');
  const next = [...evidence, { order, path: item.path, sizeBytes: result.sizeBytes, sha256: result.sha256, verifiedAtMs }];
  const complete = next.length === items.length;
  if (complete) validateRoleplayDirectUploadPublication({ batchId: row.id, ownerUserId: actor, status: 'VERIFIED', createdAtMs: created, expiresAtMs: expires, items }, next, actor, verifiedAtMs);
  // Never hold a DB transaction open during network streaming. Compare the
  // exact prior evidence array, so a concurrent verifier cannot lose progress.
  const updated = await db.roleplayUploadReservation.updateMany({
    where: { id: row.id, actorUserId: actor, requestKey, status: 'RESERVED', declarationHash: row.declarationHash,
      expiresAt: { gt: new Date(verifiedAtMs) }, verifiedObjects: { equals: row.verifiedObjects as Prisma.InputJsonValue } },
    data: { verifiedObjects: next as unknown as Prisma.InputJsonValue, status: complete ? 'VERIFIED' : 'RESERVED' },
  });
  return updated.count === 1 ? progress(next.length) : { kind: 'RETRY' };
}
