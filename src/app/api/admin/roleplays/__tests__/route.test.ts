// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUpload, mockRemove, mockGetPublicUrl, mockList } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockRemove: vi.fn(),
  mockGetPublicUrl: vi.fn(),
  mockList: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: vi.fn() },
    recruitmentCandidate: { findUnique: vi.fn() },
    roleplaySession: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    roleplayScenario: { create: vi.fn(), deleteMany: vi.fn() },
    roleplayAccess: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        remove: mockRemove,
        getPublicUrl: mockGetPublicUrl,
        list: mockList,
      })),
    },
  })),
}));

import { POST } from '../route';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';

const adminAuth = {
  user: { userId: 'a1', email: 'admin@x.com', role: 'admin', interpreterId: null, profileId: 'a1' },
  profile: { userId: 'a1', email: 'admin@x.com', role: 'admin', interpreterId: null, profileId: 'a1' },
};

function audioFile(name = 'base.webm', type = 'audio/webm', bytes = 8) {
  return new File([new Uint8Array(bytes)], name, { type });
}

function buildRequest(fields: {
  participantType?: string;
  participantId?: string;
  scenarios?: string;
  audios?: File[];
}) {
  const formData = new FormData();
  if (fields.participantType !== undefined) formData.append('participantType', fields.participantType);
  if (fields.participantId !== undefined) formData.append('participantId', fields.participantId);
  if (fields.scenarios !== undefined) formData.append('scenarios', fields.scenarios);
  for (const a of fields.audios ?? []) formData.append('scenarioAudios', a);
  return new Request('http://localhost/api/admin/roleplays', { method: 'POST', body: formData });
}

const oneScenario = JSON.stringify([{ title: 'Escenario 1', durationLimitSec: 0, scriptPrompt: 'Saluda' }]);

describe('POST /api/admin/roleplays', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.FRONTEND_ORIGIN = 'https://front.test';

    (validateAction as any).mockResolvedValue(adminAuth);
    (prisma.interpreter.findUnique as any).mockResolvedValue({ id: 7 });
    (prisma.recruitmentCandidate.findUnique as any).mockResolvedValue({ id: 9 });
    (prisma.roleplaySession.create as any).mockResolvedValue({ id: 'sess-1' });
    (prisma.roleplaySession.update as any).mockResolvedValue({});
    (prisma.roleplaySession.delete as any).mockResolvedValue({});
    (prisma.roleplaySession.findFirst as any).mockResolvedValue(null);
    (prisma.roleplayScenario.create as any).mockResolvedValue({ id: 'sc-1' });
    (prisma.roleplayScenario.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.roleplayAccess.create as any).mockResolvedValue({ id: 'acc-1' });
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({
        roleplayScenario: { create: prisma.roleplayScenario.create },
        roleplaySession: { update: prisma.roleplaySession.update },
      })
    );

    mockUpload.mockResolvedValue({ error: null });
    mockRemove.mockResolvedValue({ error: null });
    mockList.mockResolvedValue({ data: [], error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.test/base/0.webm' } });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('authorization', () => {
    it('rejects a non-admin without creating anything', async () => {
      (validateAction as any).mockResolvedValue({ error: 'Access denied: insufficient permissions', code: 'UNAUTHORIZED' });

      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(403);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
    });
  });

  describe('input validation', () => {
    it('rejects missing required fields', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter' }) as any);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Missing required fields/);
    });

    it('rejects an invalid participant type', async () => {
      const res = await POST(buildRequest({ participantType: 'other', participantId: '7', scenarios: oneScenario }) as any);
      expect(res.status).toBe(400);
    });

    it('rejects an invalid participant id', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: 'abc', scenarios: oneScenario }) as any);
      expect(res.status).toBe(400);
    });

    it('rejects malformed scenarios JSON', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: 'not-json', audios: [audioFile()] }) as any);
      expect(res.status).toBe(400);
    });

    it('rejects an empty scenarios array', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: '[]', audios: [] }) as any);
      expect(res.status).toBe(400);
    });

    it('rejects a scenario with a missing title', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: JSON.stringify([{ title: '' }]), audios: [audioFile()] }) as any);
      expect(res.status).toBe(400);
    });

    it('requires one base audio per scenario', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [] }) as any);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/exactly one base audio/);
    });

    it('rejects a zero-byte audio file', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile('e.webm', 'audio/webm', 0)] }) as any);
      expect(res.status).toBe(400);
    });

    it('rejects a disallowed audio type', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile('a.txt', 'text/plain')] }) as any);
      expect(res.status).toBe(400);
    });

    it('returns 404 when the interpreter does not exist', async () => {
      (prisma.interpreter.findUnique as any).mockResolvedValue(null);
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);
      expect(res.status).toBe(404);
    });

    it('returns 404 when the candidate does not exist', async () => {
      (prisma.recruitmentCandidate.findUnique as any).mockResolvedValue(null);
      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);
      expect(res.status).toBe(404);
    });

    it('returns 503 when storage is not configured', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);
      expect(res.status).toBe(503);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('creates an interpreter session with scenarios and points session baseAudioUrl at scenario 0', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.sessionId).toBe('sess-1');
      expect(body.data.scenarioCount).toBe(1);
      expect(body.data.inviteLink).toBe('https://front.test/roleplays/sess-1');

      expect(prisma.roleplaySession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ interpreterId: 7, recruitmentCandidateId: null, status: 'DRAFT' }),
        })
      );
      expect(prisma.roleplayScenario.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: 'sess-1',
            order: 0,
            title: 'Escenario 1',
            baseAudioUrl: 'https://cdn.test/base/0.webm',
            durationLimitSec: null,
            scriptPrompt: 'Saluda',
            expectedKeys: [],
          }),
        })
      );
      expect(prisma.roleplaySession.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sess-1' }, data: { baseAudioUrl: 'https://cdn.test/base/0.webm' } })
      );
      expect(prisma.roleplayAccess.create).not.toHaveBeenCalled();
    });

    it('creates an invitation and an invite link for a candidate session', async () => {
      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.inviteLink).toMatch(/^https:\/\/front\.test\/r\/[A-Z0-9_-]+$/);
      expect(prisma.roleplaySession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ recruitmentCandidateId: 9, interpreterId: null }),
        })
      );
      expect(prisma.roleplayAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sessionId: 'sess-1', tokenHash: expect.any(String), inviteCode: expect.any(String), expiresAt: expect.any(Date) }),
        })
      );
    });
  });

  describe('failure cleanup', () => {
    it('deletes the half-created session when an audio upload fails', async () => {
      mockUpload.mockResolvedValue({ error: { message: 'boom' } });

      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Failed to upload audio: boom');
      expect(prisma.roleplaySession.delete).toHaveBeenCalledWith({ where: { id: 'sess-1' } });
      expect(prisma.roleplayScenario.create).not.toHaveBeenCalled();
    });
  });

  describe('create-or-resume guard', () => {
    it('returns 409 before uploading when the participant has an active session', async () => {
      (prisma.roleplaySession.findFirst as any).mockResolvedValueOnce({ id: 'sess-old', status: 'INVITED' });

      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.success).toBe(false);
      expect(body.sessionId).toBe('sess-old');
      expect(body.status).toBe('INVITED');
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('returns 409 for a finished (PASSED) session, blocking silent duplicates', async () => {
      (prisma.roleplaySession.findFirst as any).mockResolvedValueOnce({ id: 'sess-done', status: 'PASSED' });

      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(409);
      expect((await res.json()).sessionId).toBe('sess-done');
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('resumes an unfinished DRAFT: reuses the row and replaces its scenarios', async () => {
      (prisma.roleplaySession.findFirst as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sess-d' });
      mockList.mockResolvedValue({ data: [{ name: '0.webm' }], error: null });

      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.sessionId).toBe('sess-d');
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(prisma.roleplayScenario.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 'sess-d' } });
      expect(mockRemove).toHaveBeenCalledWith(['base/sess-d/0.webm']);
      expect(prisma.roleplayScenario.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sessionId: 'sess-d' }) })
      );
      expect(prisma.roleplayAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sessionId: 'sess-d' }) })
      );
      expect(mockUpload).toHaveBeenCalledWith('base/sess-d/0.webm', expect.anything(), expect.objectContaining({ upsert: true }));
    });

    it('keeps a resumed DRAFT row on failure, resetting it instead of deleting', async () => {
      (prisma.roleplaySession.findFirst as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sess-d' });
      mockUpload.mockResolvedValue({ error: { message: 'boom' } });

      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(500);
      expect(prisma.roleplaySession.delete).not.toHaveBeenCalled();
      expect(prisma.roleplayScenario.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 'sess-d' } });
      expect(prisma.roleplaySession.update).toHaveBeenCalledWith({ where: { id: 'sess-d' }, data: { baseAudioUrl: '' } });
    });

    it('creates a brand-new session when only cancelled/expired sessions exist', async () => {
      (prisma.roleplaySession.findFirst as any).mockResolvedValue(null);

      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(200);
      expect((await res.json()).data.sessionId).toBe('sess-1');
      expect(prisma.roleplaySession.create).toHaveBeenCalledTimes(1);
    });
  });
});
