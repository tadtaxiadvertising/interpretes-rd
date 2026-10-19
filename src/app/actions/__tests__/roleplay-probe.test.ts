import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  actor: null as any,
  session: null as any,
  findUnique: vi.fn(),
  update: vi.fn(),
  scenarioCount: vi.fn(),
  scenarioFindFirst: vi.fn(),
  responseFindFirst: vi.fn(),
  responseCreate: vi.fn(),
  responseUpdate: vi.fn(),
  responseCount: vi.fn(),
  accessUpsert: vi.fn(),
  accessCreate: vi.fn(),
  accessUpdateMany: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: m.cookieSet }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/actions', () => ({ validateAction: async () => ({ user: m.actor, profile: m.actor }) }));

const tx = {
  roleplaySession: { findUnique: m.findUnique, update: m.update },
  roleplayScenario: { count: m.scenarioCount, findFirst: m.scenarioFindFirst },
  roleplayResponse: { findFirst: m.responseFindFirst, create: m.responseCreate, update: m.responseUpdate, count: m.responseCount },
  roleplayAccess: { upsert: m.accessUpsert, create: m.accessCreate, updateMany: m.accessUpdateMany },
};

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: m.findUnique, update: m.update },
    roleplayScenario: { count: m.scenarioCount, findFirst: m.scenarioFindFirst },
    roleplayResponse: { findFirst: m.responseFindFirst, create: m.responseCreate, update: m.responseUpdate, count: m.responseCount },
    roleplayAccess: { upsert: m.accessUpsert, create: m.accessCreate, updateMany: m.accessUpdateMany },
    $transaction: async (cb: any) => cb({ ...tx }),
  },
}));

vi.mock('@/lib/roleplay', () => ({
  createSignedUploadUrl: vi.fn(), getBaseAudioPath: vi.fn(), getResponseAudioPath: vi.fn(),
  confirmUpload: vi.fn(), validateAudioFile: vi.fn(),
}));

vi.mock('@/app/actions/notifications', () => ({ createNotification: vi.fn() }));

import { confirmRoleplayResponse } from '@/app/actions/roleplay';

const SESSION = { id: 'sess-cand', recordedAudioUrl: null, interpreterId: null, recruitmentCandidateId: 5, status: 'INVITED', currentScenarioIndex: 0 };

describe('probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findUnique.mockResolvedValue(m.session);
    m.update.mockResolvedValue({ id: 'sess-cand' });
    m.scenarioCount.mockResolvedValue(2);
    m.responseFindFirst.mockResolvedValue(null);
    m.responseCreate.mockResolvedValue({ id: 'resp-1' });
    m.responseUpdate.mockResolvedValue({ id: 'resp-1' });
    m.responseCount.mockResolvedValue(1);
    m.scenarioFindFirst.mockResolvedValue({ id: 'scn-0' });
    m.cookieSet.mockResolvedValue(undefined);
    m.actor = { role: 'interpreter', interpreterId: null, userId: 'u-1', email: 'candidate@example.com' };
    m.session = { ...SESSION };
  });

  it('log session status', async () => {
    console.log('SESSION_STATUS', JSON.stringify(m.session));
    const res = await confirmRoleplayResponse({ sessionId: 'sess-cand', scenarioId: 'scn-0', recordedAudioUrl: 'https://x/first.webm' });
    console.log('RESULT', JSON.stringify(res));
    expect(res.success).toBe(true);
  });
});
