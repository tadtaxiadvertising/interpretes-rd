import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: null as null | {
    id: string;
    interpreterId: number | null;
    recruitmentCandidateId: number | null;
    status: string;
    currentScenarioIndex: number;
    access?: { validatedAt: Date | null; usedAt: Date | null } | null;
  },
  scenario: { id: 'scenario-1' } as { id: string } | null,
  response: null as { id: string } | null,
  actor: { role: 'candidate', candidateId: 5, interpreterId: null } as {
    role: 'candidate' | 'interpreter';
    candidateId: number | null;
    interpreterId: number | null;
  },
  limit: { success: true, remaining: 9, resetAt: 0 },
  findSession: vi.fn(),
  findScenario: vi.fn(),
  findResponse: vi.fn(),
  createSignedUpload: vi.fn(),
  validateMetadata: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => name === 'roleplay_session' ? { value: 'session-1' } : undefined }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () => ({ user: mocks.actor, profile: mocks.actor }),
}));
vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => mocks.actor,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: mocks.findSession },
    roleplayScenario: { findFirst: mocks.findScenario },
    roleplayResponse: { findUnique: mocks.findResponse },
  },
}));
vi.mock('@/lib/roleplay', () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedResponseUploadUrl: mocks.createSignedUpload,
  getBaseAudioPath: vi.fn(),
  getResponseAudioPath: vi.fn(),
  confirmUpload: vi.fn(),
  validateAudioMetadata: mocks.validateMetadata,
}));
vi.mock('./notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/roleplay/scoring', () => ({ calculateRoleplayScore: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  RATE_LIMITS: { audioUpload: { maxRequests: 10, windowMs: 60_000, keyPrefix: 'audio' } },
}));
vi.mock('@/services/recruitment/transitions', () => ({ advanceApplication: vi.fn() }));
vi.mock('@/lib/roleplay-audio-conversion', () => ({ queueMp3Conversion: vi.fn() }));

import { createRoleplayResponseUpload } from '@/app/actions/roleplay';

describe('createRoleplayResponseUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = {
      id: 'session-1',
      interpreterId: null,
      recruitmentCandidateId: 5,
      status: 'IN_PROGRESS',
      currentScenarioIndex: 2,
      access: { validatedAt: new Date(), usedAt: null },
    };
    mocks.scenario = { id: 'scenario-1' };
    mocks.response = null;
    mocks.actor = { role: 'candidate', candidateId: 5, interpreterId: null };
    mocks.limit = { success: true, remaining: 9, resetAt: 0 };
    mocks.findSession.mockImplementation(async () => mocks.session);
    mocks.findScenario.mockImplementation(async () => mocks.scenario);
    mocks.findResponse.mockImplementation(async () => mocks.response);
    mocks.validateMetadata.mockReturnValue({ valid: true, extension: 'webm' });
    mocks.rateLimit.mockImplementation(() => mocks.limit);
    mocks.createSignedUpload.mockResolvedValue({
      token: 'temporary-upload-token',
      path: 'responses/session-1/scenario-1/00000000-0000-4000-8000-000000000001.webm',
      expiresIn: 3600,
    });
  });

  it('authorizes a signed upload for the owning candidate and current scenario', async () => {
    const result = await createRoleplayResponseUpload({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      mimeType: 'audio/webm',
      size: 1024,
    });

    expect(result).toMatchObject({ success: true, data: { token: 'temporary-upload-token' } });
    expect(mocks.findScenario).toHaveBeenCalledWith({
      where: { id: 'scenario-1', sessionId: 'session-1', order: 2 },
      select: { id: true },
    });
    expect(mocks.createSignedUpload).toHaveBeenCalledWith('session-1', 'scenario-1', 'audio/webm');
  });

  it.each([
    { validatedAt: null, usedAt: null },
    { validatedAt: new Date(), usedAt: new Date() },
  ])('rejects an invalid or consumed candidate invitation before issuing a Storage upload token', async (access) => {
    mocks.session = { ...mocks.session!, access };
    const result = await createRoleplayResponseUpload({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      mimeType: 'audio/webm',
      size: 1024,
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe('FORBIDDEN');
    expect(mocks.createSignedUpload).not.toHaveBeenCalled();
    expect(mocks.findScenario).not.toHaveBeenCalled();
  });

  it('does not require invitation data for an interpreter-owned session', async () => {
    mocks.actor = { role: 'interpreter', candidateId: null, interpreterId: 7 };
    mocks.session = {
      ...mocks.session!,
      interpreterId: 7,
      recruitmentCandidateId: null,
      access: null,
    };
    const result = await createRoleplayResponseUpload({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      mimeType: 'audio/webm',
      size: 1024,
    });
    expect(result.success).toBe(true);
    expect(mocks.createSignedUpload).toHaveBeenCalledOnce();
  });

  it('rejects a session owned by another candidate', async () => {
    mocks.session = { ...mocks.session!, recruitmentCandidateId: 99 };

    const result = await createRoleplayResponseUpload({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      mimeType: 'audio/webm',
      size: 1024,
    });

    expect(result.success).toBe(false);
    expect(mocks.createSignedUpload).not.toHaveBeenCalled();
  });

  it('rejects a scenario that is not the current step', async () => {
    mocks.scenario = null;

    const result = await createRoleplayResponseUpload({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      mimeType: 'audio/webm',
      size: 1024,
    });

    expect(result.success).toBe(false);
    expect(mocks.createSignedUpload).not.toHaveBeenCalled();
  });

  it('rejects an already confirmed response', async () => {
    mocks.response = { id: 'response-1' };

    const result = await createRoleplayResponseUpload({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      mimeType: 'audio/webm',
      size: 1024,
    });

    expect(result.success).toBe(false);
    expect(mocks.createSignedUpload).not.toHaveBeenCalled();
  });

  it('rejects upload attempts after the per-session rate limit is reached', async () => {
    mocks.limit = { success: false, remaining: 0, resetAt: 0 };

    const result = await createRoleplayResponseUpload({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      mimeType: 'audio/webm',
      size: 1024,
    });

    expect(result.success).toBe(false);
    expect(mocks.createSignedUpload).not.toHaveBeenCalled();
  });

  it('rejects invalid audio metadata before querying the session', async () => {
    mocks.validateMetadata.mockReturnValue({ valid: false, error: 'File exceeds 15 MB limit' });

    const result = await createRoleplayResponseUpload({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      mimeType: 'audio/webm',
      size: 16 * 1024 * 1024,
    });

    expect(result.success).toBe(false);
    expect(mocks.findSession).not.toHaveBeenCalled();
    expect(mocks.createSignedUpload).not.toHaveBeenCalled();
  });
});
