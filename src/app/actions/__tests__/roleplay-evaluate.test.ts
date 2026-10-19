import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  actor: null as any,
  session: null as any,
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
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
        roleplaySession: {
          findUnique: m.sessionFindUnique,
          update: m.sessionUpdate,
          updateMany: m.sessionUpdateMany,
        },
        qAScore: { create: m.qaCreate },
        recruitmentCandidate: { update: m.candidateUpdate },
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
  // Dimension scores are 0..10 (canonical scale).
  fd.set('protocolScore', '8');
  fd.set('interpretationScore', '8.5');
  fd.set('languageScore', '9');
  fd.set('serviceScore', '8');
  fd.set('technicalScore', '8.5');
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe('evaluateRoleplay (claim, scoring, application pipeline advancement)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = ADMIN;
    m.session = {
      id: 'sess-1',
      qaScoreId: null,
      recordedAudioUrl: 'https://x/response.webm',
      recruitmentCandidateId: 5,
      interpreterId: null,
      status: 'SUBMITTED',
    };
    m.sessionFindUnique.mockImplementation(async () => m.session);
    m.sessionUpdate.mockResolvedValue({ id: 'sess-1' });
    m.sessionUpdateMany.mockResolvedValue({ count: 1 });
    m.qaCreate.mockResolvedValue({ id: 'qa-1', totalScore: 83.75 });
    m.candidateUpdate.mockResolvedValue({ id: 5 });
    m.appFindUnique.mockResolvedValue({ id: 'app-5', status: 'ROLEPLAY_REVIEW', version: 6 });
    m.appUpdateMany.mockResolvedValue({ count: 1 });
    m.eventCreate.mockResolvedValue({ id: 'evt-1' });
  });

  it('claims the session atomically (SUBMITTED + evaluatorId NULL -> UNDER_REVIEW)', async () => {
    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(true);
    expect(m.sessionUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.sessionUpdateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 'sess-1',
        status: 'SUBMITTED',
        evaluatorId: null,
      },
      data: expect.objectContaining({
        evaluatorId: 'admin-1',
        status: 'UNDER_REVIEW',
      }),
    });
  });

  it('persists the canonical weighted total and dimension scores on QAScore', async () => {
    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(true);
    // 8*0.35 + 8.5*0.40 + 9*0.15 + 8*0.05 + 8.5*0.05 = 8.375 -> 83.75
    expect(m.qaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          protocolScore: 8,
          interpretationScore: 8.5,
          languageScore: 9,
          serviceScore: 8,
          technicalScore: 8.5,
          totalScore: 83.75,
          criticalError: false,
        }),
      })
    );
  });

  it('fails the claim when another evaluator won (no QAScore created)', async () => {
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });

    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(false);
    expect(m.qaCreate).not.toHaveBeenCalled();
    expect(m.appFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a session that was already evaluated without touching the application', async () => {
    m.session = { ...m.session, qaScoreId: 'qa-existing' };

    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(false);
    expect(m.sessionUpdateMany).not.toHaveBeenCalled();
    expect(m.appFindUnique).not.toHaveBeenCalled();
  });

  it('advances a passing candidate application to INTERVIEW_PENDING', async () => {
    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(true);
    expect(m.candidateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resultRoleplay: 84 } })
    );
    expect(m.appFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { candidateId: 5 } })
    );
    expect(m.appUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.appUpdateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 'app-5',
        status: 'ROLEPLAY_REVIEW',
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
        protocolScore: '5',
        interpretationScore: '5',
        languageScore: '5',
        serviceScore: '5',
        technicalScore: '5',
      })
    );

    expect(res.success).toBe(true);
    // 5.0 -> 50.0, below the 70 pass threshold.
    expect(m.qaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalScore: 50 }),
      })
    );
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

  it('rejects out-of-range dimension scores', async () => {
    const res = await evaluateRoleplay(null, makeForm({ protocolScore: '50' }));

    expect(res.success).toBe(false);
    expect(m.sessionFindUnique).not.toHaveBeenCalled();
  });

  it('requires admin authorization', async () => {
    m.actor = null;

    const res = await evaluateRoleplay(null, makeForm());

    expect(res.success).toBe(false);
    expect(m.sessionFindUnique).not.toHaveBeenCalled();
  });
});
