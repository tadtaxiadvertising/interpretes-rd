// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUpload, mockRemove, mockGetPublicUrl, mockList, mockInfo } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockRemove: vi.fn(),
  mockGetPublicUrl: vi.fn(),
  mockList: vi.fn(),
  mockInfo: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    recruitmentCandidate: { findUnique: vi.fn() },
    roleplaySession: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    roleplayScenario: { create: vi.fn(), deleteMany: vi.fn() },
    roleplayAccess: { create: vi.fn(), findUnique: vi.fn() },
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
        info: mockInfo,
      })),
    },
  })),
}));

import { POST } from '../route';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { getRoleplaySnapshotHash } from '@/lib/roleplay-library';

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
  librarySessionId?: string;
  libraryFingerprint?: string;
}) {
  const formData = new FormData();
  if (fields.participantType !== undefined) formData.append('participantType', fields.participantType);
  if (fields.participantId !== undefined) formData.append('participantId', fields.participantId);
  if (fields.scenarios !== undefined) formData.append('scenarios', fields.scenarios);
  if (fields.librarySessionId !== undefined) formData.append('librarySessionId', fields.librarySessionId);
  if (fields.libraryFingerprint !== undefined) formData.append('libraryFingerprint', fields.libraryFingerprint);
  for (const a of fields.audios ?? []) formData.append('scenarioAudios', a);
  return new Request('http://localhost/api/admin/roleplays', { method: 'POST', body: formData });
}

const oneScenario = JSON.stringify([{ title: 'Escenario 1', durationLimitSec: 0, scriptPrompt: 'Saluda' }]);
const draftUpdatedAt = new Date('2026-11-10T10:00:00.000Z');

const librarySourceId = 'library-source-123';
const libraryAudio = 'https://supabase.test/storage/v1/object/public/roleplay-audio/base/bulk-source/0.mp3';
const libraryScenario = {
  order: 0, title: 'Medical introduction', baseAudioUrl: libraryAudio,
  durationLimitSec: 300, scriptPrompt: 'Interpretar fielmente', expectedKeys: ['Terminología médica'],
};
const libraryFingerprint = getRoleplaySnapshotHash([libraryScenario]);

describe('POST /api/admin/roleplays', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.FRONTEND_ORIGIN = 'https://front.test';

    (validateAction as any).mockResolvedValue(adminAuth);
    (prisma.interpreter.findUnique as any).mockResolvedValue({ id: 7 });
    (prisma.interpreter.findMany as any).mockResolvedValue([{ id: 7 }, { id: 8 }]);
    (prisma.roleplaySession.findMany as any).mockResolvedValue([]);
    (prisma.recruitmentCandidate.findUnique as any).mockResolvedValue({ id: 9 });
    (prisma.roleplaySession.create as any).mockResolvedValue({ id: 'sess-1', updatedAt: draftUpdatedAt });
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ id: 'sess-1', status: 'DRAFT', updatedAt: draftUpdatedAt });
    (prisma.roleplayAccess.findUnique as any).mockResolvedValue(null);
    (prisma.interpreter.findFirst as any).mockResolvedValue({ id: 7 });
    (prisma.roleplaySession.update as any).mockResolvedValue({});
    (prisma.roleplaySession.delete as any).mockResolvedValue({});
    (prisma.roleplaySession.findFirst as any).mockResolvedValue(null);
    (prisma.roleplayScenario.create as any).mockResolvedValue({ id: 'sc-1' });
    (prisma.roleplayScenario.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.roleplayAccess.create as any).mockResolvedValue({ id: 'acc-1' });
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({
        $queryRaw: vi.fn().mockResolvedValue([]),
        interpreter: { findFirst: prisma.interpreter.findFirst },
        roleplayScenario: { create: prisma.roleplayScenario.create, deleteMany: prisma.roleplayScenario.deleteMany },
        roleplaySession: {
          findFirst: prisma.roleplaySession.findFirst,
          findUnique: prisma.roleplaySession.findUnique,
          update: prisma.roleplaySession.update,
          create: prisma.roleplaySession.create,
        },
        roleplayAccess: { findUnique: prisma.roleplayAccess.findUnique, create: prisma.roleplayAccess.create },
      })
    );

    mockUpload.mockResolvedValue({ error: null });
    mockRemove.mockResolvedValue({ error: null });
    mockList.mockResolvedValue({ data: [], error: null });
    mockInfo.mockResolvedValue({ data: { name: '0.mp3' }, error: null });
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

    it('rejects a scenario duration above the platform maximum', async () => {
      const overLimit = JSON.stringify([{ title: 'Escenario 1', durationLimitSec: 301, scriptPrompt: '' }]);
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: overLimit, audios: [audioFile()] }) as any);
      expect(res.status).toBe(400);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
    });


    it('supports a 21-segment medical roleplay in one session', async () => {
      const scenarios = Array.from({ length: 21 }, (_, index) => ({
        title: `Medical segment ${index + 1}`,
        durationLimitSec: 0,
        scriptPrompt: 'Interpreta consecutivamente',
      }));
      const audios = scenarios.map((_, index) => audioFile(`segment-${index}.mp3`, 'audio/mpeg'));

      const res = await POST(buildRequest({
        participantType: 'interpreter',
        participantId: '7',
        scenarios: JSON.stringify(scenarios),
        audios,
      }) as any);

      expect(res.status).toBe(200);
      expect((await res.json()).data.scenarioCount).toBe(21);
      expect(mockUpload).toHaveBeenCalledTimes(21);
      expect(prisma.roleplayScenario.create).toHaveBeenCalledTimes(21);
    });

    it('supports a 21-segment roleplay for all eligible active interpreters', async () => {
      const scenarios = Array.from({ length: 21 }, (_, index) => ({
        title: `Medical segment ${index + 1}`,
        scriptPrompt: 'Interpreta consecutivamente',
      }));
      const audios = scenarios.map((_, index) => audioFile(`segment-${index}.mp3`, 'audio/mpeg'));

      const res = await POST(buildRequest({
        participantType: 'all-active-interpreters',
        scenarios: JSON.stringify(scenarios),
        audios,
      }) as any);

      const response = await res.json();
      expect(res.status).toBe(200);
      expect(response.data.createdCount).toBe(2);
      expect(response.data.scenarioCount).toBe(21);
      expect(mockUpload).toHaveBeenCalledTimes(21);
      expect(prisma.roleplaySession.create).toHaveBeenCalledTimes(2);
    });

    it('rejects more than 25 scenarios before uploading audio', async () => {
      const scenarios = Array.from({ length: 26 }, (_, index) => ({ title: `Segment ${index}` }));
      const res = await POST(buildRequest({
        participantType: 'interpreter',
        participantId: '7',
        scenarios: JSON.stringify(scenarios),
        audios: scenarios.map((_, i) => audioFile(`segment-${i}.mp3`, 'audio/mpeg')),
      }) as any);
      expect(res.status).toBe(400);
      expect(mockUpload).not.toHaveBeenCalled();
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
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
    it('preserves a newly reserved draft when an audio upload fails', async () => {
      mockUpload.mockResolvedValue({ error: { message: 'boom' } });

      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Failed to upload audio: boom');
      expect(prisma.roleplaySession.create).toHaveBeenCalledTimes(1);
      expect(prisma.roleplaySession.delete).not.toHaveBeenCalled();
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
        .mockResolvedValueOnce({ id: 'sess-d', updatedAt: draftUpdatedAt });
      mockList.mockResolvedValue({ data: [{ name: '0.webm' }], error: null });

      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.sessionId).toBe('sess-d');
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(prisma.roleplayScenario.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 'sess-d' } });
      expect(mockRemove).not.toHaveBeenCalled();
      expect(prisma.roleplayScenario.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sessionId: 'sess-d' }) })
      );
      expect(prisma.roleplayAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sessionId: 'sess-d' }) })
      );
      expect(mockUpload).toHaveBeenCalledWith(expect.stringMatching(/^base\/sess-d\/upload-[^/]+\/0\.webm$/), expect.anything(), expect.objectContaining({ upsert: true }));
    });

    it('keeps a resumed DRAFT and its scenarios on failure', async () => {
      (prisma.roleplaySession.findFirst as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sess-d', updatedAt: draftUpdatedAt });
      mockUpload.mockResolvedValue({ error: { message: 'boom' } });

      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(500);
      expect(prisma.roleplaySession.delete).not.toHaveBeenCalled();
      expect(prisma.roleplayScenario.deleteMany).not.toHaveBeenCalled();
      expect(prisma.roleplaySession.update).not.toHaveBeenCalled();
    });

    it('creates a brand-new session when only cancelled/expired sessions exist', async () => {
      (prisma.roleplaySession.findFirst as any).mockResolvedValue(null);

      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(200);
      expect((await res.json()).data.sessionId).toBe('sess-1');
      expect(prisma.roleplaySession.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('library reuse', () => {
    it('reuses stored audio and expected assessment keys without uploading', async () => {
      (prisma.roleplaySession.findUnique as any).mockImplementation(({ where }: any) =>
        where.id === librarySourceId
          ? { status: 'INVITED', scenarios: [libraryScenario] }
          : { id: 'sess-1', status: 'DRAFT', updatedAt: draftUpdatedAt }
      );
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        librarySessionId: librarySourceId, libraryFingerprint,
      }) as any);
      expect(res.status).toBe(200);
      expect((await res.json()).data.scenarioCount).toBe(1);
      expect(mockInfo).toHaveBeenCalledWith('base/bulk-source/0.mp3');
      expect(mockUpload).not.toHaveBeenCalled();
      expect(prisma.roleplayScenario.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          title: libraryScenario.title,
          baseAudioUrl: libraryAudio,
          expectedKeys: libraryScenario.expectedKeys,
        }),
      }));
    });

    it('rejects an outdated snapshot before creating a draft', async () => {
      (prisma.roleplaySession.findUnique as any).mockResolvedValue({ status: 'INVITED', scenarios: [libraryScenario] });
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7', librarySessionId: librarySourceId,
        libraryFingerprint: '0'.repeat(64),
      }) as any);
      expect(res.status).toBe(409);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(mockInfo).not.toHaveBeenCalled();
    });

    it('rejects audio from a different storage host', async () => {
      const external = { ...libraryScenario, baseAudioUrl: 'https://other.example/storage/v1/object/public/roleplay-audio/base/a/0.mp3' };
      (prisma.roleplaySession.findUnique as any).mockResolvedValue({ status: 'INVITED', scenarios: [external] });
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7', librarySessionId: librarySourceId,
        libraryFingerprint: getRoleplaySnapshotHash([external]),
      }) as any);
      expect(res.status).toBe(409);
      expect(mockInfo).not.toHaveBeenCalled();
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
    });

    it('rejects deleted audio before creating any session', async () => {
      (prisma.roleplaySession.findUnique as any).mockResolvedValue({ status: 'INVITED', scenarios: [libraryScenario] });
      mockInfo.mockResolvedValue({ data: null, error: { message: 'Not found' } });
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        librarySessionId: librarySourceId, libraryFingerprint,
      }) as any);
      expect(res.status).toBe(409);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('blocks client uploads mixed with a library reference', async () => {
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        librarySessionId: librarySourceId, libraryFingerprint,
        audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(400);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
    });
  });
});
