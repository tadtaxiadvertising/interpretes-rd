import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  actor: null as any,
  session: null as any,
  findUnique: vi.fn(),
  update: vi.fn(),
  scenarioCount: vi.fn(),
  scenarioFindFirst: vi.fn(),
  responseFindFirst: vi.fn(),
  roleplayCandidateFindUnique: vi.fn(),
}));

const tx = {
  roleplaySession: { findUnique: m.findUnique, update: m.update },
  roleplayScenario: { count: m.scenarioCount, findFirst: m.scenarioFindFirst },
  roleplayResponse: { findFirst: m.responseFindFirst },
  roleplayAccess: { upsert: m.accessUpsert, create: m.accessCreate, updateMany: m.accessUpdateMany },
  roleplayCandidate: { findUnique: m.roleplayCandidateFindUnique },
};

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () => ({ user: m.actor, profile: m.actor }),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: m.findUnique, update: m.update },
    roleplayScenario: { count: m.scenarioCount, findFirst: m.scenarioFindFirst },
    roleplayResponse: { findFirst: m.responseFindFirst },
    roleplayAccess: { upsert: m.accessUpsert, create: m.accessCreate, updateMany: m.accessUpdateMany },
    roleplayCandidate: { findUnique: m.roleplayCandidateFindUnique },
    $transaction: async (cb: any) => cb({ ...tx }),
  },
}));

vi.mock('@/lib/roleplay', () => ({
  createSignedUploadUrl: vi.fn(), getBaseAudioPath: vi.fn(), getResponseAudioPath: vi.fn(),
  confirmUpload: vi.fn(), validateAudioFile: vi.fn(),
}));

vi.mock('@/app/actions/notifications', () => ({ createNotification: vi.fn() }));

import { confirmRoleplayResponse } from '@/app/actions/roleplay';

const SCENARIO_0 = { id: 'scn-0', order: 0 };
const SCENARIO_1 = { id: 'scn-1', order: 1 };

describe('probe re-verify confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findUnique.mockResolvedValue(m.session);
    m.update.mockResolvedValue({ id: 'sess-cand' });
    m.scenarioCount.mockResolvedValue(2);
    m.responseFindFirst.mockResolvedValue(null);
    m.roleplayCandidateFindUnique.mockResolvedValue({ email: 'candidate@example.com' });
    m.session = { id: 'sess-cand', recordedAudioUrl: null, interpreterId: null, recruitmentCandidateId: 5, status: 'INVITED', currentScenarioIndex: 0 };
    m.scenarioFindFirst.mockImplementation(async (args: { where: { id?: string; order?: number } }) => {
      if (args.where.order !== undefined) {
        return args.where.order === 0 ? SCENARIO_0 : SCENARIO_1;
      }
      return args.where.id === 'scn-0' ? SCENARIO_0 : (args.where.id === 'scn-1' ? SCENARIO_1 : null);
    });
  });

  it('accepts next scenario, log what scenarioFindFirst returns', async () => {
    console.log('[probe-status]', JSON.stringify(m.session.status));
    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scn-0', recordedAudioUrl: 'https://x/first.webm' });
    console.log('[result]', JSON.stringify(res));
    expect(res.success).toBe(true);
  });
}
);
