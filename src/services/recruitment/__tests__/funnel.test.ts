import { describe, it, expect } from 'vitest';
import {
  FUNNEL_STEP_INDUCTION,
  FUNNEL_STEP_ROLEPLAY,
  FUNNEL_STEP_SETUP,
  deriveFunnelStep,
  funnelStepForStatus,
  isApplicationTerminal,
} from '@/services/recruitment/funnel';
import type { RecruitmentApplicationStatus } from '@/lib/prisma-types';

const INDUCTION: RecruitmentApplicationStatus[] = [
  'APPLIED',
  'PROFILE_PENDING',
  'DOCUMENTS_PENDING',
  'LANGUAGE_PENDING',
  'TECHNICAL_PENDING',
  'INDUCTION_PENDING',
];

const ROLEPLAY: RecruitmentApplicationStatus[] = [
  'ROLEPLAY_PENDING',
  'ROLEPLAY_IN_PROGRESS',
  'ROLEPLAY_REVIEW',
];

const SETUP: RecruitmentApplicationStatus[] = [
  'INTERVIEW_PENDING',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_REVIEW',
  'OFFER_PENDING',
  'OFFER_SENT',
  'OFFER_ACCEPTED',
  'CONTRACT_PENDING',
  'BANKING_PENDING',
  'TECH_SETUP_PENDING',
  'TRAINING_PENDING',
  'READY_FOR_ACTIVATION',
  'HIRING',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
];

describe('funnelStepForStatus', () => {
  it.each(INDUCTION)('maps %s to the induction step', (status) => {
    expect(funnelStepForStatus(status)).toBe(FUNNEL_STEP_INDUCTION);
  });

  it.each(ROLEPLAY)('maps %s to the roleplay step', (status) => {
    expect(funnelStepForStatus(status)).toBe(FUNNEL_STEP_ROLEPLAY);
  });

  it.each(SETUP)('maps %s to the setup step', (status) => {
    expect(funnelStepForStatus(status)).toBe(FUNNEL_STEP_SETUP);
  });
});

describe('deriveFunnelStep', () => {
  it('defaults to the induction step without any persisted state', () => {
    expect(deriveFunnelStep(null, null)).toBe(FUNNEL_STEP_INDUCTION);
    expect(deriveFunnelStep(undefined, undefined)).toBe(FUNNEL_STEP_INDUCTION);
  });

  it('uses the application status when no roleplay session exists', () => {
    expect(deriveFunnelStep('APPLIED', null)).toBe(FUNNEL_STEP_INDUCTION);
    expect(deriveFunnelStep('ROLEPLAY_PENDING', null)).toBe(FUNNEL_STEP_ROLEPLAY);
    expect(deriveFunnelStep('INTERVIEW_PENDING', null)).toBe(FUNNEL_STEP_SETUP);
  });

  it('keeps an active roleplay session on step 3 even if the application is ahead', () => {
    expect(deriveFunnelStep('INTERVIEW_PENDING', 'IN_PROGRESS')).toBe(FUNNEL_STEP_ROLEPLAY);
    expect(deriveFunnelStep('APPLIED', 'CREATED')).toBe(FUNNEL_STEP_ROLEPLAY);
  });

  it.each(['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'])(
    'moves to the setup step once the roleplay is %s',
    (roleplayStatus) => {
      expect(deriveFunnelStep('ROLEPLAY_IN_PROGRESS', roleplayStatus)).toBe(FUNNEL_STEP_SETUP);
    }
  );
});

describe('isApplicationTerminal', () => {
  it.each(['HIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as const)('flags %s as terminal', (status) => {
    expect(isApplicationTerminal(status)).toBe(true);
  });

  it('does not flag active applications as terminal', () => {
    expect(isApplicationTerminal('APPLIED')).toBe(false);
    expect(isApplicationTerminal('ROLEPLAY_IN_PROGRESS')).toBe(false);
    expect(isApplicationTerminal('READY_FOR_ACTIVATION')).toBe(false);
  });
});
