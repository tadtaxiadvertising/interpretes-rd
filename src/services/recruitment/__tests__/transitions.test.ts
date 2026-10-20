import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  appFindUnique: vi.fn(),
  appUpdateMany: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    recruitmentApplication: { findUnique: m.appFindUnique },
    $transaction: async (cb: any) =>
      cb({
        recruitmentApplication: {
          findUnique: m.appFindUnique,
          updateMany: m.appUpdateMany,
        },
        recruitmentEvent: { create: m.eventCreate },
      }),
  },
}));

import {
  advanceApplication,
  canTransition,
  isTerminalStatus,
  STATUS_TO_STEP,
  TERMINAL_STATUSES,
  APPLICATION_TRANSITIONS,
  PRE_ACTIVATION_STATUSES,
} from '@/services/recruitment/transitions';

describe('state machine tables', () => {
  it('maps every status to exactly one step', () => {
    expect(Object.keys(STATUS_TO_STEP).sort()).toEqual(
      [
        'APPLIED',
        'BANKING_PENDING',
        'CONTRACT_PENDING',
        'DOCUMENTS_PENDING',
        'EXPIRED',
        'HIRED',
        'HIRING',
        'INDUCTION_PENDING',
        'INTERVIEW_PENDING',
        'INTERVIEW_REVIEW',
        'INTERVIEW_SCHEDULED',
        'LANGUAGE_PENDING',
        'OFFER_ACCEPTED',
        'OFFER_PENDING',
        'OFFER_SENT',
        'PROFILE_PENDING',
        'READY_FOR_ACTIVATION',
        'REJECTED',
        'ROLEPLAY_IN_PROGRESS',
        'ROLEPLAY_PENDING',
        'ROLEPLAY_REVIEW',
        'TECH_SETUP_PENDING',
        'TECHNICAL_PENDING',
        'TRAINING_PENDING',
        'WITHDRAWN',
      ].sort()
    );
  });

  it('never lists a terminal status as a source of transitions', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(APPLICATION_TRANSITIONS[status]).toEqual([]);
      expect(isTerminalStatus(status)).toBe(true);
    }
  });

  it('only lists known statuses as transition targets', () => {
    for (const [from, targets] of Object.entries(APPLICATION_TRANSITIONS)) {
      for (const to of targets) {
        expect(STATUS_TO_STEP[to as keyof typeof STATUS_TO_STEP]).toBeDefined();
        expect(canTransition(from as keyof typeof STATUS_TO_STEP, to as keyof typeof STATUS_TO_STEP)).toBe(true);
      }
    }
  });

  it('includes the live funnel edges APPLIED -> ROLEPLAY_PENDING -> ROLEPLAY_IN_PROGRESS -> ROLEPLAY_REVIEW -> INTERVIEW_PENDING', () => {
    expect(canTransition('APPLIED', 'ROLEPLAY_PENDING')).toBe(true);
    expect(canTransition('ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS')).toBe(true);
    expect(canTransition('ROLEPLAY_IN_PROGRESS', 'ROLEPLAY_REVIEW')).toBe(true);
    expect(canTransition('ROLEPLAY_REVIEW', 'INTERVIEW_PENDING')).toBe(true);
  });

  it('rejects same-status and regressions', () => {
    expect(canTransition('ROLEPLAY_REVIEW', 'ROLEPLAY_REVIEW')).toBe(false);
    expect(canTransition('INTERVIEW_PENDING', 'ROLEPLAY_PENDING')).toBe(false);
    expect(canTransition('HIRED', 'INTERVIEW_PENDING')).toBe(false);
  });

  it('lets every pre-activation status fast-track to READY_FOR_ACTIVATION', () => {
    for (const status of PRE_ACTIVATION_STATUSES) {
      expect(APPLICATION_TRANSITIONS[status]).toContain('READY_FOR_ACTIVATION');
      expect(canTransition(status, 'READY_FOR_ACTIVATION')).toBe(true);
    }
  });

  it('does not let activation or terminal statuses fast-track to READY_FOR_ACTIVATION', () => {
    expect(PRE_ACTIVATION_STATUSES).not.toContain('READY_FOR_ACTIVATION');
    expect(PRE_ACTIVATION_STATUSES).not.toContain('HIRING');
    for (const status of TERMINAL_STATUSES) {
      expect(PRE_ACTIVATION_STATUSES).not.toContain(status);
      expect(canTransition(status, 'READY_FOR_ACTIVATION')).toBe(false);
    }
  });

  it('allows the admin hire edges READY_FOR_ACTIVATION -> HIRED and HIRING -> HIRED', () => {
    expect(canTransition('READY_FOR_ACTIVATION', 'HIRED')).toBe(true);
    expect(canTransition('HIRING', 'HIRED')).toBe(true);
    expect(canTransition('TRAINING_PENDING', 'HIRED')).toBe(false);
  });
});

describe('advanceApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.appFindUnique.mockResolvedValue({ id: 'app-1', status: 'ROLEPLAY_REVIEW', version: 6 });
    m.appUpdateMany.mockResolvedValue({ count: 1 });
    m.eventCreate.mockResolvedValue({ id: 'evt-1' });
  });

  it('advances with the version guard and appends a RecruitmentEvent atomically', async () => {
    const res = await advanceApplication({
      candidateId: 5,
      toStatus: 'INTERVIEW_PENDING',
      eventType: 'ROLEPLAY_PASSED',
      actorType: 'admin',
      actorId: 'admin-1',
    });

    expect(res).toEqual({
      success: true,
      data: {
        applicationId: 'app-1',
        fromStatus: 'ROLEPLAY_REVIEW',
        toStatus: 'INTERVIEW_PENDING',
        version: 7,
        advanced: true,
      },
    });
    expect(m.appUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.appUpdateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 'app-1',
        status: 'ROLEPLAY_REVIEW',
        version: 6,
      },
      data: expect.objectContaining({
        status: 'INTERVIEW_PENDING',
        currentStep: 'INTERVIEW',
        lastActorId: 'admin-1',
      }),
    });
    expect(m.eventCreate).toHaveBeenCalledTimes(1);
    expect(m.eventCreate.mock.calls[0][0]).toEqual({
      data: {
        applicationId: 'app-1',
        eventType: 'ROLEPLAY_PASSED',
        fromStatus: 'ROLEPLAY_REVIEW',
        toStatus: 'INTERVIEW_PENDING',
        actorType: 'admin',
        actorId: 'admin-1',
      },
    });
  });

  it('is idempotent: a retry already in the target status succeeds without writes', async () => {
    m.appFindUnique.mockResolvedValue({ id: 'app-1', status: 'INTERVIEW_PENDING', version: 7 });

    const res = await advanceApplication({
      candidateId: 5,
      toStatus: 'INTERVIEW_PENDING',
      eventType: 'ROLEPLAY_PASSED',
      actorType: 'admin',
      actorId: 'admin-1',
    });

    expect(res).toEqual({
      success: true,
      data: {
        applicationId: 'app-1',
        fromStatus: 'INTERVIEW_PENDING',
        toStatus: 'INTERVIEW_PENDING',
        version: 7,
        advanced: false,
      },
    });
    expect(m.appUpdateMany).not.toHaveBeenCalled();
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when a concurrent transition wins the version race', async () => {
    m.appUpdateMany.mockResolvedValue({ count: 0 });

    const res = await advanceApplication({
      candidateId: 5,
      toStatus: 'INTERVIEW_PENDING',
      eventType: 'ROLEPLAY_PASSED',
      actorType: 'admin',
      actorId: 'admin-1',
    });

    expect(res).toEqual({
      success: false,
      error: 'Concurrent transition detected; application changed while advancing',
      code: 'CONFLICT',
    });
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it('rejects an illegal transition without writing', async () => {
    m.appFindUnique.mockResolvedValue({ id: 'app-1', status: 'INTERVIEW_PENDING', version: 3 });

    const res = await advanceApplication({
      candidateId: 5,
      toStatus: 'ROLEPLAY_PENDING',
      eventType: 'ROLEPLAY_REVIEW_COMPLETED',
      actorType: 'system',
      actorId: 'system',
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.code).toBe('INVALID_STATE');
    expect(m.appUpdateMany).not.toHaveBeenCalled();
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it('honours an extra fromStatuses guard even when the matrix allows the edge', async () => {
    m.appFindUnique.mockResolvedValue({ id: 'app-1', status: 'INDUCTION_PENDING', version: 2 });

    const res = await advanceApplication({
      candidateId: 5,
      fromStatuses: ['ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS', 'ROLEPLAY_REVIEW'],
      toStatus: 'INTERVIEW_PENDING',
      eventType: 'ROLEPLAY_PASSED',
      actorType: 'admin',
      actorId: 'admin-1',
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe('INVALID_STATE');
      expect(res.error).toContain('INDUCTION_PENDING');
    }
    expect(m.appUpdateMany).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a missing application', async () => {
    m.appFindUnique.mockResolvedValue(null);

    const res = await advanceApplication({
      candidateId: 999,
      toStatus: 'ROLEPLAY_PENDING',
      eventType: 'ROLEPLAY_REVIEW_COMPLETED',
      actorType: 'system',
      actorId: 'system',
    });

    expect(res).toEqual({
      success: false,
      error: 'Recruitment application not found',
      code: 'NOT_FOUND',
    });
    expect(m.appUpdateMany).not.toHaveBeenCalled();
  });

  it('validates the target identifier', async () => {
    const none = await advanceApplication({
      toStatus: 'ROLEPLAY_PENDING',
      eventType: 'ROLEPLAY_REVIEW_COMPLETED',
      actorType: 'system',
      actorId: 'system',
    });
    expect(none.success).toBe(false);
    if (!none.success) expect(none.code).toBe('VALIDATION_ERROR');

    const both = await advanceApplication({
      applicationId: 'app-1',
      candidateId: 5,
      toStatus: 'ROLEPLAY_PENDING',
      eventType: 'ROLEPLAY_REVIEW_COMPLETED',
      actorType: 'system',
      actorId: 'system',
    });
    expect(both.success).toBe(false);
    if (!both.success) expect(both.code).toBe('VALIDATION_ERROR');
  });

  it('accepts an explicit applicationId and respects expectedVersion', async () => {
    const res = await advanceApplication({
      applicationId: 'app-1',
      expectedVersion: 99,
      toStatus: 'INTERVIEW_PENDING',
      eventType: 'ROLEPLAY_PASSED',
      actorType: 'admin',
      actorId: 'admin-1',
    });

    expect(res.success).toBe(true);
    expect(m.appFindUnique).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      select: { id: true, status: true, version: true },
    });
    expect(m.appUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'app-1', status: 'ROLEPLAY_REVIEW', version: 99 },
    });
  });
});
