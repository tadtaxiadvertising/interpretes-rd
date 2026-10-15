import { describe, it, expect, vi } from 'vitest';

// The module under test transitively imports server-only dependencies. They are
// never exercised by these pure-function tests, so stub them out.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: { findUnique: vi.fn() },
    interpreter: { findFirst: vi.fn(), findUnique: vi.fn() },
    roleplaySession: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/auth-rbac', () => ({ auth: vi.fn() }));
vi.mock('@/lib/admin-identity', () => ({ resolveUserRoleByEmail: vi.fn() }));

import {
  computeRoleplayState,
  computeEligibility,
  resolveDestination,
  type ResolvedIdentity,
  type RoleplayState,
} from '@/lib/identity/resolve-user';

function makeSession(status: string, overrides: Partial<{ qaScoreId: number | null }> = {}) {
  return {
    id: 'session-1',
    status,
    interpreterId: 10,
    recruitmentCandidateId: null,
    currentScenarioIndex: 0,
    recordedAudioUrl: null,
    submittedAt: null,
    evaluatedAt: null,
    qaScoreId: overrides.qaScoreId ?? null,
    access: { usedAt: null, expiresAt: new Date(Date.now() + 86400000), validatedAt: null, startedAt: null },
  };
}

function makeIdentity(roleplayState: RoleplayState, overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return {
    userId: 'user-1',
    profileId: 'profile-1',
    interpreterId: 10,
    candidateId: null,
    email: 'test@example.com',
    role: 'interpreter',
    provider: 'supabase',
    onboardingStatus: 'COMPLETED',
    onboardingStep: 'complete',
    onboardingVersion: 1,
    onboardingCompletedAt: new Date(),
    roleplayState,
    roleplaySessionId: 'session-1',
    eligibility: computeEligibility('COMPLETED', roleplayState, 'interpreter'),
    ...overrides,
  };
}

describe('computeRoleplayState', () => {
  it('returns NO_ROLEPLAY when there is no session', () => {
    expect(computeRoleplayState(null, 10, null)).toEqual({ state: 'NO_ROLEPLAY', sessionId: null });
  });

  it.each([
    ['DRAFT', 'INVITED'],
    ['INVITED', 'INVITED'],
    ['STARTED', 'STARTED'],
    ['IN_PROGRESS', 'IN_PROGRESS'],
    ['SUBMITTED', 'SUBMITTED'],
    ['UNDER_REVIEW', 'UNDER_REVIEW'],
    ['EVALUATED', 'EVALUATED'],
    ['PASSED', 'PASSED'],
    ['FAILED', 'FAILED'],
    ['EXPIRED', 'EXPIRED'],
    ['CANCELLED', 'CANCELLED'],
  ])('maps persisted status %s to %s', (status, expected) => {
    const result = computeRoleplayState(makeSession(status) as any, 10, null);
    expect(result.state).toBe(expected);
    expect(result.sessionId).toBe('session-1');
  });

  it('treats the legacy PENDING status as an invitation', () => {
    expect(computeRoleplayState(makeSession('PENDING') as any, 10, null).state).toBe('INVITED');
  });

  it('treats an unknown status as an invitation (fail-safe)', () => {
    expect(computeRoleplayState(makeSession('SOMETHING_ELSE') as any, 10, null).state).toBe('INVITED');
  });
});

describe('resolveDestination routing', () => {
  it('sends an invited interpreter into the roleplay session', () => {
    expect(resolveDestination(makeIdentity('INVITED'))).toBe('/roleplays/session-1');
  });

  it('resumes a started session in the roleplay', () => {
    expect(resolveDestination(makeIdentity('STARTED'))).toBe('/roleplays/session-1');
    expect(resolveDestination(makeIdentity('IN_PROGRESS'))).toBe('/roleplays/session-1');
  });

  it('sends a submitted session to the dashboard instead of the roleplay', () => {
    expect(resolveDestination(makeIdentity('SUBMITTED'))).toBe('/dashboard');
    expect(resolveDestination(makeIdentity('UNDER_REVIEW'))).toBe('/dashboard');
  });

  it('sends evaluated/passed/failed sessions to the dashboard', () => {
    expect(resolveDestination(makeIdentity('EVALUATED'))).toBe('/dashboard');
    expect(resolveDestination(makeIdentity('PASSED'))).toBe('/dashboard');
    expect(resolveDestination(makeIdentity('FAILED'))).toBe('/dashboard');
  });

  it('sends expired/cancelled sessions to the dashboard', () => {
    expect(resolveDestination(makeIdentity('EXPIRED'))).toBe('/dashboard');
    expect(resolveDestination(makeIdentity('CANCELLED'))).toBe('/dashboard');
  });

  it('keeps admins on the admin panel regardless of roleplay state', () => {
    expect(resolveDestination(makeIdentity('INVITED', { role: 'admin', interpreterId: null }))).toBe('/admin');
  });
});
