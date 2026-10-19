/**
 * Presentation mapping for the admin recruitment pipeline.
 *
 * The canonical vocabulary is `RecruitmentApplicationStatus`, persisted on the
 * application and only mutated through `advanceApplication`. There is no
 * legacy fallback: the retired `RecruitmentCandidate.status` column is gone.
 */

import type { RecruitmentApplicationStatus } from '@/lib/prisma-types';

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger';

export interface CandidateStatusDisplay {
  /** The raw status value that produced this label, or 'UNKNOWN' when absent. */
  key: string;
  label: string;
  tone: StatusTone;
  /** True when the value matched a canonical application status. */
  canonical: boolean;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-gray-500/10 text-gray-400',
  info: 'bg-blue-500/10 text-blue-400',
  progress: 'bg-purple-500/10 text-purple-400',
  success: 'bg-green-500/10 text-green-400',
  danger: 'bg-red-500/10 text-red-400',
};

const CANONICAL: Record<RecruitmentApplicationStatus, { label: string; tone: StatusTone }> = {
  APPLIED: { label: 'Aplicante', tone: 'info' },
  PROFILE_PENDING: { label: 'Perfil pendiente', tone: 'info' },
  DOCUMENTS_PENDING: { label: 'Documentos pendientes', tone: 'info' },
  LANGUAGE_PENDING: { label: 'Idioma pendiente', tone: 'info' },
  TECHNICAL_PENDING: { label: 'Prueba técnica pendiente', tone: 'info' },
  INDUCTION_PENDING: { label: 'Inducción pendiente', tone: 'info' },
  ROLEPLAY_PENDING: { label: 'Roleplay pendiente', tone: 'info' },
  ROLEPLAY_IN_PROGRESS: { label: 'Roleplay en curso', tone: 'progress' },
  ROLEPLAY_REVIEW: { label: 'Roleplay en revisión', tone: 'progress' },
  INTERVIEW_PENDING: { label: 'Entrevista pendiente', tone: 'progress' },
  INTERVIEW_SCHEDULED: { label: 'Entrevista agendada', tone: 'progress' },
  INTERVIEW_REVIEW: { label: 'Entrevista en revisión', tone: 'progress' },
  OFFER_PENDING: { label: 'Oferta pendiente', tone: 'progress' },
  OFFER_SENT: { label: 'Oferta enviada', tone: 'progress' },
  OFFER_ACCEPTED: { label: 'Oferta aceptada', tone: 'progress' },
  CONTRACT_PENDING: { label: 'Contrato pendiente', tone: 'progress' },
  BANKING_PENDING: { label: 'Datos bancarios pendientes', tone: 'progress' },
  TECH_SETUP_PENDING: { label: 'Setup técnico pendiente', tone: 'progress' },
  TRAINING_PENDING: { label: 'Capacitación pendiente', tone: 'progress' },
  READY_FOR_ACTIVATION: { label: 'Listo para contratar', tone: 'success' },
  HIRING: { label: 'Contratando', tone: 'success' },
  HIRED: { label: 'Contratado', tone: 'success' },
  REJECTED: { label: 'Rechazado', tone: 'danger' },
  WITHDRAWN: { label: 'Retirado', tone: 'danger' },
  EXPIRED: { label: 'Expirado', tone: 'danger' },
};

const INTERVIEW_STATUSES: readonly RecruitmentApplicationStatus[] = [
  'INTERVIEW_PENDING',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_REVIEW',
];

const HIRED_STATUSES: readonly RecruitmentApplicationStatus[] = ['HIRED'];

const REJECTED_STATUSES: readonly RecruitmentApplicationStatus[] = [
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
];

export function isCanonicalStatus(
  value: string | null | undefined
): value is RecruitmentApplicationStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CANONICAL, value);
}

export function candidateStatusDisplay(
  applicationStatus: string | null | undefined
): CandidateStatusDisplay {
  if (isCanonicalStatus(applicationStatus)) {
    const entry = CANONICAL[applicationStatus];
    return { key: applicationStatus, label: entry.label, tone: entry.tone, canonical: true };
  }
  return {
    key: applicationStatus ?? 'UNKNOWN',
    label: 'Sin estado',
    tone: 'neutral',
    canonical: false,
  };
}

export function statusToneClass(tone: StatusTone): string {
  return TONE_CLASSES[tone];
}

export function isInInterview(applicationStatus: string | null | undefined): boolean {
  return isCanonicalStatus(applicationStatus) && INTERVIEW_STATUSES.includes(applicationStatus);
}

export function isHired(applicationStatus: string | null | undefined): boolean {
  return isCanonicalStatus(applicationStatus) && HIRED_STATUSES.includes(applicationStatus);
}

export function isRejected(applicationStatus: string | null | undefined): boolean {
  return isCanonicalStatus(applicationStatus) && REJECTED_STATUSES.includes(applicationStatus);
}
