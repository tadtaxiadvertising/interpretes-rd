/**
 * Approved, non-sensitive operational email content. No transport, credentials
 * or recipient data. A future server-side sender must authorize each event
 * and resolve the recipient from persisted application state before sending.
 */
export const RECRUITMENT_EMAIL_KINDS = [
  'application_received',
  'roleplay_ready',
  'interview_pending',
  'review_available',
] as const;

export type RecruitmentEmailKind = (typeof RECRUITMENT_EMAIL_KINDS)[number];

type RecruitmentEmailTemplate = Readonly<{
  label: string;
  subject: string;
  heading: string;
  message: string;
  nextStep: string;
}>;

const templates: Readonly<Record<RecruitmentEmailKind, RecruitmentEmailTemplate>> = {
  application_received: {
    label: 'Postulación recibida',
    subject: 'Recibimos tu postulación | Intérpretes RD',
    heading: '¡Gracias por postularte!',
    message: 'Tu postulación fue recibida. Gracias por tu interés en las oportunidades profesionales de Intérpretes RD.',
    nextStep: 'Accede a tu cuenta para consultar los próximos pasos del proceso.',
  },
  roleplay_ready: {
    label: 'Evaluación técnica disponible',
    subject: 'Tu evaluación técnica está disponible | Intérpretes RD',
    heading: 'Continúa con tu evaluación',
    message: 'Ya puedes consultar tu evaluación técnica en la plataforma.',
    nextStep: 'Accede a tu cuenta y sigue las instrucciones que aparecen en tu proceso de postulación.',
  },
  interview_pending: {
    label: 'Próximo paso: entrevista',
    subject: 'Próximo paso de tu postulación | Intérpretes RD',
    heading: 'Etapa de entrevista',
    message: 'Tu proceso de selección ha avanzado a la etapa de entrevista.',
    nextStep: 'Consulta tu cuenta para conocer las instrucciones. Este mensaje no confirma una fecha ni una hora de entrevista.',
  },
  review_available: {
    label: 'Actualización de evaluación',
    subject: 'Hay una actualización de tu evaluación | Intérpretes RD',
    heading: 'Consulta tu evaluación',
    message: 'Hay una actualización disponible en tu proceso de evaluación.',
    nextStep: 'Accede a tu cuenta para revisar el estado y los próximos pasos.',
  },
};

const footer = 'Intérpretes RD · República Dominicana';

export function recruitmentEmailTemplate(kind: RecruitmentEmailKind): RecruitmentEmailTemplate {
  return templates[kind];
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

/** Output for a future authenticated mail transport; deliberately no dynamic URLs or PII. */
export function renderRecruitmentEmail(kind: RecruitmentEmailKind): {
  subject: string; text: string; html: string;
} {
  const { subject, heading, message, nextStep } = recruitmentEmailTemplate(kind);
  return {
    subject,
    text: [heading, message, nextStep, footer].join('\n\n'),
    html: '<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">'
      + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px;">'
      + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #dbe2ea;">'
      + '<tr><td style="border-top:4px solid #c62828;padding:24px;color:#163b70;font-size:20px;font-weight:bold;">Intérpretes RD</td></tr>'
      + '<tr><td style="padding:0 24px 24px;line-height:1.6;font-size:16px;">'
      + '<h1 style="font-size:24px;color:#163b70;">' + escapeHtml(heading) + '</h1>'
      + '<p>' + escapeHtml(message) + '</p><p>' + escapeHtml(nextStep) + '</p></td></tr>'
      + '<tr><td style="padding:16px 24px;border-top:1px solid #dbe2ea;color:#475569;font-size:13px;">'
      + escapeHtml(footer) + '</td></tr></table></td></tr></table></body></html>',
  };
}
