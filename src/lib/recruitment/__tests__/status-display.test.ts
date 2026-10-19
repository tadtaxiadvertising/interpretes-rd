import { describe, it, expect } from 'vitest';
import {
  candidateStatusDisplay,
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
    const display = candidateStatusDisplay(status, 'Aplicante');
    expect(display.canonical).toBe(true);
    expect(display.key).toBe(status);
    expect(display.label.length).toBeGreaterThan(0);
    expect(TONES).toContain(display.tone);
  });

  it('lets the canonical status override a conflicting legacy status', () => {
    const display = candidateStatusDisplay('HIRED', 'Aplicante');
    expect(display.canonical).toBe(true);
    expect(display.label).toBe('Contratado');
    expect(display.tone).toBe('success');
  });

  it('falls back to the legacy status when there is no application', () => {
    const display = candidateStatusDisplay(null, 'Entrevista Agendada');
    expect(display.canonical).toBe(false);
    expect(display.label).toBe('Entrevista agendada');
    expect(display.tone).toBe('progress');
  });

  it('neutralizes an unknown legacy status without losing the raw value', () => {
    const display = candidateStatusDisplay(null, 'Estado Desconocido');
    expect(display.canonical).toBe(false);
    expect(display.label).toBe('Estado Desconocido');
    expect(display.tone).toBe('neutral');
  });

  it('handles a candidate with no status at all', () => {
    const display = candidateStatusDisplay(undefined, undefined);
    expect(display.canonical).toBe(false);
    expect(display.label).toBe('Sin estado');
    expect(display.tone).toBe('neutral');
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

  it('never lets legacy values override a canonical status', () => {
    expect(isHired('APPLIED', 'Contratado')).toBe(false);
    expect(isRejected('ROLEPLAY_IN_PROGRESS', 'Rechazado')).toBe(false);
    expect(isInInterview('HIRED', 'Entrevista Agendada')).toBe(false);
  });

  it('uses the legacy status only as a fallback', () => {
    expect(isInInterview(null, 'Entrevista Agendada')).toBe(true);
    expect(isHired(null, 'Contratado')).toBe(true);
    expect(isRejected(null, 'Rechazado')).toBe(true);
    expect(isHired(undefined, 'Aplicante')).toBe(false);
  });
});
