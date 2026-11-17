import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { blockingAssignmentStatuses } from '@/lib/roleplay-assignment-ownership';

const mocks = vi.hoisted(() => ({
  activeInterpreters: vi.fn(),
  existingSessions: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findMany: mocks.activeInterpreters },
    roleplaySession: { findMany: mocks.existingSessions },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(async () => ({ user: { userId: 'admin-ci' } })),
}));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: vi.fn() }));

import { POST } from './route';

function bulkRequest(): NextRequest {
  const form = new FormData();
  form.set('participantType', 'all-active-interpreters');
  form.set('scenarios', JSON.stringify([{
    title: 'Consulta de prueba',
    durationLimitSec: 120,
    scriptPrompt: '',
  }]));
  form.set('scenarioAudios', new File(['ID3'], 'consulta.mp3', { type: 'audio/mpeg' }));
  return {
    headers: new Headers(),
    formData: async () => form,
  } as unknown as NextRequest;
}

describe('bulk roleplay creation: avoid unnecessary storage uploads', () => {
  beforeEach(() => {
    // Keep the authentication mock implementation while clearing call history.
    vi.clearAllMocks();
    mocks.activeInterpreters.mockResolvedValue([{ id: 11 }, { id: 22 }]);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 409 before storage configuration or writes when every active interpreter is blocked', async () => {
    mocks.existingSessions.mockResolvedValue([
      { interpreterId: 11 }, { interpreterId: 22 },
      { interpreterId: 11 }, // Multiple historical sessions must not double count.
    ]);

    const response = await POST(bulkRequest());
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data).toMatchObject({
      success: false,
      skippedCount: 2,
      error: 'All active interpreters already have a draft or existing roleplay session',
    });
    expect(mocks.existingSessions).toHaveBeenCalledWith({
      where: {
        interpreterId: { in: [11, 22] },
        recruitmentCandidateId: null,
        status: { in: blockingAssignmentStatuses(true) },
      },
      select: { interpreterId: true },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not falsely reject the batch when even one interpreter remains eligible', async () => {
    mocks.existingSessions.mockResolvedValue([{ interpreterId: 11 }]);

    const response = await POST(bulkRequest());
    // Once the eligibility preflight passes, missing storage config is the
    // next expected error. No transaction or writes occur in this test.
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Storage is not configured',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not block an active interpreter on a legacy candidate-owned session', async () => {
    // The batch query filters recruitmentCandidateId: null; candidate-owned
    // historical sessions with interpreterId set must be excluded by the DB.
    mocks.existingSessions.mockResolvedValue([]);

    const response = await POST(bulkRequest());
    expect(response.status).toBe(503);
    expect(mocks.existingSessions.mock.calls[0][0].where.recruitmentCandidateId).toBeNull();
  });
});
