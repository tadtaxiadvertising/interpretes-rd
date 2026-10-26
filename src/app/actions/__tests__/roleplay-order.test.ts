import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  actor: null as any,
  cookieSet: vi.fn(),
  session: null as any,
  findUnique: vi.fn(),
  update: vi.fn(),
  scenarioCount: vi.fn(),
  scenarioFindFirst: vi.fn(),
  scenarioCreate: vi.fn(),
  responseCreate: vi.fn(),
  responseUpdate: vi.fn(),
  responseFindFirst: vi.fn(),
  accessUpsert: vi.fn(),
  accessCreate: vi.fn(),
  roleplayResponseCount: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'roleplay_session' ? { value: 'sess-cand' } : undefined),
    set: m.cookieSet,
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () => ({ user: m.actor, profile: m.actor }),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: m.findUnique, update: m.update },
    roleplayScenario: { count: m.scenarioCount, findFirst: m.scenarioFindFirst, create: m.scenarioCreate },
    roleplayResponse: { create: m.responseCreate, update: m.responseUpdate, findFirst: m.responseFindFirst },
    roleplayAccess: { upsert: m.accessUpsert, create: m.accessCreate, updateMany: m.accessUpdateMany },
    $transaction: async (cb: any) => cb({
      roleplaySession: { findUnique: m.findUnique, update: m.update },
      roleplayScenario: { count: m.scenarioCount, findFirst: m.scenarioFindFirst, create: m.scenarioCreate },
      roleplayResponse: { count: m.roleplayResponseCount, create: m.responseCreate, update: m.responseUpdate, findFirst: m.responseFindFirst },
      roleplayAccess: { upsert: m.accessUpsert, create: m.accessCreate, updateMany: m.accessUpdateMany },
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

import { submitRoleplayResponse, confirmRoleplayResponse } from '@/app/actions/roleplay';

const CANDIDATE = {
  id: 'sess-cand',
  recordedAudioUrl: null,
  interpreterId: null,
  recruitmentCandidateId: 5,
  status: 'INVITED',
  currentScenarioIndex: 0,
};

const INTERPRETER = {
  id: 'sess-int',
  recordedAudioUrl: null,
  interpreterId: 7,
  recruitmentCandidateId: null,
  status: 'INVITED',
  currentScenarioIndex: 0,
};

const SCENARIO_0 = { id: 'scn-0', order: 0, sessionId: 'sess-cand' };
const SCENARIO_1 = { id: 'scn-1', order: 1, sessionId: 'sess-cand' };

/**
 * Candidate roleplay scenarios are sequential. A client that supplies a
 * scenarioId must target the one expected at the session's current index;
 * supplying a future scenario (or letting the client advance by hand) would
 * allow skipping steps in the same session.
 */
describe('roleplay: no scenario skipping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.session = { ...CANDIDATE };
    m.findUnique.mockResolvedValue(m.session);
    m.update.mockResolvedValue({ id: 'sess-cand' });
    m.scenarioCount.mockResolvedValue(2);
    m.responseCreate.mockResolvedValue({ id: 'resp-1' });
    m.responseUpdate.mockResolvedValue({ id: 'resp-1' });
    m.responseFindFirst.mockResolvedValue(null);
    m.accessUpsert.mockResolvedValue({ id: 'acc-1' });
    m.scenarioFindFirst.mockResolvedValue({ id: 'scn-0' });
    m.cookieSet.mockResolvedValue(undefined);
    m.actor = { role: 'interpreter', interpreterId: null, userId: 'u-1', email: 'candidate@example.com' };
  });

  // --- submitRoleplayResponse -------------------------------------------

  it('submitRoleplayResponse derives the scenario from the persisted index when omitted', async () => {
    m.session.currentScenarioIndex = 1;

    const res = await submitRoleplayResponse({ sessionId: 'sess-cand' });

    expect(res.success).toBe(true);
    expect(res.data.scenarioId).toBe('scenario_1');
  });

  it('submitRoleplayResponse rejects a candidate that targets a future scenario (skip)', async () => {
    m.session.currentScenarioIndex = 0;

    const res = await submitRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scenario_1' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Escenario no disponible');
  });

  it('submitRoleplayResponse allows the current scenario when explicitly given', async () => {
    m.session.currentScenarioIndex = 0;

    const res = await submitRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scenario_0' });

    expect(res.success).toBe(true);
  });

  // --- confirmRoleplayResponse ------------------------------------------

  it('confirmRoleplayResponse rejects a candidate that supplies a future scenario', async () => {
    // Supplied scenario id maps to a scenario at order 1.
    m.scenarioFindFirst
      .mockImplementation(async (args: { where: { id?: string; order?: number } }) => {
        if (args.where.order !== undefined) {
          return args.where.order === 0 ? SCENARIO_0 : SCENARIO_1;
        }
        return SCENARIO_1;
      });

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-cand',
      scenarioId: 'scn-1',
      recordedAudioUrl: 'https://x/second.webm',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Unauthorized');
  });

  it('confirmRoleplayResponse accepts a candidate that confirms the next expected scenario', async () => {
    // Belongs check resolves the supplied id; the sequential check resolves the
    // scenario expected at the current index (0). Both must resolve to scn-0.
    m.scenarioFindFirst
      .mockImplementation(async (args: { where: { id?: string; order?: number } }) => {
        if (args.where.order !== undefined) {
          return args.where.order === 0 ? SCENARIO_0 : SCENARIO_1;
        }
        return args.where.id === 'scn-0' ? SCENARIO_0 : (args.where.id === 'scn-1' ? SCENARIO_1 : null);
      });

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-cand',
      scenarioId: 'scn-0',
      recordedAudioUrl: 'https://x/first.webm',
    });
    expect(res.success).toBe(true);
    expect(m.update).toHaveBeenCalledTimes(1);
  });
  it('treats a retry of the same confirmed audio as idempotent after the index advances', async () => {
    m.session.currentScenarioIndex = 1;
    m.scenarioFindFirst.mockImplementation(async (args: { where: { id?: string; order?: number } }) => {
      if (args.where.order !== undefined) return SCENARIO_1;
      return args.where.id === 'scn-0' ? SCENARIO_0 : null;
    });
    m.responseFindFirst.mockResolvedValue({
      id: 'resp-1',
      sourceAudioUrl: 'https://x/first.webm',
    });

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-cand',
      scenarioId: 'scn-0',
      recordedAudioUrl: 'https://x/first.webm',
    });

    expect(res.success).toBe(true);
    expect(m.responseCreate).not.toHaveBeenCalled();
    expect(m.responseUpdate).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('refuses to replace a confirmed response with different audio', async () => {
    m.responseFindFirst.mockResolvedValue({
      id: 'resp-1',
      sourceAudioUrl: 'https://x/original.webm',
    });

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-cand',
      scenarioId: 'scn-0',
      recordedAudioUrl: 'https://x/replacement.webm',
    });

    expect(res.success).toBe(false);
    expect(m.responseCreate).not.toHaveBeenCalled();
    expect(m.responseUpdate).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });


  it('confirmRoleplayResponse forbids a candidate from re-confirming a skipped scenario once submitted', async () => {
    m.session.status = 'SUBMITTED';
    m.scenarioFindFirst
      .mockImplementation(async (args: { where: { id?: string; order?: number } }) => {
        if (args.where.order !== undefined) {
          return args.where.order === 0 ? SCENARIO_0 : SCENARIO_1;
        }
        return args.where.id === 'scn-0' ? SCENARIO_0 : (args.where.id === 'scn-1' ? SCENARIO_1 : null);
      });

    const res = await confirmRoleplayResponse({
      sessionId: 'sess-cand',
      scenarioId: 'scn-0',
      recordedAudioUrl: 'https://x/again.webm',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Session not available');
  });
});
