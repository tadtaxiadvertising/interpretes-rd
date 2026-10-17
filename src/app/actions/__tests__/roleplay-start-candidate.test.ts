import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  actor: null as any,
  cookieSet: vi.fn(),
  candidateFindUnique: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  scenarioCount: vi.fn(),
  scenarioCreate: vi.fn(),
  accessUpsert: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: m.cookieSet }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () =>
    m.actor ? { user: m.actor, profile: m.actor } : { error: 'Not authenticated', code: 'UNAUTHORIZED' },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    recruitmentCandidate: { findUnique: m.candidateFindUnique },
    roleplaySession: {
      findFirst: m.sessionFindFirst,
      create: m.sessionCreate,
      update: m.sessionUpdate,
    },
    roleplayScenario: { count: m.scenarioCount, create: m.scenarioCreate },
    roleplayAccess: { upsert: m.accessUpsert },
  },
}));

vi.mock('@/lib/roleplay', () => ({
  createSignedUploadUrl: vi.fn(),
  getBaseAudioPath: vi.fn(),
  getResponseAudioPath: vi.fn(),
  confirmUpload: vi.fn(),
  validateAudioFile: vi.fn(),
}));

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
    m.candidateFindUnique.mockResolvedValue({ id: 5 });
    m.sessionFindFirst.mockResolvedValue(null);
    m.sessionCreate.mockResolvedValue({ id: 'sess-new', status: 'STARTED' });
    m.sessionUpdate.mockResolvedValue({ id: 'sess-new' });
    m.scenarioCount.mockResolvedValue(0);
    m.scenarioCreate.mockResolvedValue({ id: 'scn-1' });
    m.accessUpsert.mockResolvedValue({ id: 'acc-1' });
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
    expect(m.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-draft' }, data: { status: 'STARTED' } })
    );
  });

  it.each(['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'])(
    'does not regress a %s session back to STARTED on resume',
    async (status) => {
      m.sessionFindFirst.mockResolvedValue({ id: 'sess-advanced', status });
      m.scenarioCount.mockResolvedValue(1);

      const res = await startCandidateRoleplay();

      expect(res.success).toBe(true);
      expect(m.sessionUpdate).not.toHaveBeenCalled();
    }
  );
});
