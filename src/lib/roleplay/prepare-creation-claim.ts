import type { PrismaClient } from '@prisma/client';
import { resolveRoleplayCreationActor } from './creation-actor';
import { collectRoleplayCreationAudioDigests } from './creation-audio-digests';
import { parseRoleplayReceiptRequest } from './creation-receipt';
import {
  claimRoleplayCreation, fingerprintRoleplayCreation, InvalidRoleplayCreationKeyError,
  type RoleplayCreationClaim, type RoleplayCreationFingerprintInput,
} from './creation-idempotency-ledger';

type Metadata = Omit<RoleplayCreationFingerprintInput, 'audios' | 'libraryFingerprint'>;
type Source =
  | { kind: 'upload'; files: readonly unknown[]; checksums: readonly (string | null)[] | null }
  | { kind: 'library'; verifiedFingerprint: string };
type ClaimContext = { actorUserId: string; requestKey: string; payloadHash: string };
type PreparedClaim =
  | { kind: 'FORBIDDEN' }
  | { kind: 'CLAIMED'; context: ClaimContext }
  | Exclude<RoleplayCreationClaim, { kind: 'CLAIMED' }>;

/**
 * Server-only composition, not connected to a live creation route yet.
 * Call only after bounded parsing and full validation of destination, scenarios,
 * opening requirement and (for library reuse) the trusted database snapshot.
 * The route must authenticate before parsing multipart; recheck the actor here
 * before reading any audio stream or claiming a key. Never accept metadata or
 * a library fingerprint as a trusted snapshot directly from browser JSON.
 * Only CLAIMED authorizes proceeding; completion belongs to the publication
 * transaction. Never retry a conflicting or ambiguous claim automatically.
 */
export async function prepareRoleplayCreationClaim(
  db: Pick<PrismaClient, 'roleplayCreationRequest' | 'roleplaySession'>,
  req: Request,
  rawRequestKey: unknown,
  metadata: Metadata,
  source: Source,
): Promise<PreparedClaim> {
  const actorUserId = await resolveRoleplayCreationActor(req);
  if (!actorUserId) return { kind: 'FORBIDDEN' };
  const requestKey = parseRoleplayReceiptRequest({ requestKey: rawRequestKey });
  if (source.kind === 'upload' && source.files.length !== metadata.scenarios.length) {
    throw new InvalidRoleplayCreationKeyError();
  }
  const audios = source.kind === 'upload'
    ? await collectRoleplayCreationAudioDigests(source.files, source.checksums)
    : [];
  const payloadHash = fingerprintRoleplayCreation({
    ...metadata, libraryFingerprint: source.kind === 'library' ? source.verifiedFingerprint : null, audios,
  });
  const claim = await claimRoleplayCreation(db, actorUserId, requestKey, payloadHash);
  return claim.kind === 'CLAIMED' ? { kind: 'CLAIMED', context: { actorUserId, requestKey, payloadHash } } : claim;
}
