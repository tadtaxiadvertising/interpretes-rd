import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  identity: null as any,
  actor: null as any,
  session: null as any,
  scenario: null as any,
  response: null as any,
  scenarios: [] as any[],
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  scenarioFindFirst: vi.fn(),
  scenarioFindMany: vi.fn(),
  responseFindFirst: vi.fn(),
  responseUpdate: vi.fn(),
  accessUpdateMany: vi.fn(),
  advanceApplication: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => ({ value: 'sess-1' }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () => ({ user: m.actor, profile: m.actor }),
}));
vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => m.identity,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      roleplaySession: {
        findUnique: m.sessionFindUnique,
        update: m.sessionUpdate,
        updateMany: m.sessionUpdateMany,
      },
      roleplayScenario: {
        findFirst: m.scenarioFindFirst,
        findMany: m.scenarioFindMany,
      },
      roleplayResponse: {
        findFirst: m.responseFindFirst,
        update: m.responseUpdate,
      },
      roleplayAccess: { updateMany: m.accessUpdateMany },
    }),
  },
}));
vi.mock('@/services/recruitment/transitions', () => ({
  advanceApplication: m.advanceApplication,
}));

import { saveSelfAssessment, submitRoleplaySession } from '@/app/actions/roleplay';

const SCORES = {
  protocol: 8,
  interpretation: 9,
  language: 8,
  service: 9,
  technical: 8,
};

describe('Roleplay required stages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = { role: 'candidate', userId: 'candidate-user' };
    m.identity = { role: 'candidate', candidateId: 5, interpreterId: null };
    m.session = {
      id: 'sess-1',
      interpreterId: null,
      recruitmentCandidateId: 5,
      status: 'IN_PROGRESS',
      currentScenarioIndex: 0,
      evaluatorId: null,
      qaScoreId: null,
    };
    m.scenario = { id: 'scenario-1', order: 0 };
    m.response = { id: 'response-1', sourceAudioUrl: 'https://audio.example/response.webm' };
    m.scenarios = [];
    m.sessionFindUnique.mockImplementation(async () => m.session);
    m.sessionUpdate.mockResolvedValue({ id: 'sess-1' });
    m.sessionUpdateMany.mockResolvedValue({ count: 1 });
    m.scenarioFindFirst.mockImplementation(async () => m.scenario);
    m.scenarioFindMany.mockImplementation(async () => m.scenarios);
    m.responseFindFirst.mockImplementation(async () => m.response);
    m.responseUpdate.mockResolvedValue({ id: 'response-1' });
    m.accessUpdateMany.mockResolvedValue({ count: 1 });
    m.advanceApplication.mockResolvedValue({ success: true });
  });

  it('does not allow self-assessment before a confirmed recording exists', async () => {
    m.response = null;

    const result = await saveSelfAssessment({
      sessionId: 'sess-1',
      scenarioId: 'scenario-1',
      scores: SCORES,
      criticalError: false,
    });

    expect(result.success).toBe(false);
    expect(m.responseUpdate).not.toHaveBeenCalled();
    expect(m.sessionUpdate).not.toHaveBeenCalled();
  });
  it('rejects a response row that has no confirmed audio URL', async () => {
    m.response = { id: 'response-1', sourceAudioUrl: null };

    const result = await saveSelfAssessment({
      sessionId: 'sess-1',
      scenarioId: 'scenario-1',
      scores: SCORES,
      criticalError: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Confirm your recording');
    expect(m.responseUpdate).not.toHaveBeenCalled();
  });

  it('persists self-assessment before advancing the scenario cursor', async () => {
    const result = await saveSelfAssessment({
      sessionId: 'sess-1',
      scenarioId: 'scenario-1',
      scores: SCORES,
      criticalError: false,
      notes: 'Reviewed',
    });

    expect(result.success).toBe(true);
    expect(m.responseUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'response-1' },
      data: expect.objectContaining({
        selfScore: { ...SCORES, criticalError: false },
        selfNotes: 'Reviewed',
      }),
    }));
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sess-1',
        status: { in: ['STARTED', 'IN_PROGRESS'] },
        currentScenarioIndex: 0,
      },
      data: { currentScenarioIndex: 1, status: 'IN_PROGRESS' },
    });
  });
  it('repairs a legacy submitted session only while QA has not claimed it', async () => {
    m.session = {
      ...m.session,
      status: 'SUBMITTED',
      currentScenarioIndex: 1,
      evaluatorId: null,
      qaScoreId: null,
    };

    const result = await saveSelfAssessment({
      sessionId: 'sess-1',
      scenarioId: 'scenario-1',
      scores: SCORES,
      criticalError: false,
    });

    expect(result.success).toBe(true);
    expect(m.responseUpdate).toHaveBeenCalledTimes(1);
    expect(m.sessionUpdate).not.toHaveBeenCalled();
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sess-1',
        status: 'SUBMITTED',
        evaluatorId: null,
        qaScoreId: null,
        currentScenarioIndex: 1,
      },
      data: { updatedAt: expect.any(Date) },
    });
  });
  it('does not allow changing a legacy self-assessment that was already saved', async () => {
    m.session = {
      ...m.session,
      status: 'SUBMITTED',
      currentScenarioIndex: 1,
      evaluatorId: null,
      qaScoreId: null,
    };
    m.response = { id: 'response-1', sourceAudioUrl: 'https://audio.example/response.webm', selfScore: { ...SCORES, criticalError: false } };

    const result = await saveSelfAssessment({
      sessionId: 'sess-1',
      scenarioId: 'scenario-1',
      scores: SCORES,
      criticalError: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already been submitted');
    expect(m.responseUpdate).not.toHaveBeenCalled();
  });
  it('repairs legacy scores that do not match the current five-dimension rubric', async () => {
    m.session = {
      ...m.session,
      status: 'SUBMITTED',
      currentScenarioIndex: 1,
      evaluatorId: null,
      qaScoreId: null,
    };
    m.response = { id: 'response-1', sourceAudioUrl: 'https://audio.example/response.webm', selfScore: { fluency: 8, pronunciation: 7 } };

    const result = await saveSelfAssessment({
      sessionId: 'sess-1',
      scenarioId: 'scenario-1',
      scores: SCORES,
      criticalError: false,
    });

    expect(result.success).toBe(true);
    expect(m.responseUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale scenario cursor without writing or changing an assessment', async () => {
    m.sessionUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await saveSelfAssessment({
      sessionId: 'sess-1',
      scenarioId: 'scenario-1',
      scores: SCORES,
      criticalError: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Session not available for self-assessment');
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sess-1',
        status: { in: ['STARTED', 'IN_PROGRESS'] },
        currentScenarioIndex: 0,
      },
      data: { currentScenarioIndex: 1, status: 'IN_PROGRESS' },
    });
    expect(m.responseUpdate).not.toHaveBeenCalled();
  });

  it('never repairs a submitted attempt after QA claimed it concurrently', async () => {
    m.session = { ...m.session, status: 'SUBMITTED', currentScenarioIndex: 1 };
    m.sessionUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await saveSelfAssessment({
      sessionId: 'sess-1',
      scenarioId: 'scenario-1',
      scores: SCORES,
      criticalError: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Session not available for self-assessment');
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'sess-1',
        status: 'SUBMITTED',
        evaluatorId: null,
        qaScoreId: null,
        currentScenarioIndex: 1,
      },
      data: { updatedAt: expect.any(Date) },
    });
    expect(m.responseUpdate).not.toHaveBeenCalled();
  });

  it('rejects final submission while any scenario lacks a self-assessment', async () => {
    m.identity = { role: 'interpreter', candidateId: null, interpreterId: 7 };
    m.session = { ...m.session, recruitmentCandidateId: null, interpreterId: 7, currentScenarioIndex: 1 };
    m.scenarios = [{ order: 0, responses: [{ sourceAudioUrl: 'https://audio.example/response.webm', selfScore: null }] }];

    const result = await submitRoleplaySession({ sessionId: 'sess-1' });

    expect(result.success).toBe(false);
    expect(m.sessionUpdateMany).not.toHaveBeenCalled();
  });

  it('redacts database failures during final submission instead of returning a false conflict', async () => {
    const secret = 'postgresql://private:password@db.internal.invalid/submission';
    m.sessionFindUnique.mockRejectedValueOnce(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitRoleplaySession({ sessionId: 'sess-1' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toContain('No fue posible enviar el roleplay');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(m.sessionUpdateMany).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('submits only after every scenario has a complete self-assessment', async () => {
    m.identity = { role: 'interpreter', candidateId: null, interpreterId: 7 };
    m.session = { ...m.session, recruitmentCandidateId: null, interpreterId: 7, currentScenarioIndex: 1 };
    m.scenarios = [{
      order: 0,
      responses: [{ sourceAudioUrl: 'https://audio.example/response.webm', selfScore: { ...SCORES, criticalError: false } }],
    }];

    const result = await submitRoleplaySession({ sessionId: 'sess-1' });

    expect(result.success).toBe(true);
    expect(m.sessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'sess-1',
        status: { in: ['STARTED', 'IN_PROGRESS'] },
        currentScenarioIndex: 1,
      },
      data: expect.objectContaining({ status: 'SUBMITTED' }),
    }));
  });
  it('advances a candidate application only after every assessment and final submit', async () => {
    m.session = { ...m.session, currentScenarioIndex: 1 };
    m.scenarios = [{
      order: 0,
      responses: [{ sourceAudioUrl: 'https://audio.example/response.webm', selfScore: { ...SCORES, criticalError: false } }],
    }];

    const result = await submitRoleplaySession({ sessionId: 'sess-1' });

    expect(result.success).toBe(true);
    expect(m.sessionUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.accessUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.advanceApplication).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 5,
      toStatus: 'ROLEPLAY_REVIEW',
      toStep: 'ROLEPLAY_REVIEW',
      eventType: 'ROLEPLAY_SUBMITTED',
    }));
  });
});
