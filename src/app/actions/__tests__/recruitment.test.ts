import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApplicantData } from '@/lib/validators/recruitment';

const m = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  actor: null as any,
  candidateFindUnique: vi.fn(),
  applicationFindUnique: vi.fn(),
  sessionFindFirst: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: m.cookieGet, set: m.cookieSet }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(async () =>
    m.actor ? { user: m.actor, profile: m.actor } : undefined
  ),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    recruitmentCandidate: { findUnique: m.candidateFindUnique },
    recruitmentApplication: { findUnique: m.applicationFindUnique },
    roleplaySession: { findFirst: m.sessionFindFirst },
  },
}));

import prisma from '@/lib/prisma';
import {
  submitApplicationAction,
  getMyApplicationAction,
  acknowledgeInductionAction,
} from '@/app/actions/recruitment';
import { createApplicationRef, APPLICATION_REF_COOKIE } from '@/lib/recruitment/application-ref';

const mockPrisma = prisma as any;

const validApplicant: ApplicantData = {
  name: 'Ana Perez',
  email: 'ANA@Example.com ',
  phone: '+18095551234',
  country: 'República Dominicana',
  englishLevel: 'C1',
  speedtestMbps: 50,
  efsetLink: 'https://www.efset.org/cert/abc123',
};

function makeTx(overrides: Record<string, any> = {}) {
  return {
    recruitmentCandidate: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue({ id: 1 }),
    },
    recruitmentApplication: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'app-1', status: 'APPLIED' }),
      update: vi.fn().mockResolvedValue({ id: 'app-1' }),
    },
    recruitmentEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
    },
    roleplaySession: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  };
}

function existingCandidate(overrides: Record<string, any> = {}) {
  return {
    id: 7,
    name: 'Ana Perez',
    telefono: '+18095551234',
    pais: 'República Dominicana',
    englishLevel: 'C1',
    speedtestMbps: 50,
    notas: '{"efsetLink":"https://www.efset.org/cert/old"}',
    applications: [{ id: 'app-existing', status: 'APPLIED' }],
    ...overrides,
  };
}

describe('submitApplicationAction (create-or-resume with ownership)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = null;
    m.cookieGet.mockReturnValue(undefined);
    process.env.AUTH_SECRET = 'test-secret-for-application-ref';
  });

  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it('creates candidate + application + event for a new applicant and issues the ownership cookie', async () => {
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    expect('candidateId' in result && result.candidateId).toBe(1);
    expect('applicationId' in result && result.applicationId).toBe('app-1');
    expect('alreadyApplied' in result && result.alreadyApplied).toBe(false);
    expect('funnelStep' in result && result.funnelStep).toBe(2);
    expect(tx.recruitmentCandidate.create).toHaveBeenCalledTimes(1);
    expect(tx.recruitmentCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'ana@example.com',
          status: 'Aplicante',
          fuente: 'Web Portal',
        }),
      })
    );
    expect(tx.recruitmentApplication.create).toHaveBeenCalledTimes(1);
    expect(tx.recruitmentEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.recruitmentCandidate.update).not.toHaveBeenCalled();
    expect(m.cookieSet).toHaveBeenCalledTimes(1);
    expect(m.cookieSet.mock.calls[0][0]).toBe(APPLICATION_REF_COOKIE);
    expect(m.cookieSet.mock.calls[0][1]).toContain('1.');
  });

  it('resumes an existing candidate with the ownership cookie: full update, ids returned, cookie re-issued', async () => {
    const tx = makeTx({
      recruitmentCandidate: {
        findUnique: vi.fn().mockResolvedValue(existingCandidate()),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 7 }),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    m.cookieGet.mockReturnValue({ value: createApplicationRef(7, 'app-existing') });

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    expect('candidateId' in result && result.candidateId).toBe(7);
    expect('applicationId' in result && result.applicationId).toBe('app-existing');
    expect('alreadyApplied' in result && result.alreadyApplied).toBe(true);
    expect(tx.recruitmentCandidate.create).not.toHaveBeenCalled();
    expect(tx.recruitmentCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ name: 'Ana Perez', telefono: '+18095551234' }),
      })
    );
    expect(m.cookieSet).toHaveBeenCalledTimes(1);
  });

  it('treats an authenticated account whose email matches as the owner', async () => {
    const tx = makeTx({
      recruitmentCandidate: {
        findUnique: vi.fn().mockResolvedValue(existingCandidate()),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 7 }),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    m.actor = {
      userId: 'u-1',
      email: 'ana@example.com',
      role: 'interpreter',
      interpreterId: null,
      profileId: 'p-1',
    };
    m.candidateFindUnique.mockResolvedValue({
      id: 7,
      applications: [{ id: 'app-existing' }],
    });

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    expect('candidateId' in result && result.candidateId).toBe(7);
    expect(tx.recruitmentCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Ana Perez' }),
      })
    );
    expect(m.cookieSet).toHaveBeenCalledTimes(1);
  });

  it('WITHOUT ownership never overwrites existing PII: only empty fields are filled', async () => {
    const tx = makeTx({
      recruitmentCandidate: {
        findUnique: vi.fn().mockResolvedValue(
          existingCandidate({
            name: 'Nombre Original',
            telefono: '+18095559999',
            pais: null,
            englishLevel: 'B1',
            speedtestMbps: null,
            notas: null,
          })
        ),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 7 }),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    // No ids are disclosed to an unauthenticated third party.
    expect('candidateId' in result).toBe(false);
    expect('applicationId' in result).toBe(false);
    expect('alreadyApplied' in result && result.alreadyApplied).toBe(true);
    expect(m.cookieSet).not.toHaveBeenCalled();

    const updateData = tx.recruitmentCandidate.update.mock.calls[0][0].data;
    expect(updateData.name).toBeUndefined();
    expect(updateData.telefono).toBeUndefined();
    expect(updateData.englishLevel).toBeUndefined();
    expect(updateData.pais).toBe('República Dominicana');
    expect(updateData.speedtestMbps).toBe(50);
    expect(updateData.notas).toContain('efsetLink');
    // No duplicate candidate/application is created.
    expect(tx.recruitmentCandidate.create).not.toHaveBeenCalled();
    expect(tx.recruitmentApplication.create).not.toHaveBeenCalled();
  });

  it('still resumes without a cookie when no existing fields are present (legacy records)', async () => {
    const tx = makeTx({
      recruitmentCandidate: {
        findUnique: vi.fn().mockResolvedValue({
          id: 9,
          name: null,
          telefono: null,
          pais: null,
          englishLevel: null,
          speedtestMbps: null,
          notas: null,
          applications: [{ id: 'app-race', status: 'APPLIED' }],
        }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 9 }),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    expect('candidateId' in result).toBe(false);
    expect(tx.recruitmentCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        data: expect.objectContaining({ name: 'Ana Perez' }),
      })
    );
    expect(tx.recruitmentApplication.create).not.toHaveBeenCalled();
    expect(tx.recruitmentApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'app-race' } })
    );
  });

  it('recovers from a concurrent unique-constraint race (P2002) by resuming', async () => {
    const tx = makeTx({
      recruitmentCandidate: {
        findUnique: vi.fn().mockResolvedValue(existingCandidate()),
        update: vi.fn().mockResolvedValue({ id: 7 }),
        create: vi.fn(),
      },
    });

    const uniqueViolation = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    let call = 0;
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      call += 1;
      if (call === 1) throw uniqueViolation;
      return cb(tx);
    });

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('derives funnel step 4 when the candidate already submitted the roleplay', async () => {
    const tx = makeTx({
      recruitmentCandidate: {
        findUnique: vi.fn().mockResolvedValue(existingCandidate()),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 7 }),
      },
      roleplaySession: {
        findFirst: vi.fn().mockResolvedValue({ status: 'SUBMITTED' }),
        updateMany: vi.fn(),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    expect('funnelStep' in result && result.funnelStep).toBe(4);
  });

  it('rejects malformed input without touching the database', async () => {
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(makeTx()));

    const result = await submitApplicationAction({
      ...validApplicant,
      email: 'not-an-email',
    });

    expect(result.success).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('getMyApplicationAction (recovery)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = null;
    m.cookieGet.mockReturnValue(undefined);
    process.env.AUTH_SECRET = 'test-secret-for-application-ref';
  });

  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it('returns found=false without any ownership proof', async () => {
    const result = await getMyApplicationAction();

    expect(result.success).toBe(true);
    expect(result.data.found).toBe(false);
    expect(m.candidateFindUnique).not.toHaveBeenCalled();
  });

  it('returns found=false for a tampered cookie', async () => {
    m.cookieGet.mockReturnValue({ value: '1.eyJjIjo3fQ.forgedsignature' });

    const result = await getMyApplicationAction();

    expect(result.success).toBe(true);
    expect(result.data.found).toBe(false);
  });

  it('restores name, status and the server-derived step for the owner', async () => {
    m.cookieGet.mockReturnValue({ value: createApplicationRef(7, 'app-existing') });
    m.candidateFindUnique.mockResolvedValue({
      id: 7,
      name: 'Ana Perez',
      email: 'ana@example.com',
      applications: [{ id: 'app-existing', status: 'APPLIED', currentStep: 'APPLICATION' }],
    });
    m.sessionFindFirst.mockResolvedValue(null);

    const result = await getMyApplicationAction();

    expect(result.success).toBe(true);
    expect(result.data.found).toBe(true);
    expect((result.data as any).name).toBe('Ana Perez');
    expect(result.data.funnelStep).toBe(2);
  });

  it('derives step 4 from a submitted roleplay session (client cannot fake progress)', async () => {
    m.cookieGet.mockReturnValue({ value: createApplicationRef(7, 'app-existing') });
    m.candidateFindUnique.mockResolvedValue({
      id: 7,
      name: 'Ana Perez',
      email: 'ana@example.com',
      applications: [{ id: 'app-existing', status: 'ROLEPLAY_REVIEW', currentStep: 'ROLEPLAY' }],
    });
    m.sessionFindFirst.mockResolvedValue({ status: 'UNDER_REVIEW' });

    const result = await getMyApplicationAction();

    expect(result.success).toBe(true);
    expect(result.data.funnelStep).toBe(4);
  });
});

describe('acknowledgeInductionAction (step 2 -> 3, server-validated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = null;
    m.cookieGet.mockReturnValue(undefined);
    process.env.AUTH_SECRET = 'test-secret-for-application-ref';
  });

  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it('rejects anonymous requests without ownership proof', async () => {
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await acknowledgeInductionAction();

    expect(result.success).toBe(false);
    expect(result.code).toBe('UNAUTHORIZED');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('advances APPLIED -> ROLEPLAY_PENDING and records the induction event for the owner', async () => {
    const tx = makeTx({
      recruitmentApplication: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'app-existing',
          candidateId: 7,
          status: 'APPLIED',
          currentStep: 'APPLICATION',
        }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'app-existing' }),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    m.cookieGet.mockReturnValue({ value: createApplicationRef(7, 'app-existing') });

    const result = await acknowledgeInductionAction();

    expect(result.success).toBe(true);
    expect(tx.recruitmentApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-existing' },
        data: expect.objectContaining({ status: 'ROLEPLAY_PENDING', currentStep: 'ROLEPLAY' }),
      })
    );
    expect(tx.recruitmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'INDUCTION_COMPLETED', toStatus: 'ROLEPLAY_PENDING' }),
      })
    );
  });

  it('is idempotent when the application already advanced past APPLICATION', async () => {
    const tx = makeTx({
      recruitmentApplication: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'app-existing',
          candidateId: 7,
          status: 'ROLEPLAY_PENDING',
          currentStep: 'ROLEPLAY',
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    m.cookieGet.mockReturnValue({ value: createApplicationRef(7, 'app-existing') });

    const result = await acknowledgeInductionAction();

    expect(result.success).toBe(true);
    expect(tx.recruitmentApplication.update).not.toHaveBeenCalled();
    expect(tx.recruitmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects when the cookie points at an application of a different candidate', async () => {
    const tx = makeTx({
      recruitmentApplication: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'app-existing',
          candidateId: 999,
          status: 'APPLIED',
          currentStep: 'APPLICATION',
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    m.cookieGet.mockReturnValue({ value: createApplicationRef(7, 'app-existing') });

    const result = await acknowledgeInductionAction();

    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
    expect(tx.recruitmentApplication.update).not.toHaveBeenCalled();
  });
});
