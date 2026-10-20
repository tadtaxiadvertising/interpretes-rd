import { describe, it, expect } from 'vitest';
import {
  candidateStatusDisplay,
  isCanonicalStatus,
  isHired,
  isInInterview,
  isRejected,
  statusToneClass,
  type StatusTone,
} from '@/lib/recruitment/status-display';
import type { RecruitmentApplicationStatus } from '@/lib/prisma-types';

const ALL_STATUSES: RecruitmentApplicationStatus[] = [
  'APPLIED',
  'PROFILE_PENDING',
  'DOCUMENTS_PENDING',
  'LANGUAGE_PENDING',
  'TECHNICAL_PENDING',
  'INDUCTION_PENDING',
  'ROLEPLAY_PENDING',
  'ROLEPLAY_IN_PROGRESS',
  'ROLEPLAY_REVIEW',
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

const TONES: StatusTone[] = ['neutral', 'info', 'progress', 'success', 'danger'];

describe('candidateStatusDisplay', () => {
  it.each(ALL_STATUSES)('resolves a canonical label and tone for %s', (status) => {
    const display = candidateStatusDisplay(status);
    expect(display.canonical).toBe(true);
    expect(display.key).toBe(status);
    expect(display.label.length).toBeGreaterThan(0);
    expect(TONES).toContain(display.tone);
  });

  it('maps a specific canonical status to its label and tone', () => {
    const display = candidateStatusDisplay('HIRED');
    expect(display.canonical).toBe(true);
    expect(display.label).toBe('Contratado');
    expect(display.tone).toBe('success');
  });

  it('neutralizes an unknown status without losing the raw value', () => {
    const display = candidateStatusDisplay('Aplicante');
    expect(display.canonical).toBe(false);
    expect(display.key).toBe('Aplicante');
    expect(display.label).toBe('Sin estado');
    expect(display.tone).toBe('neutral');
  });

  it('handles a candidate with no status at all', () => {
    for (const value of [null, undefined]) {
      const display = candidateStatusDisplay(value);
      expect(display.canonical).toBe(false);
      expect(display.key).toBe('UNKNOWN');
      expect(display.label).toBe('Sin estado');
      expect(display.tone).toBe('neutral');
    }
  });
});

describe('isCanonicalStatus', () => {
  it('accepts canonical application statuses', () => {
    expect(isCanonicalStatus('APPLIED')).toBe(true);
    expect(isCanonicalStatus('HIRED')).toBe(true);
  });

  it('rejects legacy, unknown and empty values', () => {
    expect(isCanonicalStatus('Aplicante')).toBe(false);
    expect(isCanonicalStatus('Contratado')).toBe(false);
    expect(isCanonicalStatus('')).toBe(false);
    expect(isCanonicalStatus(null)).toBe(false);
    expect(isCanonicalStatus(undefined)).toBe(false);
  });
});

describe('statusToneClass', () => {
  it.each(TONES)('returns a tailwind class for the %s tone', (tone) => {
    expect(statusToneClass(tone)).toMatch(/^bg-/);
  });
});

describe('pipeline predicates', () => {
  it('detects interview stages from the canonical status', () => {
    expect(isInInterview('INTERVIEW_PENDING')).toBe(true);
    expect(isInInterview('INTERVIEW_SCHEDULED')).toBe(true);
    expect(isInInterview('INTERVIEW_REVIEW')).toBe(true);
    expect(isInInterview('APPLIED')).toBe(false);
  });

  it('detects hired from the canonical status', () => {
    expect(isHired('HIRED')).toBe(true);
    expect(isHired('READY_FOR_ACTIVATION')).toBe(false);
  });

  it('detects rejected terminals from the canonical status', () => {
    expect(isRejected('REJECTED')).toBe(true);
    expect(isRejected('WITHDRAWN')).toBe(true);
    expect(isRejected('EXPIRED')).toBe(true);
    expect(isRejected('HIRED')).toBe(false);
  });

  it('returns false for legacy, unknown and empty values', () => {
    expect(isHired('Contratado')).toBe(false);
    expect(isInInterview('Entrevista Agendada')).toBe(false);
    expect(isRejected('Rechazado')).toBe(false);
    expect(isHired(null)).toBe(false);
    expect(isInInterview(undefined)).toBe(false);
    expect(isRejected('')).toBe(false);
  });
});
