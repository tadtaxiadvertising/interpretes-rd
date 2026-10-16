import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  cookie: null as string | null,
  actor: { interpreterId: null as number | null } as any,
  session: null as any,
  findUnique: vi.fn(),
  update: vi.fn(),
  scenarioCount: vi.fn(),
  responseFindFirst: vi.fn(),
  responseCreate: vi.fn(),
  responseUpdate: vi.fn(),
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
        roleplayScenario: { count: m.scenarioCount },
        roleplayResponse: {
          findFirst: m.responseFindFirst,
          create: m.responseCreate,
          update: m.responseUpdate,
        },
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

import { confirmRoleplayResponse } from '@/app/actions/roleplay';

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
    m.responseFindFirst.mockResolvedValue(null);
    m.responseCreate.mockResolvedValue({ id: 'resp-1' });
    m.responseUpdate.mockResolvedValue({ id: 'resp-1' });
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

    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scn-1', recordedAudioUrl: 'https://x/a.webm' });

    expect(res.success).toBe(true);
    expect(m.responseCreate).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledTimes(1);
  });
});
