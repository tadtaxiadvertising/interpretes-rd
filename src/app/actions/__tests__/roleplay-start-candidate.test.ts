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
    roleplayAccess: { upsert: m.accessUpsert },
    recruitmentApplication: { findUnique: m.appFindUnique, findFirst: m.applicationFindFirst },
    $transaction: async (cb: any) =>
      cb({
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

import { startCandidateRoleplay } from '@/app/actions/roleplay';

const CANDIDATE_ACTOR = {
  provider: 'supabase',
  userId: 'u-1',
  email: 'Candidate@Example.com',
  role: 'interpreter',
  interpreterId: null,
  profileId: 'p-1',
};

describe('startCandidateRoleplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = CANDIDATE_ACTOR;
    m.identity = {
      userId: 'u-1',
      email: 'candidate@example.com',
      role: 'interpreter',
      eligibility: { needsOnboarding: false },
    };
    m.candidateFindUnique.mockResolvedValue({ id: 5 });
    m.advanceApplication.mockResolvedValue({ success: true });
    m.applicationFindFirst.mockResolvedValue(null);
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

  it('rejects when the account has no matching application (normalized email)', async () => {
    m.candidateFindUnique.mockResolvedValue(null);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(m.candidateFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'candidate@example.com' } })
    );
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('blocks roleplay start until server-resolved onboarding is complete', async () => {
    m.identity.eligibility.needsOnboarding = true;

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.candidateFindUnique).not.toHaveBeenCalled();
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.accessUpsert).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it.each(['REJECTED', 'WITHDRAWN', 'EXPIRED', 'HIRED', 'INTERVIEW_PENDING'])(
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
    m.sessionFindFirst.mockResolvedValue({ id: 'sess-reviewing', status: 'UNDER_REVIEW' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.advanceApplication).not.toHaveBeenCalled();
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('creates a fresh session when retrying a reviewed attempt', async () => {
    m.applicationFindFirst.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW' });
    m.sessionFindFirst.mockResolvedValue({
      id: 'sess-reviewed', status: 'FAILED', baseAudioUrl: 'base.mp3',
      scenarios: [{ order: 0, title: 'Medical', baseAudioUrl: 'scenario.mp3', durationLimitSec: 90, scriptPrompt: 'Prompt', expectedKeys: ['name'] }],
    });
    m.sessionCreate.mockResolvedValue({ id: 'sess-retry', status: 'STARTED' });
    m.scenarioCount.mockResolvedValue(1);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recruitmentCandidateId: 5,
        baseAudioUrl: 'base.mp3',
        status: 'STARTED',
        scenarios: { create: [{ order: 0, title: 'Medical', baseAudioUrl: 'scenario.mp3', durationLimitSec: 90, scriptPrompt: 'Prompt', expectedKeys: ['name'] }] },
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

  it('creates a session, scenario, access row and cookie for a fresh candidate', async () => {
    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.sessionCreate).toHaveBeenCalledTimes(1);
    expect(m.scenarioCreate).toHaveBeenCalledTimes(1);
    expect(m.accessUpsert).toHaveBeenCalledTimes(1);
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'sess-new', expect.any(Object));
    if (res.success) expect(res.data.sessionId).toBe('sess-new');
  });

  it('resumes an existing active session instead of creating a duplicate', async () => {
    m.sessionFindFirst.mockResolvedValue({ id: 'sess-existing', status: 'STARTED' });
    m.scenarioCount.mockResolvedValue(1);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.sessionCreate).not.toHaveBeenCalled();
    expect(m.scenarioCreate).not.toHaveBeenCalled();
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'sess-existing', expect.any(Object));
    if (res.success) expect(res.data.sessionId).toBe('sess-existing');
  });

  it('promotes a resumable draft session to STARTED', async () => {
    m.sessionFindFirst.mockResolvedValue({ id: 'sess-draft', status: 'DRAFT' });
    m.scenarioCount.mockResolvedValue(1);

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
      m.sessionFindFirst.mockResolvedValue({ id: 'sess-advanced', status });
      m.scenarioCount.mockResolvedValue(1);

      const res = await startCandidateRoleplay();

      expect(res.success).toBe(true);
      expect(m.sessionUpdateMany).not.toHaveBeenCalled();
    }
  );

  it('rejects when a concurrent request advances the draft to a terminal state', async () => {
    m.sessionFindFirst.mockResolvedValue({ id: 'sess-draft', status: 'DRAFT' });
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ id: 'sess-draft', status: 'EVALUATED' });

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.accessUpsert).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it('resumes when a concurrent request already started the same session', async () => {
    m.sessionFindFirst.mockResolvedValue({ id: 'sess-draft', status: 'DRAFT' });
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ id: 'sess-draft', status: 'STARTED' });
    m.scenarioCount.mockResolvedValue(1);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.accessUpsert).toHaveBeenCalled();
    expect(m.cookieSet).toHaveBeenCalledWith('roleplay_session', 'sess-draft', expect.any(Object));
  });

  it('advances the application from ROLEPLAY_PENDING to ROLEPLAY_IN_PROGRESS with a guarded transition', async () => {
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
    m.sessionFindFirst.mockResolvedValue({ id: 'sess-existing', status: 'STARTED' });
    m.scenarioCount.mockResolvedValue(1);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.appUpdateMany).not.toHaveBeenCalled();
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it('skips pipeline bookkeeping when the candidate has no application row', async () => {
    m.appFindUnique.mockResolvedValue(null);

    const res = await startCandidateRoleplay();

    expect(res.success).toBe(true);
    expect(m.appUpdateMany).not.toHaveBeenCalled();
  });
});
