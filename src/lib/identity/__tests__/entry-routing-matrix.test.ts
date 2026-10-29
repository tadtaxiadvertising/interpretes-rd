import { describe, it, expect } from 'vitest';
import { resolveDestination } from '@/lib/identity/resolve-user';

/**
 * Full regression matrix for entry routing (AGENTS.md § "Regression matrix for entry routing").
 * Each case maps (role, onboardingStatus, roleplayState, sessionId) → expected destination.
 */
type Case = {
  role: 'admin' | 'interpreter';
  onboardingStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'NEEDS_REVIEW';
  roleplayState:
    | 'NO_ROLEPLAY' | 'DRAFT' | 'INVITED' | 'STARTED' | 'IN_PROGRESS'
    | 'SUBMITTED' | 'UNDER_REVIEW' | 'EVALUATED' | 'PASSED' | 'FAILED'
    | 'EXPIRED' | 'CANCELLED';
  sessionId: string | null;
  expected: string;
};

const interpreterBase = (overrides: Partial<Case>): Case => ({
  role: 'interpreter',
  onboardingStatus: 'COMPLETED',
  roleplayState: 'NO_ROLEPLAY',
  sessionId: null,
  ...overrides,
});

const cases: Case[] = [
  // Admin: always /admin regardless of state
  { role: 'admin', onboardingStatus: 'NOT_STARTED', roleplayState: 'NO_ROLEPLAY', sessionId: null, expected: '/admin' },
  { role: 'admin', onboardingStatus: 'COMPLETED', roleplayState: 'INVITED', sessionId: 's-1', expected: '/admin' },
  { role: 'admin', onboardingStatus: 'IN_PROGRESS', roleplayState: 'SUBMITTED', sessionId: 's-2', expected: '/admin' },

  // Onboarding not complete → onboarding
  interpreterBase({ onboardingStatus: 'NOT_STARTED', expected: '/onboarding' }),
  interpreterBase({ onboardingStatus: 'NEEDS_REVIEW', expected: '/onboarding' }),

  // In progress → resume
  interpreterBase({ onboardingStatus: 'IN_PROGRESS', expected: '/onboarding?resume=true' }),

  // Completed + active roleplay → roleplay page (with session id)
  interpreterBase({ roleplayState: 'INVITED', sessionId: 'sess-1', expected: '/roleplays/sess-1' }),
  interpreterBase({ roleplayState: 'STARTED', sessionId: 'sess-2', expected: '/roleplays/sess-2' }),
  interpreterBase({ roleplayState: 'IN_PROGRESS', sessionId: 'sess-3', expected: '/roleplays/sess-3' }),

  // Completed + active roleplay but no session id → fallback
  interpreterBase({ roleplayState: 'INVITED', sessionId: null, expected: '/dashboard/roleplays' }),

  // Completed + submitted/review/evaluated/passed/failed/expired/cancelled/no-roleplay → dashboard
  ...(['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED', 'NO_ROLEPLAY'] as const).map(
    (rs) => interpreterBase({ roleplayState: rs, sessionId: 'sess-x', expected: '/dashboard' }),
  ),
];

describe('Entry routing regression matrix', () => {
  it.each(cases.map((c, i) => [i, c]))(
    'case %i: %s',
    (_i, c) => {
      const identity = {
        role: c.role,
        onboardingStatus: c.onboardingStatus,
        onboardingStep: c.onboardingStatus === 'COMPLETED' ? 'complete' : 'legal',
        onboardingVersion: 1,
        onboardingCompletedAt: c.onboardingStatus === 'COMPLETED' ? new Date() : null,
        roleplayState: c.roleplayState,
        roleplaySessionId: c.sessionId,
      };
      expect(resolveDestination(identity as any)).toBe(c.expected);
    },
  );
});
