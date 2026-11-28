// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUpload, mockRemove, mockGetPublicUrl, mockList, mockInfo, mockGetBucket, mockFrom } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockRemove: vi.fn(),
  mockGetPublicUrl: vi.fn(),
  mockList: vi.fn(),
  mockInfo: vi.fn(),
  mockGetBucket: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({ notifyRoleplayAssignments: vi.fn() }));
vi.mock('@/lib/notifications/notify-roleplay', () => notificationMocks);

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  actorFromBearer: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    recruitmentCandidate: { findUnique: vi.fn() },
    roleplaySession: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    roleplayScenario: { create: vi.fn(), deleteMany: vi.fn() },
    roleplayAccess: { create: vi.fn(), findUnique: vi.fn() },
    roleplayLibraryArchive: { findUnique: vi.fn() },
    roleplayCreationRequest: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      getBucket: mockGetBucket,
      from: vi.fn((bucket: string) => (mockFrom(bucket), {
        upload: mockUpload,
        remove: mockRemove,
        getPublicUrl: mockGetPublicUrl,
        list: mockList,
        info: mockInfo,
      })),
    },
  })),
}));

vi.mock('@/lib/roleplay/creation-ledger-readiness', () => ({ isCreationLedgerReady: vi.fn() }));
import { isCreationLedgerReady } from '@/lib/roleplay/creation-ledger-readiness';
import { POST, GET } from '../route';
import { POST as readCreationReceipt } from '../creation-receipt/route';
import { recoverSingleRoleplayCreation } from '@/lib/roleplay/creation-receipt-browser';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
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
  requiresBilingualOpening?: string;
}) {
  const formData = new FormData();
  if (fields.requiresBilingualOpening !== undefined) formData.append('requiresBilingualOpening', fields.requiresBilingualOpening);
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
    notificationMocks.notifyRoleplayAssignments.mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.FRONTEND_ORIGIN = 'https://front.test';
    delete process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED;
    delete process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED;
    vi.mocked(isCreationLedgerReady).mockResolvedValue(true);
    vi.mocked(prisma.roleplayCreationRequest.create).mockReset().mockResolvedValue({ id: 'claim' } as never);
    vi.mocked(prisma.roleplayCreationRequest.findUnique).mockReset().mockResolvedValue(null);
    vi.mocked(prisma.roleplayCreationRequest.updateMany).mockResolvedValue({ count: 1 });

    (validateAction as any).mockResolvedValue(adminAuth);
    (prisma.interpreter.findUnique as any).mockResolvedValue({ id: 7 });
    (prisma.interpreter.findMany as any).mockResolvedValue([{ id: 7 }, { id: 8 }]);
    (prisma.roleplaySession.findMany as any).mockResolvedValue([]);
    (prisma.recruitmentCandidate.findUnique as any).mockResolvedValue({ id: 9 });
    (prisma.roleplaySession.create as any).mockResolvedValue({ id: 'sess-1', updatedAt: draftUpdatedAt });
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ id: 'sess-1', status: 'DRAFT', updatedAt: draftUpdatedAt });
    (prisma.roleplayAccess.findUnique as any).mockResolvedValue(null);
    (prisma.roleplayLibraryArchive.findUnique as any).mockResolvedValue(null);
    (prisma.interpreter.findFirst as any).mockResolvedValue({ id: 7 });
    (prisma.roleplaySession.update as any).mockResolvedValue({});
    (prisma.roleplaySession.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.roleplaySession.delete as any).mockResolvedValue({});
    (prisma.roleplaySession.findFirst as any).mockResolvedValue(null);
    (prisma.roleplayScenario.create as any).mockResolvedValue({ id: 'sc-1' });
    (prisma.roleplayScenario.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.roleplayAccess.create as any).mockResolvedValue({ id: 'acc-1' });
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({
        $queryRaw: vi.fn().mockImplementation(async (sql: TemplateStringsArray, ...values: unknown[]) =>
          sql.join('').includes('INSERT INTO public.roleplay_sessions') ? [{ id: values[0], updatedAt: draftUpdatedAt }] : []),
        interpreter: { findFirst: prisma.interpreter.findFirst },
        roleplayScenario: { create: prisma.roleplayScenario.create, deleteMany: prisma.roleplayScenario.deleteMany },
        roleplaySession: {
          findFirst: prisma.roleplaySession.findFirst,
          findUnique: prisma.roleplaySession.findUnique,
          update: prisma.roleplaySession.update,
          updateMany: prisma.roleplaySession.updateMany,
          create: prisma.roleplaySession.create,
        },
        roleplayAccess: { findUnique: prisma.roleplayAccess.findUnique, create: prisma.roleplayAccess.create },
        roleplayLibraryArchive: { findUnique: prisma.roleplayLibraryArchive.findUnique },
        roleplayCreationRequest: { updateMany: prisma.roleplayCreationRequest.updateMany },
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

  it('uploads required bulk clinical clips privately without generating public URLs', async () => {
    for (const flag of ['ROLEPLAY_BILINGUAL_OPENING_API_ENABLED','ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED','ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED']) vi.stubEnv(flag, 'true');
    try {
      mockGetBucket.mockImplementation(async (id: string) => ({ error: null, data: {
        id, name: id, public: false, file_size_limit: 15 * 1024 * 1024,
        allowed_mime_types: ['audio/webm','audio/mp4','audio/mpeg', id === 'roleplay-opening-private' ? 'audio/ogg' : 'audio/wav'],
      } }));
      const response = await POST(buildRequest({ participantType: 'all-active-interpreters', scenarios: oneScenario,
        audios: [audioFile()], requiresBilingualOpening: 'true' }) as any);
      expect(response.status).toBe(200);
      expect(mockFrom.mock.calls).toEqual([['roleplay-audio-private']]);
      expect(mockGetPublicUrl).not.toHaveBeenCalled();
      expect(mockUpload.mock.calls[0][0]).toMatch(/^base\/[a-f0-9-]+\/0\.webm$/);
      expect(prisma.roleplaySession.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { scenarios: { create: [expect.objectContaining({ baseAudioUrl: expect.stringMatching(/^private-base\//) })] } },
      }));
    } finally { vi.unstubAllEnvs(); }
  });

  describe('authorization', () => {
    it('rejects required opening assignments before any write while rollout is disabled', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED', '');
    try {
      const response = await POST(buildRequest({ participantType: 'interpreter', participantId: '7',
        scenarios: oneScenario, audios: [audioFile()], requiresBilingualOpening: 'true' }) as any);
      expect(response.status).toBe(503);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('rejects an interpreter Bearer even when an admin cookie is present, before any upload or DB query', async () => {
      (actorFromBearer as any).mockResolvedValue({
        userId: 'interpreter-bearer', role: 'interpreter', email: 'interpreter@test.invalid',
      });
      const req = buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] });
      req.headers.set('Authorization', 'Bearer verified-interpreter-token');
      const res = await POST(req as any);
      expect(res.status).toBe(403);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
      expect(prisma.roleplaySession.findUnique).not.toHaveBeenCalled();
    });

    it('rejects invalid or malformed explicit Authorization with an admin cookie', async () => {
      (actorFromBearer as any).mockResolvedValue(null);
      const req = buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] });
      req.headers.set('Authorization', 'Bearer expired-token');
      const res = await POST(req as any);
      expect(res.status).toBe(403);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('rejects a different admin identity when Bearer and cookie disagree', async () => {
      (actorFromBearer as any).mockResolvedValue({
        userId: 'another-admin', role: 'admin', email: 'different@test.invalid',
      });
      const req = buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] });
      req.headers.set('Authorization', 'Bearer another-admin-token');
      const res = await POST(req as any);
      expect(res.status).toBe(403);
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('accepts a matching explicitly authenticated admin identity', async () => {
      (actorFromBearer as any).mockResolvedValue({
        userId: 'a1', role: 'admin', email: 'admin@x.com',
      });
      const req = buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] });
      req.headers.set('Authorization', 'Bearer same-admin-token');
      const res = await POST(req as any);
      expect(res.status).toBe(200);
      expect(mockUpload).toHaveBeenCalledOnce();
    });

    it('rejects a non-admin without creating anything', async () => {
      (validateAction as any).mockResolvedValue({ error: 'Access denied: insufficient permissions', code: 'UNAUTHORIZED' });

      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(403);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
    });
  });

  describe('explicit single interpreter idempotency pilot', () => {
    const requestKey = '123e4567-e89b-42d3-a456-426614174000';
    const keyed = (participantType = 'interpreter', key = requestKey) => {
      const request = buildRequest({ participantType, participantId: '7', scenarios: oneScenario, audios: [audioFile()] });
      request.headers.set('Idempotency-Key', key);
      return request;
    };

    it('rejects keyed requests while disabled, without creating or uploading', async () => {
      const response = await POST(keyed() as any);
      expect(response.status).toBe(503);
      expect(prisma.roleplayCreationRequest.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });
    it('rejects keyed creation when only the creation flag is enabled', async () => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      const response = await POST(keyed() as any);
      expect(response.status).toBe(503);
      expect(isCreationLedgerReady).not.toHaveBeenCalled();
      expect(prisma.roleplayCreationRequest.create).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });
    it.each(['candidate', 'all-active-interpreters'])('rejects unsupported keyed scope %s', async participantType => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';
      expect((await POST(keyed(participantType) as any)).status).toBe(400);
      expect(prisma.roleplayCreationRequest.create).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });
    it('rejects a keyed request when the actual database is not ready', async () => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';
      vi.mocked(isCreationLedgerReady).mockResolvedValueOnce(false);
      expect((await POST(keyed() as any)).status).toBe(503);
      expect(isCreationLedgerReady).toHaveBeenCalledExactlyOnceWith(prisma);
      expect(prisma.roleplayCreationRequest.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
      // The admission slot must be released, and readiness checked afresh.
      expect((await POST(keyed() as any)).status).toBe(200);
      expect(isCreationLedgerReady).toHaveBeenCalledTimes(2);
    });
    it('rejects a malformed key before parsing multipart', async () => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';
      const request = keyed('interpreter', 'not-a-uuid');
      expect((await POST(request as any)).status).toBe(400);
      expect(request.bodyUsed).toBe(false);
      expect(prisma.roleplayCreationRequest.create).not.toHaveBeenCalled();
    });
    it('completes the receipt within publication before sending notifications', async () => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';
      const response = await POST(keyed() as any);
      expect(response.status).toBe(200);
      expect(prisma.roleplayCreationRequest.create).toHaveBeenCalledExactlyOnceWith({
        data: { actorUserId: 'a1', requestKey, payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/), status: 'IN_PROGRESS' },
        select: { id: true },
      });
      expect(prisma.roleplayCreationRequest.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { actorUserId: 'a1', requestKey, payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/), status: 'IN_PROGRESS' },
        data: expect.objectContaining({ status: 'COMPLETED', sessionIds: ['sess-1'], createdCount: 1, skippedCount: 0, scenarioCount: 1 }),
      });
      expect(prisma.roleplaySession.updateMany).toHaveBeenCalledBefore(prisma.roleplayCreationRequest.updateMany as any);
      expect(prisma.roleplayCreationRequest.updateMany).toHaveBeenCalledBefore(notificationMocks.notifyRoleplayAssignments);
    });
    it('preserves potentially committed audio and suppresses notifications when receipt completion fails', async () => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';
      vi.mocked(prisma.roleplayCreationRequest.updateMany).mockResolvedValueOnce({ count: 0 });
      expect((await POST(keyed() as any)).status).toBe(500);
      expect(mockUpload).toHaveBeenCalledOnce();
      expect(mockRemove).not.toHaveBeenCalled();
      expect(notificationMocks.notifyRoleplayAssignments).not.toHaveBeenCalled();
    });
    it('blocks a competing request without uploading or reserving a session', async () => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';
      vi.mocked(prisma.roleplayCreationRequest.create).mockRejectedValueOnce({ code: 'P2002' });
      vi.mocked(prisma.roleplayCreationRequest.findUnique).mockResolvedValueOnce(null);
      expect((await POST(keyed() as any)).status).toBe(409);
      expect(mockUpload).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it.each([true, false])('replays only a receipt for the correct existing interpreter session (%s)', async owned => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';
      let payloadHash = '';
      vi.mocked(prisma.roleplayCreationRequest.create).mockImplementationOnce(async args => {
        payloadHash = args.data.payloadHash;
        throw { code: 'P2002' };
      });
      vi.mocked(prisma.roleplayCreationRequest.findUnique)
        .mockImplementationOnce(async () => ({ actorUserId: 'a1', payloadHash, status: 'COMPLETED' }) as never)
        .mockResolvedValueOnce({
          status: 'COMPLETED', sessionIds: ['sess-1'], createdCount: 1, skippedCount: 0,
          scenarioCount: 1, completedAt: new Date(),
        } as never);
      vi.mocked(prisma.roleplaySession.findMany).mockResolvedValueOnce([{ id: 'sess-1' }] as never);
      vi.mocked(prisma.roleplaySession.findFirst).mockResolvedValueOnce(owned ? { id: 'sess-1' } as never : null);
      const response = await POST(keyed() as any);
      expect(response.status).toBe(owned ? 200 : 409);
      if (owned) expect((await response.json()).data).toEqual({
        sessionId: 'sess-1', inviteLink: 'https://front.test/roleplays/sess-1', scenarioCount: 1,
      });
      expect(prisma.roleplaySession.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'sess-1', interpreterId: 7, recruitmentCandidateId: null }),
        select: { id: true },
      });
      expect(mockUpload).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(notificationMocks.notifyRoleplayAssignments).not.toHaveBeenCalled();
    });

    it('recovers a committed creation after a post-commit error across both real route handlers', async () => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';

      // Persist the simulated ledger only through the actual claim/completion
      // helpers. The production route handlers and browser parser are real;
      // this test intentionally substitutes DB, auth, Storage and notifications.
      let row: Record<string, unknown> | null = null;
      vi.mocked(prisma.roleplayCreationRequest.create).mockImplementation(async args => {
        if (row) throw { code: 'P2002' };
        row = { ...args.data };
        return { id: 'claim' } as never;
      });
      vi.mocked(prisma.roleplayCreationRequest.updateMany).mockImplementationOnce(async args => {
        expect(args.where).toEqual({
          actorUserId: 'a1', requestKey, payloadHash: row?.payloadHash, status: 'IN_PROGRESS',
        });
        row = { ...row, ...args.data };
        return { count: 1 };
      });
      vi.mocked(prisma.roleplayCreationRequest.findUnique).mockImplementation(async args => {
        const scope = args.where.actorUserId_requestKey;
        return (row && scope?.actorUserId === row.actorUserId && scope.requestKey === row.requestKey
          ? row : null) as never;
      });
      notificationMocks.notifyRoleplayAssignments.mockRejectedValueOnce(new Error('synthetic post-commit notification failure'));

      const initial = await POST(keyed() as any);
      expect(initial.status).toBe(500);
      expect(mockUpload).toHaveBeenCalledOnce();
      expect(mockRemove).not.toHaveBeenCalled();
      expect(prisma.roleplayCreationRequest.updateMany).toHaveBeenCalledOnce();

      vi.mocked(prisma.roleplaySession.findMany).mockResolvedValue([{ id: 'sess-1' }] as never);
      const transport: typeof fetch = async (url, init) => {
        expect(url).toBe('/api/admin/roleplays/creation-receipt');
        expect(init?.body).toBe(JSON.stringify({ requestKey }));
        const response = await readCreationReceipt(new Request('http://localhost' + url, init));
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        return response;
      };
      expect(await recoverSingleRoleplayCreation(requestKey, 1, transport)).toEqual({ status: 'COMPLETED', sessionId: 'sess-1' });

      // Same UUID cannot expose a receipt belonging to another administrator.
      vi.mocked(validateAction).mockResolvedValueOnce({
        ...adminAuth, user: { ...adminAuth.user, userId: 'other-admin' },
      } as never);
      expect(await recoverSingleRoleplayCreation(requestKey, 1, transport)).toEqual({ status: 'NOT_FOUND' });

      vi.mocked(prisma.roleplaySession.findFirst).mockResolvedValueOnce({ id: 'sess-1' } as never);
      const replay = await POST(keyed() as any);
      expect(replay.status).toBe(200);
      expect((await replay.json()).data).toEqual({
        sessionId: 'sess-1', inviteLink: 'https://front.test/roleplays/sess-1', scenarioCount: 1,
      });
      expect(mockUpload).toHaveBeenCalledOnce();
      expect(mockRemove).not.toHaveBeenCalled();
      expect(prisma.roleplaySession.create).toHaveBeenCalledOnce();
      expect(prisma.roleplayCreationRequest.updateMany).toHaveBeenCalledOnce();
      expect(notificationMocks.notifyRoleplayAssignments).toHaveBeenCalledOnce();
    });

    it('leaves unkeyed requests unchanged even when the pilot flag is enabled', async () => {
      process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'true';
      process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED = 'true';
      expect((await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any)).status).toBe(200);
      expect(prisma.roleplayCreationRequest.create).not.toHaveBeenCalled();
      expect(prisma.roleplayCreationRequest.updateMany).not.toHaveBeenCalled();
      expect(isCreationLedgerReady).not.toHaveBeenCalled();
    });
  });

  describe('process-local multipart admission', () => {
    it('rejects a second create before parsing or uploading while a first upload remains active', async () => {
      let releaseUpload!: (value: { error: null }) => void;
      let signalStarted!: () => void;
      const blockedUpload = new Promise<{ error: null }>(resolve => { releaseUpload = resolve; });
      const started = new Promise<void>(resolve => { signalStarted = resolve; });
      mockUpload.mockImplementationOnce(() => {
        signalStarted();
        return blockedUpload;
      });

      const first = POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      await started;
      let second: Response;
      try {
        const beforeCreates = (prisma.roleplaySession.create as any).mock.calls.length;
        second = await POST(buildRequest({
          participantType: 'interpreter', participantId: '7',
          scenarios: oneScenario, audios: [audioFile()],
        }) as any);
        expect(second.status).toBe(503);
        expect(second.headers.get('Retry-After')).toBe('5');
        expect(second.headers.get('Cache-Control')).toBe('private, no-store');
        expect(second.headers.get('Vary')).toContain('Authorization');
        expect(await second.json()).toMatchObject({
          success: false,
          error: expect.stringContaining('Ya se está creando otro roleplay'),
        });
        expect(mockUpload).toHaveBeenCalledOnce();
        expect(prisma.roleplaySession.create).toHaveBeenCalledTimes(beforeCreates);
      } finally {
        releaseUpload({ error: null });
      }
      const completed = await first;
      expect(completed.status).toBe(200);

      // A completed create releases the slot: later requests work normally.
      const next = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(next.status).toBe(200);
      expect(mockUpload).toHaveBeenCalledTimes(2);
    });

    it('cancels an oversized declared multipart before parsing, Storage or database work', async () => {
      const cancel = vi.fn();
      const boundary = 'synthetic-boundary';
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('private synthetic upload bytes'));
        },
        cancel,
      });
      const oversized = new Request('http://localhost/api/admin/roleplays', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': String(25 * 15 * 1024 * 1024 + 2 * 1024 * 1024 + 1),
        },
        body: source,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });

      const response = await POST(oversized as any);
      expect(response.status).toBe(413);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      expect(JSON.stringify(await response.json())).not.toContain('private synthetic');
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      expect(mockUpload).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();

      // Every early exit releases the one-request admission slot.
      const valid = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(valid.status).toBe(200);
    });

    it('preserves the 413 status if cancelling the upstream body fails', async () => {
      const cancel = vi.fn(async () => {
        throw new Error('SYNTHETIC_PRIVATE_TRANSPORT_ERROR');
      });
      const oversized = new Request('http://localhost/api/admin/roleplays', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=x',
          'Content-Length': String(25 * 15 * 1024 * 1024 + 2 * 1024 * 1024 + 10),
        },
        body: new ReadableStream<Uint8Array>({ cancel }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });

      const response = await POST(oversized as any);
      expect(response.status).toBe(413);
      expect(JSON.stringify(await response.json())).not.toContain('SYNTHETIC_PRIVATE_TRANSPORT_ERROR');
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('releases the admission slot even after a Storage upload failure', async () => {
      mockUpload.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_STORAGE_FAILURE'));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const failed = await POST(buildRequest({
          participantType: 'interpreter', participantId: '7',
          scenarios: oneScenario, audios: [audioFile()],
        }) as any);
        expect(failed.status).toBe(500);
        expect(JSON.stringify(await failed.json())).not.toContain('SYNTHETIC_PRIVATE_STORAGE_FAILURE');

        const retried = await POST(buildRequest({
          participantType: 'interpreter', participantId: '7',
          scenarios: oneScenario, audios: [audioFile()],
        }) as any);
        expect(retried.status).toBe(200);
        expect(mockUpload).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('input validation', () => {
    it.each([
      ['missing', null],
      ['legacy HTTP host', 'http://legacy-domain.test'],
      ['URL with credentials', 'https://user:private-password@front.test'],
      ['URL with query', 'https://front.test/?redirect=private-token'],
      ['non-root path', 'https://front.test/unexpected'],
      ['newline injection', 'https://front.test/\n'],
    ])('fails closed on %s FRONTEND_ORIGIN before creating a participant roleplay', async (_case, configured) => {
      if (configured === null) delete process.env.FRONTEND_ORIGIN;
      else process.env.FRONTEND_ORIGIN = configured;
      const res = await POST(buildRequest({
        participantType: 'candidate', participantId: '9',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
      expect(JSON.stringify(await res.json())).not.toMatch(/private-password|private-token|legacy-domain/);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('does not require a participant invite origin for bulk assignments', async () => {
      delete process.env.FRONTEND_ORIGIN;
      const res = await POST(buildRequest({
        participantType: 'all-active-interpreters',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(200);
      expect((await res.json()).data.createdCount).toBe(2);
      expect(notificationMocks.notifyRoleplayAssignments).toHaveBeenCalledWith([{ id: 'sess-1', interpreterId: 7 }, { id: 'sess-1', interpreterId: 8 }]);
    });

    it('normalizes a configured HTTPS origin without copying its trailing slash into invite links', async () => {
      process.env.FRONTEND_ORIGIN = 'https://front.test/';
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(200);
      expect((await res.json()).data.inviteLink).toBe('https://front.test/roleplays/sess-1');
      expect(notificationMocks.notifyRoleplayAssignments).toHaveBeenCalledWith([{ id: 'sess-1', interpreterId: 7 }]);
    });

    it('rejects missing required fields', async () => {
      const res = await POST(buildRequest({ participantType: 'interpreter' }) as any);
      expect(res.status).toBe(400);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
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
      const firstUploadPath = mockUpload.mock.calls[0][0];
      for (const [args] of (prisma.roleplaySession.create as any).mock.calls) {
        expect(args.data.baseAudioPath).toBe(firstUploadPath);
        expect(args.data.baseAudioUrl).toBe('https://cdn.test/base/0.webm');
      }
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
    it('does not notify if the individual draft changes during publication', async () => {
      (prisma.roleplaySession.updateMany as any).mockResolvedValueOnce({ count: 0 });
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);
      expect(res.status).toBe(409);
      expect(notificationMocks.notifyRoleplayAssignments).not.toHaveBeenCalled();
    });

    it('does not notify for a candidate invitation or publish it as an interpreter session', async () => {
      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);
      expect(res.status).toBe(200);
      expect(prisma.roleplayAccess.create).toHaveBeenCalledTimes(1);
      expect(prisma.roleplaySession.updateMany).not.toHaveBeenCalled();
      expect(notificationMocks.notifyRoleplayAssignments).not.toHaveBeenCalled();
    });

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
      expect(prisma.roleplaySession.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', status: 'DRAFT', updatedAt: draftUpdatedAt, interpreterId: 7, recruitmentCandidateId: null },
        data: { baseAudioUrl: 'https://cdn.test/base/0.webm', baseAudioPath: mockUpload.mock.calls[0][0], status: 'INVITED' },
      });
      expect(notificationMocks.notifyRoleplayAssignments).toHaveBeenCalledWith([{ id: 'sess-1', interpreterId: 7 }]);
      expect((prisma.roleplaySession.updateMany as any).mock.invocationCallOrder[0]).toBeLessThan(notificationMocks.notifyRoleplayAssignments.mock.invocationCallOrder[0]);
      expect(prisma.roleplayAccess.create).not.toHaveBeenCalled();
    });

    it.each([
      ['patient-chart.html', 'audio/mpeg', 'mp3'],
      ['../path.svg', 'audio/webm', 'webm'],
      ['recording.js', 'audio/mp4', 'mp4'],
      ['recording.bat', 'audio/wav', 'wav'],
    ] as const)('stores individual admin audio using a MIME-derived extension for %s', async (name, type, extension) => {
      const res = await POST(buildRequest({
        participantType: 'interpreter',
        participantId: '7',
        scenarios: oneScenario,
        audios: [audioFile(name, type)],
      }) as any);

      expect(res.status).toBe(200);
      expect(mockUpload).toHaveBeenCalledOnce();
      const [path, , options] = mockUpload.mock.calls[0];
      expect(path).toMatch(/^base\/sess-1\/upload-[a-f0-9-]+\/0\.(webm|mp3|mp4|wav)$/);
      expect(path.endsWith('.' + extension)).toBe(true);
      expect(path).not.toContain('patient-chart');
      expect(path).not.toContain('path.svg');
      expect(options).toEqual({ contentType: type, upsert: false });
    });

    it('uses canonical MIME extensions in bulk assignments without trusting filenames', async () => {
      const res = await POST(buildRequest({
        participantType: 'all-active-interpreters',
        scenarios: oneScenario,
        audios: [audioFile('../attack.html', 'audio/mpeg')],
      }) as any);
      expect(res.status).toBe(200);
      expect(mockUpload).toHaveBeenCalledOnce();
      const [path, , options] = mockUpload.mock.calls[0];
      expect(path).toMatch(/^base\/bulk-[a-f0-9-]+\/0\.mp3$/);
      expect(path).not.toContain('attack');
      expect(options).toEqual({ contentType: 'audio/mpeg', upsert: false });
    });

    it('creates an invitation and an invite link for a candidate session', async () => {
      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.inviteLink).toMatch(/^https:\/\/front\.test\/r\/[A-F0-9]{24}$/);
      // The short link reflects the exact 96-bit code persisted in the
      // invitation record. Old, shorter codes remain accepted by the validator.
      const inviteCode = (prisma.roleplayAccess.create as any).mock.calls[0][0].data.inviteCode as string;
      expect(inviteCode).toMatch(/^[A-F0-9]{24}$/);
      expect(body.data.inviteLink).toBe(`https://front.test/r/${inviteCode}`);
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

  describe('candidate ownership precedence for historical sessions', () => {
    it('does not treat a historical candidate session as a blocking interpreter attempt', async () => {
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(200);
      const findFirstQueries = (prisma.roleplaySession.findFirst as any).mock.calls
        .map(([query]: [unknown]) => query);
      expect(findFirstQueries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          where: {
            interpreterId: 7,
            recruitmentCandidateId: null,
            status: { in: expect.arrayContaining(['INVITED', 'PASSED']) },
          },
        }),
        expect.objectContaining({
          where: {
            interpreterId: 7,
            recruitmentCandidateId: null,
            status: 'DRAFT',
          },
        }),
      ]));
      expect(mockUpload).toHaveBeenCalledTimes(1);
    });

    it('checks bulk assignment under the same candidate-safe ownership scope', async () => {
      const res = await POST(buildRequest({
        participantType: 'all-active-interpreters',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(200);
      expect((await res.json()).data.createdCount).toBe(2);
      const queries = (prisma.roleplaySession.findFirst as any).mock.calls.map(([query]: [unknown]) => query);
      for (const id of [7, 8]) {
        expect(queries).toEqual(expect.arrayContaining([
          expect.objectContaining({
            where: {
              interpreterId: id,
              recruitmentCandidateId: null,
              status: { in: expect.arrayContaining(['DRAFT', 'INVITED', 'PASSED']) },
            },
          }),
        ]));
      }
    });

    it('still blocks a genuine interpreter-owned previously completed session', async () => {
      (prisma.roleplaySession.findFirst as any).mockResolvedValueOnce({ id: 'already-done', status: 'PASSED' });
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(409);
      expect(prisma.roleplaySession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            interpreterId: 7,
            recruitmentCandidateId: null,
            status: { in: expect.arrayContaining(['PASSED']) },
          },
        }),
      );
      expect(mockUpload).not.toHaveBeenCalled();
    });
  });

  describe('storage error privacy', () => {
    it('does not echo provider exception details or cache failed uploads', async () => {
      const leak = 'https://storage-internal.example?token=secret-provider-token';
      mockUpload.mockResolvedValueOnce({ error: { message: leak } });
      const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await POST(buildRequest({
          participantType: 'candidate',
          participantId: '9',
          scenarios: oneScenario,
          audios: [audioFile()],
        }) as any);
        const body = await res.json();
        expect(res.status).toBe(500);
        expect(body.error).toMatch(/No fue posible subir un audio/);
        expect(JSON.stringify(body)).not.toContain('secret-provider-token');
        expect(JSON.stringify(body)).not.toContain('storage-internal.example');
        expect(JSON.stringify(logs.mock.calls)).not.toContain('secret-provider-token');
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
      } finally {
        logs.mockRestore();
      }
    });
  });

  describe('injected exception names', () => {
    it('never logs an attacker-provided exception name during admin creation', async () => {
      const injected = new Error('Storage unavailable');
      injected.name = 'Bearer PRIVATE_ADMIN_UPLOAD_TOKEN';
      mockUpload.mockRejectedValueOnce(injected);
      const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await POST(buildRequest({
          participantType: 'interpreter', participantId: '7',
          scenarios: oneScenario, audios: [audioFile()],
        }) as any);
        const body = await res.json();
        expect(res.status).toBe(500);
        expect(JSON.stringify(body)).not.toContain('PRIVATE_ADMIN_UPLOAD_TOKEN');
        expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE_ADMIN_UPLOAD_TOKEN');
        expect(logs).toHaveBeenCalledWith('Create Roleplay API Error:', 'Error');
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
      } finally {
        logs.mockRestore();
      }
    });
  });

  describe('failure cleanup', () => {
    it('preserves uploaded base audio when the transaction commits but its acknowledgment fails', async () => {
      const transaction = prisma.$transaction as any;
      const original = transaction.getMockImplementation();
      let attempt = 0;
      transaction.mockImplementation(async (callback: any) => {
        const result = await original(callback);
        attempt++;
        if (attempt === 2) {
          // Simulates a lost connection after COMMIT or an ambiguous
          // post-commit result; the scenarios may already reference the audio.
          throw new Error('synthetic lost transaction acknowledgment');
        }
        return result;
      });

      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(500);
      expect(mockUpload).toHaveBeenCalledOnce();
      expect(prisma.roleplayScenario.create).toHaveBeenCalledOnce();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('defers base-audio cleanup when a transaction fails before the commit outcome is known', async () => {
      const transaction = prisma.$transaction as any;
      const original = transaction.getMockImplementation();
      let attempt = 0;
      transaction.mockImplementation(async (callback: any) => {
        attempt++;
        if (attempt === 2) throw new Error('synthetic database transaction failure');
        return original(callback);
      });

      const res = await POST(buildRequest({
        participantType: 'candidate', participantId: '9',
        scenarios: oneScenario, audios: [audioFile()],
      }) as any);
      expect(res.status).toBe(500);
      expect(mockUpload).toHaveBeenCalledOnce();
      expect(prisma.roleplayScenario.create).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('preserves a newly reserved draft when an audio upload fails', async () => {
      mockUpload.mockResolvedValue({ error: { message: 'boom' } });

      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('No fue posible subir un audio. Revisa el archivo e inténtalo de nuevo.');
      expect(prisma.roleplaySession.create).toHaveBeenCalledTimes(1);
      expect(prisma.roleplaySession.delete).not.toHaveBeenCalled();
      expect(prisma.roleplayScenario.create).not.toHaveBeenCalled();
      expect(prisma.roleplaySession.updateMany).not.toHaveBeenCalled();
      expect(notificationMocks.notifyRoleplayAssignments).not.toHaveBeenCalled();
    });
  });

  describe('create-or-resume guard', () => {
    it('does not publish again or notify when an individual assignment is already invited', async () => {
      (prisma.roleplaySession.findFirst as any).mockResolvedValueOnce({ id: 'sess-old', status: 'INVITED' });
      const res = await POST(buildRequest({ participantType: 'interpreter', participantId: '7', scenarios: oneScenario, audios: [audioFile()] }) as any);
      expect(res.status).toBe(409);
      expect(mockUpload).not.toHaveBeenCalled();
      expect(prisma.roleplaySession.updateMany).not.toHaveBeenCalled();
      expect(notificationMocks.notifyRoleplayAssignments).not.toHaveBeenCalled();
    });

    it('returns 409 before uploading when the participant has an active session', async () => {
      (prisma.roleplaySession.findFirst as any).mockResolvedValueOnce({ id: 'sess-old', status: 'INVITED' });

      const res = await POST(buildRequest({ participantType: 'candidate', participantId: '9', scenarios: oneScenario, audios: [audioFile()] }) as any);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.success).toBe(false);
      expect(body.sessionId).toBe('sess-old');
      expect(body.status).toBe('INVITED');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
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
      expect(mockUpload).toHaveBeenCalledWith(expect.stringMatching(/^base\/sess-d\/upload-[^/]+\/0\.webm$/), expect.anything(), expect.objectContaining({ upsert: false }));
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
      expect(prisma.roleplaySession.updateMany).not.toHaveBeenCalled();
      expect(notificationMocks.notifyRoleplayAssignments).not.toHaveBeenCalled();
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
    it('refuses bulk publication when the source is archived during the transaction', async () => {
      (prisma.roleplaySession.findUnique as any).mockResolvedValue({
        status: 'INVITED', scenarios: [libraryScenario],
      });
      (prisma.roleplayLibraryArchive.findUnique as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ archivedAt: new Date() });
      const res = await POST(buildRequest({
        participantType: 'all-active-interpreters',
        librarySessionId: librarySourceId,
        libraryFingerprint,
      }) as any);
      expect(res.status).toBe(409);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('rejects an archived library snapshot without changing sessions', async () => {
      (prisma.roleplaySession.findUnique as any).mockResolvedValue({
        status: 'INVITED', scenarios: [libraryScenario],
      });
      (prisma.roleplayLibraryArchive.findUnique as any).mockResolvedValue({
        archivedAt: new Date(),
      });
      const res = await POST(buildRequest({
        participantType: 'interpreter', participantId: '7',
        librarySessionId: librarySourceId, libraryFingerprint,
      }) as any);
      expect(res.status).toBe(409);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('reuses private clinical clips and enforces opening despite a false client value', async () => {
      for (const flag of ['ROLEPLAY_BILINGUAL_OPENING_API_ENABLED','ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED','ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED']) vi.stubEnv(flag, 'true');
      try {
        const reference = 'private-base/123e4567-e89b-42d3-a456-426614174000/0.mp3';
        const scenario = { ...libraryScenario, baseAudioUrl: reference };
        vi.mocked(prisma.$queryRaw).mockResolvedValue([{ required: true }]);
        vi.mocked(prisma.roleplaySession.findUnique).mockResolvedValue({ status: 'INVITED', scenarios: [scenario] } as any);
        mockGetBucket.mockImplementation(async (id: string) => ({ error: null, data: {
          id, name: id, public: false, file_size_limit: 15 * 1024 * 1024,
          allowed_mime_types: ['audio/webm','audio/mp4','audio/mpeg', id === 'roleplay-opening-private' ? 'audio/ogg' : 'audio/wav'],
        } }));
        const res = await POST(buildRequest({ participantType: 'all-active-interpreters', librarySessionId: librarySourceId,
          libraryFingerprint: getRoleplaySnapshotHash([scenario]), requiresBilingualOpening: 'false' }) as any);
        expect(res.status).toBe(200);
        expect(mockFrom.mock.calls).toEqual([['roleplay-audio-private']]);
        expect(mockInfo).toHaveBeenCalledWith('base/123e4567-e89b-42d3-a456-426614174000/0.mp3');
        expect(mockUpload).not.toHaveBeenCalled();
        expect(mockGetPublicUrl).not.toHaveBeenCalled();
        expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
        expect(prisma.roleplaySession.update).toHaveBeenCalledWith(expect.objectContaining({
          data: { scenarios: { create: [expect.objectContaining({ baseAudioUrl: reference })] } },
        }));
      } finally { vi.unstubAllEnvs(); }
    });

    it('rejects private library assignment while rollout is disabled', async () => {
      vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', '');
      try {
        const scenario = { ...libraryScenario, baseAudioUrl: 'private-base/123e4567-e89b-42d3-a456-426614174000/0.mp3' };
        vi.mocked(prisma.roleplaySession.findUnique).mockResolvedValue({ status: 'INVITED', scenarios: [scenario] } as any);
        const res = await POST(buildRequest({ participantType: 'all-active-interpreters', librarySessionId: librarySourceId,
          libraryFingerprint: getRoleplaySnapshotHash([scenario]) }) as any);
        expect(res.status).toBe(503);
        expect(mockInfo).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      } finally { vi.unstubAllEnvs(); }
    });

    it('assigns a library source to active interpreters in bulk without a reupload', async () => {
      (prisma.roleplaySession.findUnique as any).mockResolvedValue({
        status: 'INVITED', scenarios: [libraryScenario],
      });

      const res = await POST(buildRequest({
        participantType: 'all-active-interpreters',
        librarySessionId: librarySourceId,
        libraryFingerprint,
      }) as any);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.bulk).toBe(true);
      expect(body.data.createdCount).toBe(2);
      expect(body.data.scenarioCount).toBe(1);
      expect(mockUpload).not.toHaveBeenCalled();
      expect(mockInfo).toHaveBeenCalledWith('base/bulk-source/0.mp3');
      expect(prisma.roleplaySession.create).toHaveBeenCalledTimes(2);
    });

    it('creates a candidate invitation from a library source without uploading', async () => {
      (prisma.roleplaySession.findUnique as any).mockImplementation(({ where }: any) =>
        where.id === librarySourceId
          ? { status: 'INVITED', scenarios: [libraryScenario] }
          : { id: 'sess-1', status: 'DRAFT', updatedAt: draftUpdatedAt }
      );
      const res = await POST(buildRequest({
        participantType: 'candidate', participantId: '9',
        librarySessionId: librarySourceId, libraryFingerprint,
      }) as any);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.inviteLink).toMatch(/^https:\/\/front\.test\/r\/[A-F0-9]{24}$/);
      const inviteCode = (prisma.roleplayAccess.create as any).mock.calls[0][0].data.inviteCode as string;
      expect(body.data.inviteLink).toBe(`https://front.test/r/${inviteCode}`);
      expect(mockUpload).not.toHaveBeenCalled();
      expect(prisma.roleplayAccess.create).toHaveBeenCalledTimes(1);
    });

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
      expect(prisma.roleplaySession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { baseAudioUrl: libraryAudio, baseAudioPath: 'base/bulk-source/0.mp3', status: 'INVITED' },
        })
      );
      expect(notificationMocks.notifyRoleplayAssignments).toHaveBeenCalledWith([{ id: 'sess-1', interpreterId: 7 }]);
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

describe('GET /api/admin/roleplays privacy', () => {
  it('does not list sensitive candidate details when a valid interpreter Bearer accompanies an admin cookie', async () => {
    (validateAction as any).mockResolvedValue(adminAuth);
    (actorFromBearer as any).mockResolvedValue({ userId: 'interpreter-1', role: 'interpreter' });
    const req = new Request('http://localhost/api/admin/roleplays', {
      headers: { Authorization: 'Bearer verified-interpreter-token' },
    });
    const res = await GET(req as any);
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.roleplaySession.findMany).not.toHaveBeenCalled();
  });

  it('lists sessions with a matching explicit admin Bearer and admin cookie', async () => {
    (validateAction as any).mockResolvedValue(adminAuth);
    (actorFromBearer as any).mockResolvedValue({ userId: 'a1', role: 'admin' });
    (prisma.roleplaySession.findMany as any).mockResolvedValue([]);
    const req = new Request('http://localhost/api/admin/roleplays', {
      headers: { Authorization: 'Bearer verified-admin-token' },
    });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    expect(prisma.roleplaySession.findMany).toHaveBeenCalledOnce();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (validateAction as any).mockResolvedValue(adminAuth);
  });

  it('makes the administrator list private and uncacheable', async () => {
    (prisma.roleplaySession.findMany as any).mockResolvedValue([
      { id: 'sess-1', recruitmentCandidate: { email: 'sensitive@example.test' } },
    ]);
    const res = await GET(new Request('http://localhost/api/admin/roleplays') as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0].id).toBe('sess-1');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
  });

  it('does not expose database exception details in an administrator response or logs', async () => {
    (prisma.roleplaySession.findMany as any).mockRejectedValue(
      new Error('postgresql://db-user:secret@internal-database.example/roleplay'),
    );
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(new Request('http://localhost/api/admin/roleplays') as any);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.error).toBe('No fue posible consultar los roleplays.');
      expect(JSON.stringify(body)).not.toContain('secret');
      expect(JSON.stringify(logs.mock.calls)).not.toContain('internal-database.example');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      logs.mockRestore();
    }
  });

  it('does not log a malicious exception name in the administrator list', async () => {
    const injected = new Error('Database unavailable');
    injected.name = 'PRIVATE_DATABASE_CONNECTION_TOKEN';
    (prisma.roleplaySession.findMany as any).mockRejectedValueOnce(injected);
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(new Request('http://localhost/api/admin/roleplays') as any);
      expect(res.status).toBe(500);
      expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE_DATABASE_CONNECTION_TOKEN');
      expect(logs).toHaveBeenCalledWith('Get Roleplays Error:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toBe('Cookie, Authorization');
    } finally {
      logs.mockRestore();
    }
  });

  it('rejects a non-administrator without exposing auth context', async () => {
    (validateAction as any).mockResolvedValue({
      error: 'Access denied for private-user-id',
      code: 'UNAUTHORIZED',
    });
    const res = await GET(new Request('http://localhost/api/admin/roleplays') as any);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.roleplaySession.findMany).not.toHaveBeenCalled();
  });
});
