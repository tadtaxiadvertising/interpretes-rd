import { describe, expect, it } from 'vitest';
import { canBindRoleplayInvitation } from './invite-ownership';

describe('roleplay invitation ownership boundary', () => {
  const candidate = { role: 'candidate', candidateId: 5, interpreterId: null } as const;
  const interpreter = { role: 'interpreter', candidateId: null, interpreterId: 7 } as const;
  const admin = { role: 'admin', candidateId: null, interpreterId: null } as const;

  it('refuses unauthenticated invitation possession', () => {
    expect(canBindRoleplayInvitation(null, { recruitmentCandidateId: 5, interpreterId: null })).toBe(false);
  });

  it('requires the exact candidate identity for a candidate-owned session', () => {
    const session = { recruitmentCandidateId: 5, interpreterId: null };
    expect(canBindRoleplayInvitation(candidate, session)).toBe(true);
    expect(canBindRoleplayInvitation({ ...candidate, candidateId: 6 }, session)).toBe(false);
    expect(canBindRoleplayInvitation(interpreter, session)).toBe(false);
  });

  it('does not let a legacy interpreter link override a recruitment candidate', () => {
    const legacy = { recruitmentCandidateId: 5, interpreterId: 7 };
    expect(canBindRoleplayInvitation(interpreter, legacy)).toBe(false);
    expect(canBindRoleplayInvitation(candidate, legacy)).toBe(true);
  });

  it('requires interpreter ownership for interpreter-only sessions', () => {
    const session = { recruitmentCandidateId: null, interpreterId: 7 };
    expect(canBindRoleplayInvitation(interpreter, session)).toBe(true);
    expect(canBindRoleplayInvitation({ ...interpreter, interpreterId: 8 }, session)).toBe(false);
    expect(canBindRoleplayInvitation(candidate, session)).toBe(false);
  });

  it('permits administrative review without representing an invitation as a candidate login', () => {
    expect(canBindRoleplayInvitation(admin, { recruitmentCandidateId: 5, interpreterId: 7 })).toBe(true);
  });
});
