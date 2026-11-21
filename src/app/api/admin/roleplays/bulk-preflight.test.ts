import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { blockingAssignmentStatuses } from '@/lib/roleplay-assignment-ownership';

const mocks = vi.hoisted(() => ({
  activeInterpreters: vi.fn(),
  findInterpreter: vi.fn(),
  existingSessions: vi.fn(),
  transaction: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findMany: mocks.activeInterpreters, findUnique: mocks.findInterpreter },
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
  // Use a real Request stream, just like Next.js, so the multipart byte
  // limit is exercised instead of bypassed by a formData-only stub.
  return new Request('http://localhost/api/admin/roleplays', {
    method: 'POST', body: form,
  }) as NextRequest;
}

function singleInterpreterRequest(count = 1): NextRequest {
  const form = new FormData();
  form.set('participantType', 'interpreter');
  form.set('participantId', '11');
  form.set('scenarios', JSON.stringify(Array.from({ length: count }, (_, index) => ({
    title: `Consulta individual ${index + 1}`,
    durationLimitSec: 120,
    scriptPrompt: '',
  }))));
  for (let index = 0; index < count; index++) {
    form.append('scenarioAudios', new File(['ID3'], `individual-${index}.mp3`, { type: 'audio/mpeg' }));
  }
  // Use a real Request stream, just like Next.js, so the multipart byte
  // limit is exercised instead of bypassed by a formData-only stub.
  return new Request('http://localhost/api/admin/roleplays', {
    method: 'POST', body: form,
  }) as NextRequest;
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

  it('rejects oversized declared batches before parsing or touching the database', async () => {
    const req = bulkRequest(25);
    req.headers.set('content-length', String(25 * 15 * 1024 * 1024 + 2 * 1024 * 1024 + 1));
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await res.json()).error).toContain('lote de audio');
    expect(mocks.activeInterpreters).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('parses all 25 small clips and reaches eligibility without blocking legitimate counts', async () => {
    mocks.existingSessions.mockResolvedValue([{ interpreterId: 11 }, { interpreterId: 22 }]);
    const req = bulkRequest(25);
    req.headers.delete('content-length');
    const response = await POST(req);
    expect(response.status, await response.clone().text()).toBe(409);
    expect((await response.json()).skippedCount).toBe(2);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 409 before storage configuration or writes when every active interpreter is blocked', async () => {
    mocks.existingSessions.mockResolvedValue([
      { interpreterId: 11 }, { interpreterId: 22 },
      { interpreterId: 11 }, // Multiple historical sessions must not double count.
    ]);

    const response = await POST(bulkRequest());
    expect(response.status, await response.clone().text()).toBe(409);
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
    expect(response.status, await response.clone().text()).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Storage is not configured',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('reclaims individual upload attempts after draft reservation but before publishing', async () => {
    vi.stubEnv('FRONTEND_ORIGIN', 'https://interpretes.rd.ibusiness.com.do');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    mocks.findInterpreter.mockResolvedValue({ id: 11 });
    mocks.transaction.mockResolvedValueOnce({
      conflict: null,
      session: { id: 'draft-ci', updatedAt: new Date() },
    });
    mocks.upload.mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'Upload rejected' } });

    const response = await POST(singleInterpreterRequest(2));
    expect(response.status, await response.clone().text()).toBe(500);
    expect(mocks.transaction).toHaveBeenCalledOnce(); // Reserving the draft is not publishing.
    expect(mocks.remove).toHaveBeenCalledOnce();
    const removed = mocks.remove.mock.calls[0][0] as string[];
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^base\/draft-ci\/upload-[a-f0-9-]+\/0\.mp3$/);
  });

  it('reclaims successful uploads when the next audio fails before any publishing transaction', async () => {
    mocks.existingSessions.mockResolvedValue([]);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    mocks.upload.mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'Temporary storage failure' } });

    const response = await POST(bulkRequest(2));
    expect(response.status, await response.clone().text()).toBe(500);
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
    expect(response.status, await response.clone().text()).toBe(500);
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
    expect(response.status, await response.clone().text()).toBe(500);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('Roleplay pre-commit audio cleanup failed');
    log.mockRestore();
  });

  it('does not block an active interpreter on a legacy candidate-owned session', async () => {
    // The batch query filters recruitmentCandidateId: null; candidate-owned
    // historical sessions with interpreterId set must be excluded by the DB.
    mocks.existingSessions.mockResolvedValue([]);

    const response = await POST(bulkRequest());
    expect(response.status, await response.clone().text()).toBe(503);
    expect(mocks.existingSessions.mock.calls[0][0].where.recruitmentCandidateId).toBeNull();
  });
});
