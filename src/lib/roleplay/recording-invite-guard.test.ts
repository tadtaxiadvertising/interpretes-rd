import { describe, expect, it } from 'vitest';
import { candidateCanUploadRoleplayAudio } from './recording-invite-guard';

describe('candidate invitation requirement for new recordings', () => {
  it('allows a validated and unconsumed candidate invitation', () => {
    expect(candidateCanUploadRoleplayAudio({
      recruitmentCandidateId: 5,
      access: { validatedAt: new Date(), usedAt: null },
    })).toBe(true);
  });

  it.each([
    null,
    { validatedAt: null, usedAt: null },
    { validatedAt: new Date(), usedAt: new Date() },
    { validatedAt: null, usedAt: new Date() },
  ])('denies unvalidated, missing or consumed candidate access', (access) => {
    expect(candidateCanUploadRoleplayAudio({
      recruitmentCandidateId: 5,
      access,
    })).toBe(false);
  });

  it('does not constrain interpreter sessions that do not have invitations', () => {
    expect(candidateCanUploadRoleplayAudio({
      recruitmentCandidateId: null,
      access: null,
    })).toBe(true);
  });
});
