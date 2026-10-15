import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitApplicationAction } from '@/app/actions/recruitment';
import type { ApplicantData } from '@/lib/validators/recruitment';

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

import prisma from '@/lib/prisma';

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
      create: vi.fn().mockResolvedValue({ id: 'app-1', status: 'APPLIED' }),
      update: vi.fn().mockResolvedValue({ id: 'app-1' }),
    },
    recruitmentEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
    },
    ...overrides,
  };
}

describe('submitApplicationAction (create-or-resume)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates candidate + application + event for a new applicant', async () => {
    const tx = makeTx();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    expect(result.candidateId).toBe(1);
    expect(result.applicationId).toBe('app-1');
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
  });

  it('resumes an existing candidate and does NOT create a duplicate', async () => {
    const tx = makeTx({
      recruitmentCandidate: {
        findUnique: vi.fn().mockResolvedValue({
          id: 7,
          applications: [{ id: 'app-existing' }],
        }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 7 }),
      },
    });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await submitApplicationAction(validApplicant);

    expect(result.success).toBe(true);
    expect(result.candidateId).toBe(7);
    expect(result.applicationId).toBe('app-existing');
    expect(tx.recruitmentCandidate.create).not.toHaveBeenCalled();
    expect(tx.recruitmentCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ name: 'Ana Perez' }),
      })
    );
    expect(tx.recruitmentApplication.create).not.toHaveBeenCalled();
    expect(tx.recruitmentApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'app-existing' } })
    );
  });

  it('recovers from a concurrent unique-constraint race (P2002) by resuming', async () => {
    const tx = makeTx({
      recruitmentCandidate: {
        findUnique: vi.fn().mockResolvedValue({
          id: 9,
          applications: [{ id: 'app-race' }],
        }),
        update: vi.fn().mockResolvedValue({ id: 9 }),
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
    expect(result.candidateId).toBe(9);
    expect(result.applicationId).toBe('app-race');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
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
