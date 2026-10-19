import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  actor: null as any,
  session: null as any,
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  qaCreate: vi.fn(),
  candidateUpdate: vi.fn(),
  appFindUnique: vi.fn(),
  appUpdateMany: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () =>
    m.actor ? { user: m.actor, profile: m.actor } : { error: 'Not authorized', code: 'UNAUTHORIZED' },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    recruitmentApplication: { findUnique: m.appFindUnique },
    recruitmentEvent: { create: m.eventCreate },
    interpreter: { findUnique: async () => null },
    userProfile: { findUnique: async () => null },
    $transaction: async (cb: any) =>
      cb({
        roleplaySession: { findUnique: m.sessionFindUnique, update: m.sessionUpdate },
        qAScore: { create: m.qaCreate },
        recruitmentCandidate: { update: m.candidateUpdate },
        recruitmentApplication: { updateMany: m.appUpdateMany },
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

vi.mock('@/app/actions/notifications', () => ({ createNotification: vi.fn() }));

import { evaluateRoleplay } from '@/app/actions/roleplay';

const ADMIN = {
  userId: 'admin-1',
  email: 'admin@example.com',
  role: 'admin',
  interpreterId: null,
  profileId: 'p-9',
};

function makeForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('sessionId', 'sess-1');
  fd.set('protocolScore', '80');
  fd.set('interpretationScore', '85');
  fd.set('languageScore', '90');
  fd.set('serviceScore', '80');
  fd.set('technicalScore', '85');
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe('evaluateRoleplay (application pipeline advancement)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = ADMIN;
    m.session = {
      id: 'sess-1',
      qaScoreId: null,
      recordedAudioUrl: 'https://x/response.webm',
      recruitmentCandidateId: 5,
      interpreterId: null,
    };
    m.sessionFindUnique.mockImplementation(async () => m.session);
    m.sessionUpdate.mockResolvedValue({ id: 'sess-1' });
    m.qaCreate.mockResolvedValue({ id: 'qa-1', totalScore: 84.5 });
    m.candidateUpdate.mockResolvedValue({ id: 5 });
    m.appFindUnique.mockResolvedValue({ id: 'app-5', status: 'ROLEPLAY_REVIEW', version: 6 });
    m.appUpdateMany.mockResolvedValue({ count: 1 });
    m.eventCreate.mockResolvedValue({ id: 'evt-1' });
  });

  it('advances a passing candidate application to INTERVIEW_PENDING', async () => {
    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(true);
    expect(m.appFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { candidateId: 5 } })
    );
    expect(m.appUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.appUpdateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 'app-5',
        status: {
          in: ['APPLIED', 'INDUCTION_PENDING', 'ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS', 'ROLEPLAY_REVIEW'],
        },
        version: 6,
      },
      data: expect.objectContaining({
        status: 'INTERVIEW_PENDING',
        currentStep: 'INTERVIEW',
        lastActorId: 'admin-1',
      }),
    });
    expect(m.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: 'app-5',
          eventType: 'ROLEPLAY_PASSED',
          fromStatus: 'ROLEPLAY_REVIEW',
          toStatus: 'INTERVIEW_PENDING',
          actorType: 'admin',
        }),
      })
    );
  });

  it('does not advance the application on a critical error (rejection stays an admin decision)', async () => {
    const res = await evaluateRoleplay(null, makeForm({ criticalError: 'on' }));

    expect(res.success).toBe(true);
    expect(m.candidateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resultRoleplay: 0 } })
    );
    expect(m.appFindUnique).not.toHaveBeenCalled();
    expect(m.appUpdateMany).not.toHaveBeenCalled();
  });

  it('does not advance the application when the score is below the pass threshold', async () => {
    const res = await evaluateRoleplay(
      null,
      makeForm({
        protocolScore: '50',
        interpretationScore: '50',
        languageScore: '50',
        serviceScore: '50',
        technicalScore: '50',
      })
    );

    expect(res.success).toBe(true);
    expect(m.appFindUnique).not.toHaveBeenCalled();
    expect(m.appUpdateMany).not.toHaveBeenCalled();
  });

  it('never advances an application for interpreter-only sessions', async () => {
    m.session = { ...m.session, recruitmentCandidateId: null, interpreterId: 7 };

    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(true);
    expect(m.appFindUnique).not.toHaveBeenCalled();
    expect(m.appUpdateMany).not.toHaveBeenCalled();
  });

  it('skips the event when a concurrent transition already advanced the row (version guard)', async () => {
    m.appUpdateMany.mockResolvedValue({ count: 0 });

    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(true);
    expect(m.appUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it('rejects a session that was already evaluated without touching the application', async () => {
    m.session = { ...m.session, qaScoreId: 'qa-existing' };

    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(false);
    expect(m.appFindUnique).not.toHaveBeenCalled();
  });

  it('requires admin authorization', async () => {
    m.actor = null;

    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(false);
    expect(m.sessionFindUnique).not.toHaveBeenCalled();
  });
});
