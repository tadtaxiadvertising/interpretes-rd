import { getAdminRoleplayAudioExtension } from './admin-audio-extension';
import { makePrivateClinicalReference, privateClinicalObjectPath } from './private-clinical-reference';
import { validateRoleplayDirectUploadPublication, type RoleplayUploadReservationSnapshot, type TrustedRoleplayUploadEvidence } from './direct-upload-publication-gate';

export function planVerifiedClinicalPublication(reservation: RoleplayUploadReservationSnapshot,
  evidence: readonly TrustedRoleplayUploadEvidence[], actor: string, now: number) {
  const validated = validateRoleplayDirectUploadPublication(reservation, evidence, actor, now);
  return validated.items.map(item => {
    const ext = getAdminRoleplayAudioExtension(item.mime);
    if (!ext) throw new Error('INVALID_FINAL_AUDIO');
    const reference = makePrivateClinicalReference(validated.batchId, item.order, ext);
    const destination = privateClinicalObjectPath(reference);
    if (!destination) throw new Error('INVALID_FINAL_AUDIO');
    return { item, reference, destination };
  });
}
