import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  actor: null as any,
  identity: null as any,
  cookieSet: vi.fn(),
  candidateFindUnique: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  scenarioCount: vi.fn(),
  scenarioCreate: vi.fn(),
  accessUpsert: vi.fn(),
  accessFindFirst: vi.fn(),
  appFindUnique: vi.fn(),
  applicationFindFirst: vi.fn(),
  appUpdateMany: vi.fn(),
  eventCreate: vi.fn(),
  advanceApplication: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: m.cookieSet }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () =>
    m.actor ? { user: m.actor, profile: m.actor } : { error: 'Not authenticated', code: 'UNAUTHORIZED' },
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => m.identity,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    recruitmentCandidate: { findUnique: m.candidateFindUnique },
    roleplaySession: {
      findFirst: m.sessionFindFirst,
      create: m.sessionCreate,
      update: m.sessionUpdate,
      updateMany: m.sessionUpdateMany,
      findUnique: m.sessionFindUnique,
    },
    roleplayScenario: { count: m.scenarioCount, create: m.scenarioCreate },
    roleplayAccess: { upsert: m.accessUpsert, findFirst: m.accessFindFirst },
    recruitmentApplication: { findUnique: m.appFindUnique, findFirst: m.applicationFindFirst },
    $transaction: async (cb: any) =>
      cb({
        roleplaySession: { create: m.sessionCreate },
        recruitmentApplication: {
          findUnique: m.appFindUnique,
          updateMany: m.appUpdateMany,
        },
        recruitmentEvent: { create: m.eventCreate },
      }),
  },
}));

vi.mock('@/lib/roleplay', () => ({
  createSignedUploadUrl: vi.fn(),
  getBaseAudioPath: vi.fn(),
  getResponseAudioPath: vi.fn(),
  confirmUpload: vi.fn(),
  validateAudioFile: vi.fn(),
}));

vi.mock('@/services/recruitment/transitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/recruitment/transitions')>();
  return {
    ...actual,
    advanceApplication: (...args: any[]) => {
      const params = args[0] as { toStatus?: string; fromStatuses?: string[] };
      // Isolate the new retry pre-transition while keeping the real guarded
      // transition implementation under test for all existing paths.
      if (params.toStatus === 'ROLEPLAY_PENDING' && params.fromStatuses?.includes('ROLEPLAY_REVIEW')) {
        return m.advanceApplication(...args);
      }
      return actual.advanceApplication(...args);
    },
  };
});

vi.mock('@/app/actions/notifications', () => ({ createNotification: vi.fn() }));

import { startCandidateRoleplay, validateInviteToken } from '@/app/actions/roleplay';

const CANDIDATE_ACTOR = {
  provider: 'supabase',
  userId: 'u-1',
  email: 'Candidate@Example.com',
  role: 'candidate',
  interpreterId: null,
  candidateId: 5,
  profileId: 'p-1',
};
const ASSIGNED_SESSION = {
  id: 'sess-assigned',
  status: 'INVITED',
  baseAudioUrl: 'https://audio.example/base.mp3',
  scenarios: [{
    order: 0,
    title: 'Medical',
    baseAudioUrl: 'https://audio.example/scenario.mp3',
    durationLimitSec: 90,
    scriptPrompt: 'Prompt',
    expectedKeys: ['name'],
  }],
};

describe('startCandidateRoleplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = CANDIDATE_ACTOR;
    m.identity = {
      userId: 'u-1',
      email: 'candidate@example.com',
      role: 'candidate',
      candidateId: 5,
      eligibility: { needsOnboarding: false },
    };
    m.candidateFindUnique.mockResolvedValue({ id: 5 });
    m.advanceApplication.mockResolvedValue({ success: true, data: { advanced: true } });
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_PENDING' });
    m.sessionFindFirst.mockResolvedValue(null);
    m.sessionCreate.mockResolvedValue({ id: 'sess-new', status: 'STARTED' });
    m.sessionUpdate.mockResolvedValue({ id: 'sess-new' });
    m.sessionUpdateMany.mockResolvedValue({ count: 1 });
    m.sessionFindUnique.mockResolvedValue({ id: 'sess-draft', status: 'STARTED' });
    m.scenarioCount.mockResolvedValue(0);
    m.scenarioCreate.mockResolvedValue({ id: 'scn-1' });
    m.accessUpsert.mockResolvedValue({ id: 'acc-1' });
    m.appFindUnique.mockResolvedValue(null);
    m.appUpdateMany.mockResolvedValue({ count: 1 });
    m.eventCreate.mockResolvedValue({ id: 'evt-1' });
  });

  it('requires authentication', async () => {
    m.actor = null;

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect("requiresAuth" in res && res.requiresAuth).toBe(true);
    expect(m.cookieSet).not.toHaveBeenCalled();
    expect(m.accessUpsert).not.toHaveBeenCalled();
  });

  it('looks up the authorized candidate by resolved ID, never mutable email', async () => {
    m.sessionFindFirst.mockResolvedValue(ASSIGNED_SESSION);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.candidateFindUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { id: true },
    });
    expect(m.candidateFindUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'candidate@example.com' } })
    );
  });

  it('rejects when the resolved candidate ID no longer has an expediente', async () => {
    m.identity.candidateId = 99;
    m.candidateFindUnique.mockResolvedValue(null);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
    expect(m.candidateFindUnique).toHaveBeenCalledWith({
      where: { id: 99 },
      select: { id: true },
    });
    expect(m.applicationFindFirst).not.toHaveBeenCalled();
    expect(m.accessUpsert).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('does not require interpreter onboarding for a recruitment candidate with an assigned exercise', async () => {
    m.identity.eligibility.needsOnboarding = true;
    m.sessionFindFirst.mockResolvedValue(ASSIGNED_SESSION);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'sess-assigned', expect.any(Object));
  });

  it.each(['APPLIED', 'INDUCTION_PENDING', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'HIRED', 'INTERVIEW_PENDING'])(
    'blocks roleplay start for application status %s',
    async (status) => {
      m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status });

      const res = await startCandidateRoleplay();

      expect(res.success).toBe(false);
      expect(res.code).toBe('CONFLICT');
      expect(m.sessionCreate).not.toHaveBeenCalled();
      expect(m.accessUpsert).not.toHaveBeenCalled();
      expect(m.cookieSet).not.toHaveBeenCalled();
    }
  );

  it('does not move the application back to pending while a reviewer owns the session', async () => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, id: 'sess-reviewing', status: 'UNDER_REVIEW' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.advanceApplication).not.toHaveBeenCalled();
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it.each(['SUBMITTED', 'STARTED', 'IN_PROGRESS', 'INVITED', 'PASSED'])(
    'never reopens a %s session while the application is in QA review',
    async (status) => {
      m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
      m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, status });

      const res = await startCandidateRoleplay();

      expect(res.success).toBe(false);
      expect(res.code).toBe('CONFLICT');
      expect(m.advanceApplication).not.toHaveBeenCalled();
      expect(m.sessionCreate).not.toHaveBeenCalled();
      expect(m.accessUpsert).not.toHaveBeenCalled();
      expect(m.cookieSet).not.toHaveBeenCalled();
    },
  );

  it('does not permit a retry if QA has not saved a score for an evaluated session', async () => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, status: 'EVALUATED', qaScore: null });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(m.advanceApplication).not.toHaveBeenCalled();
    expect(m.sessionCreate).not.toHaveBeenCalled();
  });

  it('does not allow a passed QA evaluation to be retried because pipeline bookkeeping lagged', async () => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({
      ...ASSIGNED_SESSION,
      status: 'EVALUATED',
      qaScore: { totalScore: 88, criticalError: false },
    });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.advanceApplication).not.toHaveBeenCalled();
    expect(m.sessionCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['a failed QA score', { totalScore: 62.5, criticalError: false }],
    ['a critical QA error', { totalScore: 88, criticalError: true }],
  ])('creates a fresh attempt only after %s', async (_reason, qaScore) => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, status: 'EVALUATED', qaScore });
    m.sessionCreate.mockResolvedValue({ id: 'sess-retry', status: 'STARTED' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.sessionCreate).toHaveBeenCalledTimes(1);
    expect(m.advanceApplication).toHaveBeenCalledWith(expect.objectContaining({
      fromStatuses: ['ROLEPLAY_REVIEW'],
      toStatus: 'ROLEPLAY_PENDING',
    }));
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'sess-retry', expect.any(Object));
  });

  it('creates the replacement session through the same transaction as the QA retry transition', async () => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({
      ...ASSIGNED_SESSION,
      status: 'EVALUATED',
      qaScore: { totalScore: 60, criticalError: false },
    });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.advanceApplication).toHaveBeenCalledWith(expect.objectContaining({
      fromStatuses: ['ROLEPLAY_REVIEW'],
      db: expect.objectContaining({
        recruitmentApplication: expect.objectContaining({ updateMany: m.appUpdateMany }),
        roleplaySession: expect.objectContaining({ create: m.sessionCreate }),
      }),
    }));
    expect(m.sessionCreate).toHaveBeenCalledTimes(1);
  });

  it('does not create duplicate retries when another request has already claimed the transition', async () => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({
      ...ASSIGNED_SESSION,
      status: 'EVALUATED',
      qaScore: { totalScore: 60, criticalError: false },
    });
    m.advanceApplication.mockResolvedValueOnce({ success: true, data: { advanced: false } });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.accessUpsert).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('does not bind a cookie if session creation fails after the retry transition', async () => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({
      ...ASSIGNED_SESSION,
      status: 'EVALUATED',
      qaScore: { totalScore: 60, criticalError: false },
    });
    m.sessionCreate.mockRejectedValueOnce(new Error('test-only database unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await startCandidateRoleplay();
      expect(res.success).toBe(false);
      expect(res.code).toBe('INTERNAL_ERROR');
      expect(m.advanceApplication).toHaveBeenCalledWith(expect.objectContaining({ db: expect.any(Object) }));
      expect(m.cookieSet).not.toHaveBeenCalled();
      expect(m.accessUpsert).not.toHaveBeenCalled();
      expect(JSON.stringify(res)).not.toContain('database unavailable');
    } finally {
      log.mockRestore();
    }
  });

  it('creates a fresh session when retrying a reviewed attempt', async () => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({
      ...ASSIGNED_SESSION,
      id: 'sess-reviewed',
      status: 'FAILED',
    });
    m.sessionCreate.mockResolvedValue({ id: 'sess-retry', status: 'STARTED' });
    m.scenarioCount.mockResolvedValue(1);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recruitmentCandidateId: 5,
        baseAudioUrl: 'https://audio.example/base.mp3',
        status: 'STARTED',
        scenarios: { create: [{ order: 0, title: 'Medical', baseAudioUrl: 'https://audio.example/scenario.mp3', durationLimitSec: 90, scriptPrompt: 'Prompt', expectedKeys: ['name'] }] },
      }),
    }));
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'sess-retry', expect.any(Object));
    expect(m.advanceApplication).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'app-1',
      fromStatuses: ['ROLEPLAY_REVIEW'],
      toStatus: 'ROLEPLAY_PENDING',
      eventType: 'ROLEPLAY_CREATED',
      metadata: { retry: true },
    }));
    expect(m.cookieSet).toHaveBeenCalled();
  });

  it('rejects when no admin-assigned roleplay session exists', async () => {
    m.sessionFindFirst.mockResolvedValue(null);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(res.error).toContain('no tienes un ejercicio de Roleplay asignado');
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.scenarioCreate).not.toHaveBeenCalled();
    expect(m.accessUpsert).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('rejects an assigned session with missing scenario audio', async () => {
    m.sessionFindFirst.mockResolvedValue({
      ...ASSIGNED_SESSION,
      scenarios: [{ ...ASSIGNED_SESSION.scenarios[0], baseAudioUrl: '' }],
    });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.error).toContain('falta asignar el audio base');
    expect(m.accessUpsert).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('does not fabricate a blank roleplay session for a fresh candidate', async () => {
    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.scenarioCreate).not.toHaveBeenCalled();
    expect(m.accessUpsert).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('resumes an existing active session instead of creating a duplicate', async () => {
    m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, id: 'sess-existing', status: 'STARTED' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.scenarioCreate).not.toHaveBeenCalled();
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'sess-existing', expect.any(Object));
    if (res.success) expect(res.data.sessionId).toBe('sess-existing');
  });

  it('promotes a resumable draft session to STARTED', async () => {
    m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, id: 'sess-draft', status: 'DRAFT' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'sess-draft', status: 'DRAFT' },
      data: { status: 'STARTED' },
    });
  });

  it.each(['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'])(
    'does not regress a %s session back to STARTED on resume',
    async (status) => {
      m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, id: 'sess-advanced', status });

      const res = await startCandidateRoleplay();

      expect(res.success).toBe(true);
      expect(m.sessionUpdateMany).not.toHaveBeenCalled();
    }
  );

  it('rejects when a concurrent request advances the draft to a terminal state', async () => {
    m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, id: 'sess-draft', status: 'DRAFT' });
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ id: 'sess-draft', status: 'EVALUATED' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.accessUpsert).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('resumes when a concurrent request already started the same session', async () => {
    m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, id: 'sess-draft', status: 'DRAFT' });
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ id: 'sess-draft', status: 'STARTED' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.accessUpsert).toHaveBeenCalled();
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'sess-draft', expect.any(Object));
  });

  it('advances the application from ROLEPLAY_PENDING to ROLEPLAY_IN_PROGRESS with a guarded transition', async () => {
    m.sessionFindFirst.mockResolvedValue(ASSIGNED_SESSION);
    m.appFindUnique.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_PENDING', version: 4 });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.appUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.appUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: 'app-1', status: 'ROLEPLAY_PENDING', version: 4 },
      data: expect.objectContaining({
        status: 'ROLEPLAY_IN_PROGRESS',
        currentStep: 'ROLEPLAY',
        version: { increment: 1 },
        lastActorId: '5',
      }),
    });
    expect(m.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: 'app-1',
          eventType: 'ROLEPLAY_STARTED',
          fromStatus: 'ROLEPLAY_PENDING',
          toStatus: 'ROLEPLAY_IN_PROGRESS',
        }),
      })
    );
  });

  it('does not touch an application already in ROLEPLAY_IN_PROGRESS (idempotent resume)', async () => {
    m.appFindUnique.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_IN_PROGRESS', version: 5 });
    m.sessionFindFirst.mockResolvedValue({ ...ASSIGNED_SESSION, id: 'sess-existing', status: 'STARTED' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.appUpdateMany).not.toHaveBeenCalled();
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it('rejects Roleplay when the candidate has no persisted application', async () => {
    m.applicationFindFirst.mockResolvedValue(null);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('never returns database exception details when restoring a candidate session', async () => {
    const secret = 'postgresql://private-user:secret@db.internal.invalid/roleplay';
    m.candidateFindUnique.mockRejectedValueOnce(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await startCandidateRoleplay();
      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toBe('No fue posible preparar tu roleplay. Inténtalo nuevamente.');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(m.cookieSet).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('validateInviteToken protects candidate responses from database details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.identity = { role: 'candidate', candidateId: 5, interpreterId: null };
  });

  it('refuses an anonymous invitation before looking up its token', async () => {
    m.identity = null;
    const result = await validateInviteToken({ token: 'some-private-token' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('UNAUTHORIZED');
    expect(m.accessFindFirst).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('does not bind a valid token when the authenticated candidate is not its owner', async () => {
    m.identity = { role: 'candidate', candidateId: 99, interpreterId: null };
    m.accessFindFirst.mockResolvedValueOnce({
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      session: { id: 'session-1', status: 'INVITED', recruitmentCandidateId: 5, interpreterId: null },
    });
    const result = await validateInviteToken({ token: 'token-held-by-other-candidate' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('FORBIDDEN');
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('binds a valid invitation only for its authenticated candidate owner', async () => {
    m.accessFindFirst.mockResolvedValueOnce({
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      session: {
        id: 'session-1',
        status: 'INVITED',
        recruitmentCandidateId: 5,
        interpreterId: 7, // legacy provisional link does not supersede candidate ownership
        baseAudioUrl: 'https://example.test/audio.mp3',
      },
    });
    const result = await validateInviteToken({ token: 'candidate-own-token' });
    expect(result.success).toBe(true);
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'session-1', expect.any(Object));
  });

  it('returns a generic action error and never reflects internal connection strings', async () => {
    const secret = 'postgresql://private-user:secret@db.internal.invalid/roleplay';
    m.accessFindFirst.mockRejectedValueOnce(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await validateInviteToken({ token: 'fictional-private-token' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toContain('No fue posible validar la invitación');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain('fictional-private-token');
      expect(m.cookieSet).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
  it('rejects oversized invite token strings before database access', async () => {
    const result = await validateInviteToken({ token: 'x'.repeat(513) });
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(m.accessFindFirst).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

});
