import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  candidateFindById: vi.fn(),
  candidateCreate: vi.fn(),
  findByCandidateId: vi.fn(),
  appFindById: vi.fn(),
  getOrCreate: vi.fn(),
  advanceStep: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/repositories/recruitment/candidate-repository', () => ({
  candidateRepository: {
    findByEmail: m.findByEmail,
    findById: m.candidateFindById,
    create: m.candidateCreate,
  },
}));

vi.mock('@/repositories/recruitment/application-repository', () => ({
  applicationRepository: {
    findByCandidateId: m.findByCandidateId,
    findById: m.appFindById,
    getOrCreate: m.getOrCreate,
    advanceStep: m.advanceStep,
  },
}));

vi.mock('@/repositories/recruitment/access-repository', () => ({
  accessRepository: { getOrCreate: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: m.transaction },
}));

import {
  createApplication,
  advanceStep,
  hireCandidate,
} from '@/services/recruitment/recruitment-service';

describe('recruitment-service (dormant module)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createApplication', () => {
    it('keys the application on the resolved candidate, not an external id', async () => {
      m.findByEmail.mockResolvedValue({ id: 7, email: 'ana@x.com' });
      m.findByCandidateId.mockResolvedValue(null);
      m.getOrCreate.mockResolvedValue({ id: 'app-1' });

      const res = await createApplication('ana@x.com');

      expect(m.findByCandidateId).toHaveBeenCalledWith(7);
      expect(m.getOrCreate).toHaveBeenCalledWith(7);
      expect(res).toEqual({ success: true, applicationId: 'app-1', candidateId: 7 });
    });

    it('conflicts when an application already exists', async () => {
      m.findByEmail.mockResolvedValue({ id: 7, email: 'ana@x.com' });
      m.findByCandidateId.mockResolvedValue({ id: 'app-0' });

      const res = await createApplication('ana@x.com');

      expect(res.success).toBe(false);
      expect(res.code).toBe('CONFLICT');
    });
  });

  describe('advanceStep', () => {
    it('passes the current status as expected status and forwards a valid event type', async () => {
      m.appFindById.mockResolvedValue({ id: 'app-1', status: 'APPLIED', candidateId: 7 });
      m.advanceStep.mockResolvedValue({ id: 'app-1', status: 'PROFILE_PENDING' });

      const res = await advanceStep('app-1', 'PROFILE_PENDING', 'PROFILE', 'admin', 'u1');

      expect(m.advanceStep).toHaveBeenCalledWith(
        'app-1',
        'APPLIED',
        'PROFILE_PENDING',
        'PROFILE',
        'u1',
        'admin',
        'PROFILE_COMPLETED',
        undefined
      );
      expect(res.success).toBe(true);
    });
  });

  describe('hireCandidate', () => {
    it('creates the interpreter and upserts the profile by email with a uuid id', async () => {
      m.appFindById.mockResolvedValue({ id: 'app-1', status: 'READY_FOR_ACTIVATION', candidateId: 7 });
      m.candidateFindById.mockResolvedValue({ id: 7, name: 'Ana', email: 'ana@x.com' });

      const interpreterCreate = vi.fn().mockResolvedValue({ id: 55 });
      const userProfileUpsert = vi.fn().mockResolvedValue({ id: 'uuid-1' });
      m.transaction.mockImplementation(async (cb: any) =>
        cb({
          interpreter: { findFirst: vi.fn().mockResolvedValue(null), create: interpreterCreate },
          userProfile: { upsert: userProfileUpsert },
          recruitmentApplication: { update: vi.fn() },
          recruitmentEvent: { create: vi.fn() },
        })
      );

      const res = await hireCandidate('app-1', 'admin-1', 'admin');

      expect(interpreterCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ externalId: 'recruitment-candidate-7' }),
        })
      );
      expect(userProfileUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'ana@x.com' },
          create: expect.objectContaining({ interpreterId: 55 }),
        })
      );
      const createArg = (userProfileUpsert.mock.calls[0][0] as any).create;
      expect(createArg.id).not.toBe('app-1');
      expect(createArg.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(res).toEqual({ success: true, interpreterId: 55, userProfileId: 'uuid-1' });
    });
  });
});
