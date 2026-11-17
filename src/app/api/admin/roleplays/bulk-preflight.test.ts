import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { blockingAssignmentStatuses } from '@/lib/roleplay-assignment-ownership';

const mocks = vi.hoisted(() => ({
  activeInterpreters: vi.fn(),
  existingSessions: vi.fn(),
  transaction: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findMany: mocks.activeInterpreters },
    roleplaySession: { findMany: mocks.existingSessions },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mocks.upload,
        remove: mocks.remove,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.example/roleplay-audio/${path}` },
        }),
      })),
    },
  })),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(async () => ({ user: { userId: 'admin-ci' } })),
}));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: vi.fn() }));

import { POST } from './route';

function bulkRequest(count = 1): NextRequest {
  const form = new FormData();
  form.set('participantType', 'all-active-interpreters');
  form.set('scenarios', JSON.stringify(Array.from({ length: count }, (_, index) => ({
    title: `Consulta de prueba ${index + 1}`,
    durationLimitSec: 120,
    scriptPrompt: '',
  }))));
  for (let index = 0; index < count; index++) {
    form.append('scenarioAudios', new File(['ID3'], `consulta-${index}.mp3`, { type: 'audio/mpeg' }));
  }
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
    mocks.remove.mockResolvedValue({ error: null });
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

  it('reclaims successful uploads when the next audio fails before any publishing transaction', async () => {
    mocks.existingSessions.mockResolvedValue([]);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    mocks.upload.mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'Temporary storage failure' } });

    const response = await POST(bulkRequest(2));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'No fue posible subir un audio. Revisa el archivo e inténtalo de nuevo.',
    });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.remove).toHaveBeenCalledOnce();
    const removedPaths = mocks.remove.mock.calls[0][0] as string[];
    expect(removedPaths).toHaveLength(1);
    expect(removedPaths[0]).toMatch(/^base\/bulk-[a-f0-9-]+\/0\.mp3$/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('never deletes uploaded audio when a publishing transaction may have committed', async () => {
    mocks.existingSessions.mockResolvedValue([]);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    mocks.upload.mockResolvedValueOnce({ error: null });
    mocks.transaction.mockRejectedValueOnce(new Error('Transaction acknowledgment lost'));

    const response = await POST(bulkRequest());
    expect(response.status).toBe(500);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('preserves the upload error response if pre-commit cleanup itself fails', async () => {
    mocks.existingSessions.mockResolvedValue([]);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    mocks.upload.mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'Upload rejected' } });
    mocks.remove.mockRejectedValueOnce(new Error('Cleanup unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(bulkRequest(2));
    expect(response.status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('Roleplay pre-commit audio cleanup failed');
    log.mockRestore();
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
