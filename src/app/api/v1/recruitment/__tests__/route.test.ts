// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    recruitmentCandidate: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/api-auth', () => ({
  guardApiAuth: vi.fn(),
  resolveApiActor: vi.fn(),
}));

import { POST, GET } from '../route';
import prisma from '@/lib/prisma';
import { guardApiAuth, resolveApiActor } from '@/lib/api-auth';

const adminActor = {
  userId: 'a1',
  email: 'admin@x.com',
  role: 'admin',
  interpreterId: null,
  profileId: 'a1',
};

const validBody = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  telefono: '8095551234',
  pais: 'República Dominicana',
  fuente: 'LinkedIn',
  englishLevel: 'B2',
  speedtestMbps: 50,
  fechaPostulacion: new Date().toISOString(),
};

function postRequest(body: unknown) {
  return new Request('http://localhost/api/v1/recruitment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type TxMock = {
  candidateCreate: ReturnType<typeof vi.fn>;
  applicationCreate: ReturnType<typeof vi.fn>;
  eventCreate: ReturnType<typeof vi.fn>;
};

function installTx(candidateResult: unknown = null): TxMock {
  const tx: TxMock = {
    candidateCreate: vi.fn().mockResolvedValue(candidateResult),
    applicationCreate: vi.fn().mockResolvedValue({ id: 900 }),
    eventCreate: vi.fn().mockResolvedValue({}),
  };
  (prisma.$transaction as any).mockImplementation(async (cb: any) =>
    cb({
      recruitmentCandidate: { create: tx.candidateCreate },
      recruitmentApplication: { create: tx.applicationCreate },
      recruitmentEvent: { create: tx.eventCreate },
    })
  );
  return tx;
}

describe('/api/v1/recruitment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (guardApiAuth as any).mockResolvedValue(null);
    (resolveApiActor as any).mockResolvedValue(adminActor);
  });

  describe('authorization', () => {
    it('GET returns the guard response when unauthenticated', async () => {
      (guardApiAuth as any).mockResolvedValue(
        Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      );

      const res = await GET(new Request('http://localhost/api/v1/recruitment'));

      expect(res.status).toBe(401);
      expect(prisma.recruitmentCandidate.findMany).not.toHaveBeenCalled();
    });

    it('POST returns the guard response for a non-admin', async () => {
      (guardApiAuth as any).mockResolvedValue(
        Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
      );

      const res = await POST(postRequest(validBody));

      expect(res.status).toBe(403);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('POST creation', () => {
    it('creates candidate + APPLIED application + event atomically', async () => {
      const created = { id: 41, name: 'Jane Doe', email: 'jane@example.com' };
      const tx = installTx(created);

      const res = await POST(postRequest(validBody));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(expect.objectContaining({ id: 41, email: 'jane@example.com' }));

      expect(tx.candidateCreate).toHaveBeenCalledTimes(1);
      expect(tx.applicationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            candidateId: 41,
            status: 'APPLIED',
            currentStep: 'APPLICATION',
          }),
        })
      );
      expect(tx.eventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationId: 900,
            eventType: 'APPLICATION_CREATED',
            toStatus: 'APPLIED',
            actorType: 'admin',
            actorId: 'a1',
          }),
        })
      );
    });

    it('rejects an invalid payload with 400 and creates nothing', async () => {
      const res = await POST(postRequest({ ...validBody, email: 'not-an-email' }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 409 on a duplicate email (P2002)', async () => {
      (prisma.$transaction as any).mockRejectedValue({ code: 'P2002' });

      const res = await POST(postRequest(validBody));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(
        expect.objectContaining({ success: false, error: 'Candidate with this email already exists.' })
      );
    });

    it('falls back to the generic message on unexpected errors', async () => {
      (prisma.$transaction as any).mockRejectedValue(new Error('boom'));

      const res = await POST(postRequest(validBody));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual(expect.objectContaining({ success: false }));
    });
  });

  describe('GET listing', () => {
    it('filters candidates by the canonical application status', async () => {
      (prisma.recruitmentCandidate.findMany as any).mockResolvedValue([]);

      const res = await GET(new Request('http://localhost/api/v1/recruitment?status=APPLIED'));

      expect(res.status).toBe(200);
      expect(prisma.recruitmentCandidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ applications: { some: { status: 'APPLIED' } } }),
        })
      );
    });

    it('rejects an unknown status filter with 400 and does not query', async () => {
      const res = await GET(new Request('http://localhost/api/v1/recruitment?status=Aplicante'));

      expect(res.status).toBe(400);
      expect(prisma.recruitmentCandidate.findMany).not.toHaveBeenCalled();
    });
  });
});
