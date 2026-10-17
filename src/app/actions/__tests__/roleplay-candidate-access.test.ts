import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  cookie: null as string | null,
  actor: { interpreterId: null as number | null } as any,
  session: null as any,
  findUnique: vi.fn(),
  update: vi.fn(),
  scenarioCount: vi.fn(),
  scenarioFindFirst: vi.fn(),
  responseCount: vi.fn(),
  responseFindFirst: vi.fn(),
  responseCreate: vi.fn(),
  responseUpdate: vi.fn(),
  accessUpdateMany: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'roleplay_session' && m.cookie != null ? { value: m.cookie } : undefined,
    set: () => {},
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () => ({ user: m.actor, profile: m.actor }),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (cb: any) =>
      cb({
        roleplaySession: { findUnique: m.findUnique, update: m.update },
        roleplayScenario: { count: m.scenarioCount, findFirst: m.scenarioFindFirst },
        roleplayResponse: {
          findFirst: m.responseFindFirst,
          create: m.responseCreate,
          update: m.responseUpdate,
          count: m.responseCount,
        },
        roleplayAccess: { updateMany: m.accessUpdateMany },
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

import { confirmRoleplayResponse, saveSelfAssessment } from '@/app/actions/roleplay';

const CANDIDATE_SESSION = {
  id: 'sess-cand',
  recordedAudioUrl: null,
  interpreterId: null,
  recruitmentCandidateId: 5,
  status: 'STARTED',
  currentScenarioIndex: 0,
};

const INTERPRETER_SESSION = {
  id: 'sess-int',
  recordedAudioUrl: null,
  interpreterId: 7,
  recruitmentCandidateId: null,
  status: 'STARTED',
  currentScenarioIndex: 0,
};

describe('confirmRoleplayResponse candidate-access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findUnique.mockImplementation(async () => m.session);
    m.update.mockResolvedValue({ id: 'sess-cand' });
    m.scenarioCount.mockResolvedValue(0);
    m.scenarioFindFirst.mockResolvedValue({ id: 'scn-1' });
    m.responseCount.mockResolvedValue(0);
    m.responseFindFirst.mockResolvedValue(null);
    m.responseCreate.mockResolvedValue({ id: 'resp-1' });
    m.responseUpdate.mockResolvedValue({ id: 'resp-1' });
    m.accessUpdateMany.mockResolvedValue({ count: 1 });
    m.cookie = null;
    m.actor = { interpreterId: null };
  });

  it('rejects a candidate session when the session cookie is missing', async () => {
    m.session = CANDIDATE_SESSION;
    m.cookie = null;

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', recordedAudioUrl: 'https://x/a.webm' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Unauthorized');
    expect(m.update).not.toHaveBeenCalled();
  });

  it('rejects a candidate session when the cookie does not match the session', async () => {
    m.session = CANDIDATE_SESSION;
    m.cookie = 'some-other-session';

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', recordedAudioUrl: 'https://x/a.webm' });

    expect(res.success).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('allows a candidate session when the cookie matches the session id', async () => {
    m.session = CANDIDATE_SESSION;
    m.cookie = 'sess-cand';

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', recordedAudioUrl: 'https://x/a.webm' });

    expect(res.success).toBe(true);
    expect(m.update).toHaveBeenCalledTimes(1);
  });

  it('allows an interpreter session only for its owning interpreter', async () => {
    m.session = INTERPRETER_SESSION;
    m.actor = { interpreterId: 7 };

    const res = await confirmRoleplayResponse({ sessionId: 'sess-int', recordedAudioUrl: 'https://x/a.webm' });

    expect(res.success).toBe(true);
    expect(m.update).toHaveBeenCalledTimes(1);
  });

  it('rejects an interpreter session for a different interpreter', async () => {
    m.session = INTERPRETER_SESSION;
    m.actor = { interpreterId: 999 };

    const res = await confirmRoleplayResponse({ sessionId: 'sess-int', recordedAudioUrl: 'https://x/a.webm' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Unauthorized');
    expect(m.update).not.toHaveBeenCalled();
  });

  it('persists a per-scenario response when a scenario id is supplied', async () => {
    m.session = CANDIDATE_SESSION;
    m.cookie = 'sess-cand';
    m.scenarioCount.mockResolvedValue(1);
    m.responseCount.mockResolvedValue(1);

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-cand',
      scenarioId: 'scn-1',
      recordedAudioUrl: 'https://x/a.webm',
      sourceAudioPath: 'responses/sess-cand/scn-1.webm',
      durationSec: 42,
    });

    expect(res.success).toBe(true);
    expect(m.responseCreate).toHaveBeenCalledTimes(1);
    expect(m.responseCreate.mock.calls[0][0].data.sourceAudioPath).toBe('responses/sess-cand/scn-1.webm');
    expect(m.responseCreate.mock.calls[0][0].data.durationSec).toBe(42);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0][0].data.status).toBe('SUBMITTED');
    expect(m.update.mock.calls[0][0].data.currentScenarioIndex).toBe(1);
  });

  it('rejects a scenario id that belongs to a different session (cross-session write)', async () => {
    m.session = CANDIDATE_SESSION;
    m.cookie = 'sess-cand';
    m.scenarioFindFirst.mockResolvedValue(null);

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scn-foreign', recordedAudioUrl: 'https://x/a.webm' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Unauthorized');
    expect(m.responseCreate).not.toHaveBeenCalled();
    expect(m.responseUpdate).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('accepts a later scenario confirm after a first response was already recorded', async () => {
    m.session = { ...CANDIDATE_SESSION, recordedAudioUrl: 'https://x/first.webm' };
    m.cookie = 'sess-cand';
    m.scenarioCount.mockResolvedValue(2);
    m.responseCount.mockResolvedValue(2);

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scn-2', recordedAudioUrl: 'https://x/second.webm' });

    expect(res.success).toBe(true);
    expect(m.responseCreate).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0][0].data.currentScenarioIndex).toBe(2);
  });

  it('rejects a stray confirm once the session has left the submit window', async () => {
    m.session = { ...CANDIDATE_SESSION, status: 'SUBMITTED', recordedAudioUrl: 'https://x/first.webm' };
    m.cookie = 'sess-cand';

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scn-1', recordedAudioUrl: 'https://x/other.webm' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Session not available');
    expect(m.responseCreate).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('treats a retried confirm of an already-recorded response as an idempotent success', async () => {
    m.session = { ...CANDIDATE_SESSION, status: 'SUBMITTED', recordedAudioUrl: 'https://x/first.webm' };
    m.cookie = 'sess-cand';
    m.responseFindFirst.mockResolvedValue({ id: 'resp-recorded' });

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scn-1', recordedAudioUrl: 'https://x/first.webm' });

    expect(res.success).toBe(true);
    expect(m.responseCreate).not.toHaveBeenCalled();
    expect(m.responseUpdate).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('keeps single-submission semantics for legacy confirms without a scenario id', async () => {
    m.session = { ...CANDIDATE_SESSION, recordedAudioUrl: 'https://x/already.webm' };
    m.cookie = 'sess-cand';

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', recordedAudioUrl: 'https://x/again.webm' });

    expect(res.success).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('consumes the candidate invitation when the final scenario is submitted', async () => {
    m.session = CANDIDATE_SESSION;
    m.cookie = 'sess-cand';
    m.scenarioCount.mockResolvedValue(1);
    m.responseCount.mockResolvedValue(1);

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-cand',
      scenarioId: 'scn-1',
      recordedAudioUrl: 'https://x/a.webm',
    });

    expect(res.success).toBe(true);
    expect(m.update.mock.calls[0][0].data.status).toBe('SUBMITTED');
    expect(m.accessUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.accessUpdateMany.mock.calls[0][0]).toEqual({
      where: { sessionId: 'sess-cand', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('does not consume the invitation on a non-final scenario', async () => {
    m.session = CANDIDATE_SESSION;
    m.cookie = 'sess-cand';
    m.scenarioCount.mockResolvedValue(3);
    m.responseCount.mockResolvedValue(1);

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-cand',
      scenarioId: 'scn-1',
      recordedAudioUrl: 'https://x/a.webm',
    });

    expect(res.success).toBe(true);
    expect(m.update.mock.calls[0][0].data.status).toBeUndefined();
    expect(m.accessUpdateMany).not.toHaveBeenCalled();
  });

  it('does not consume an invitation for interpreter sessions', async () => {
    m.session = INTERPRETER_SESSION;
    m.actor = { interpreterId: 7 };
    m.scenarioCount.mockResolvedValue(1);
    m.responseCount.mockResolvedValue(1);

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-int',
      scenarioId: 'scn-1',
      recordedAudioUrl: 'https://x/a.webm',
    });

    expect(res.success).toBe(true);
    expect(m.update.mock.calls[0][0].data.status).toBe('SUBMITTED');
    expect(m.accessUpdateMany).not.toHaveBeenCalled();
  });

  it('does not consume again when an already-submitted confirm is replayed', async () => {
    m.session = { ...CANDIDATE_SESSION, status: 'SUBMITTED', recordedAudioUrl: 'https://x/first.webm' };
    m.cookie = 'sess-cand';
    m.responseFindFirst.mockResolvedValue({ id: 'resp-recorded' });

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scn-1', recordedAudioUrl: 'https://x/first.webm' });

    expect(res.success).toBe(true);
    expect(m.accessUpdateMany).not.toHaveBeenCalled();
  });
});

describe('saveSelfAssessment gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findUnique.mockImplementation(async () => m.session);
    m.update.mockResolvedValue({ id: 'sess-cand' });
    m.scenarioFindFirst.mockResolvedValue({ id: 'scn-1' });
    m.responseFindFirst.mockResolvedValue({ id: 'resp-1' });
    m.responseUpdate.mockResolvedValue({ id: 'resp-1' });
    m.cookie = null;
    m.actor = { interpreterId: null };
    m.session = CANDIDATE_SESSION;
  });

  it('rejects a candidate session when the session cookie is missing', async () => {
    m.cookie = null;

    const res = await saveSelfAssessment({ sessionId: 'sess-cand', scenarioId: 'scn-1', scores: { fluency: 8 } });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Unauthorized');
    expect(m.responseUpdate).not.toHaveBeenCalled();
  });

  it('rejects a scenario that belongs to a different session', async () => {
    m.cookie = 'sess-cand';
    m.scenarioFindFirst.mockResolvedValue(null);

    const res = await saveSelfAssessment({ sessionId: 'sess-cand', scenarioId: 'scn-foreign', scores: { fluency: 8 } });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Unauthorized');
    expect(m.responseUpdate).not.toHaveBeenCalled();
  });

  it('rejects when no confirmed response exists for the scenario', async () => {
    m.cookie = 'sess-cand';
    m.responseFindFirst.mockResolvedValue(null);

    const res = await saveSelfAssessment({ sessionId: 'sess-cand', scenarioId: 'scn-1', scores: { fluency: 8 } });

    expect(res.success).toBe(false);
    expect(res.error).toContain('No confirmed response');
    expect(m.responseUpdate).not.toHaveBeenCalled();
  });

  it('persists scores and notes for the owning candidate', async () => {
    m.cookie = 'sess-cand';

    const res = await saveSelfAssessment({
      sessionId: 'sess-cand',
      scenarioId: 'scn-1',
      scores: { fluency: 8, pronunciation: 7 },
      notes: 'good pacing',
    });

    expect(res.success).toBe(true);
    expect(m.responseUpdate).toHaveBeenCalledTimes(1);
    expect(m.responseUpdate.mock.calls[0][0].data).toEqual({
      selfScore: { fluency: 8, pronunciation: 7 },
      selfNotes: 'good pacing',
    });
  });

  it('rejects an interpreter session for a different interpreter', async () => {
    m.session = INTERPRETER_SESSION;
    m.actor = { interpreterId: 999 };

    const res = await saveSelfAssessment({ sessionId: 'sess-int', scenarioId: 'scn-1', scores: { fluency: 8 } });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Unauthorized');
    expect(m.responseUpdate).not.toHaveBeenCalled();
  });
});
