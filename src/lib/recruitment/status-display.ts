/**
 * Presentation mapping for the admin recruitment pipeline.
 *
 * The canonical vocabulary is `RecruitmentApplicationStatus` (persisted on the
 * application). The legacy `RecruitmentCandidate.status` string is only a
 * fallback for rows created before the application table existed, and must
 * never override a canonical status.
 */

import type { RecruitmentApplicationStatus } from '@/lib/prisma-types';

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger';

export interface CandidateStatusDisplay {
  /** The raw status value that produced this label. */
  key: string;
  label: string;
  tone: StatusTone;
  /** True when the label came from the canonical application status. */
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

const LEGACY: Record<string, { label: string; tone: StatusTone }> = {
  Aplicante: { label: 'Aplicante', tone: 'info' },
  'Entrevista Agendada': { label: 'Entrevista agendada', tone: 'progress' },
  Contratado: { label: 'Contratado', tone: 'success' },
  Rechazado: { label: 'Rechazado', tone: 'danger' },
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

function isCanonicalStatus(value: string): value is RecruitmentApplicationStatus {
  return Object.prototype.hasOwnProperty.call(CANONICAL, value);
}

export function candidateStatusDisplay(
  applicationStatus: string | null | undefined,
  legacyStatus: string | null | undefined
): CandidateStatusDisplay {
  if (applicationStatus && isCanonicalStatus(applicationStatus)) {
    const entry = CANONICAL[applicationStatus];
    return { key: applicationStatus, label: entry.label, tone: entry.tone, canonical: true };
  }

  const legacy = legacyStatus ? LEGACY[legacyStatus] : undefined;
  return {
    key: legacyStatus ?? 'UNKNOWN',
    label: legacy?.label ?? legacyStatus ?? 'Sin estado',
    tone: legacy?.tone ?? 'neutral',
    canonical: false,
  };
}

export function statusToneClass(tone: StatusTone): string {
  return TONE_CLASSES[tone];
}

export function isInInterview(
  applicationStatus: string | null | undefined,
  legacyStatus?: string | null
): boolean {
  if (applicationStatus && isCanonicalStatus(applicationStatus)) {
    return INTERVIEW_STATUSES.includes(applicationStatus);
  }
  return legacyStatus === 'Entrevista Agendada';
}

export function isHired(
  applicationStatus: string | null | undefined,
  legacyStatus?: string | null
): boolean {
  if (applicationStatus && isCanonicalStatus(applicationStatus)) {
    return HIRED_STATUSES.includes(applicationStatus);
  }
  return legacyStatus === 'Contratado';
}

export function isRejected(
  applicationStatus: string | null | undefined,
  legacyStatus?: string | null
): boolean {
  if (applicationStatus && isCanonicalStatus(applicationStatus)) {
    return REJECTED_STATUSES.includes(applicationStatus);
  }
  return legacyStatus === 'Rechazado';
}
