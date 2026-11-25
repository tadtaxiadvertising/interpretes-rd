import { notificationPreferenceScope } from '@/lib/notifications/notification-preference-scope';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { NotificationBell } from '@/components/NotificationBell';
import { authorizedNotificationRecipientIds } from '@/lib/notifications/authorized-recipient-ids';
import { loadNavbarNotifications } from '@/lib/notifications/load-navbar-notifications';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import prisma from '@/lib/prisma';
import { CandidateRoleplayAction } from '@/components/recruitment/CandidateRoleplayAction';
import { CandidatePasswordSetup } from '@/components/recruitment/CandidatePasswordSetup';
import CandidateEmailBinding from '@/components/recruitment/CandidateEmailBinding';
import { getCandidateMailboxState } from '@/app/actions/candidate-email-binding';
import { ROLEPLAY_PASS_THRESHOLD } from '@/lib/roleplay/scoring';
import { candidateStatusDisplay } from '@/lib/recruitment/status-display';
import { hasCompleteRoleplaySelfAssessment } from '@/lib/roleplay/self-assessment';

export const dynamic = 'force-dynamic';

const CANDIDATE_STEP_LABELS: Record<string, string> = {
  APPLICATION: 'Postulación',
  PROFILE: 'Perfil',
  DOCUMENTS: 'Documentos',
  LANGUAGE: 'Evaluación de idioma',
  TECHNICAL: 'Prueba técnica',
  INDUCTION: 'Inducción',
  ROLEPLAY: 'Roleplay',
  ROLEPLAY_REVIEW: 'Evaluación de Roleplay',
  INTERVIEW: 'Entrevista',
  DECISION: 'Decisión',
  OFFER: 'Oferta',
  CONTRACT: 'Contrato',
  BANKING: 'Datos bancarios',
  TECH_SETUP: 'Preparación técnica',
  TRAINING: 'Capacitación',
  READY_FOR_ACTIVATION: 'Activación',
  HIRING: 'Incorporación',
};


const STATUS_LABELS: Record<string, string> = {
  APPLIED: 'Solicitud recibida',
  INDUCTION_PENDING: 'Preparación inicial',
  ROLEPLAY_PENDING: 'Roleplay pendiente',
  ROLEPLAY_IN_PROGRESS: 'Roleplay en progreso',
  ROLEPLAY_REVIEW: 'Roleplay en evaluación',
  QA_REVIEW: 'Evaluación de calidad',
  INTERVIEW_PENDING: 'Entrevista pendiente',
  INTERVIEW_SCHEDULED: 'Entrevista programada',
  OFFER_PENDING: 'Preparando oferta',
  OFFER_SENT: 'Oferta enviada',
  CONTRACT_PENDING: 'Contrato pendiente',
  READY_FOR_ACTIVATION: 'Pendiente de activación',
  HIRED: 'Contratación completada',
  REJECTED: 'Proceso finalizado',
  WITHDRAWN: 'Solicitud retirada',
  EXPIRED: 'Solicitud expirada',
};

export default async function CandidatePortalPage() {
  const identity = await resolveCurrentIdentity();
  if (!identity) redirect('/login?next=%2Fcandidate');
  if (identity.role !== 'candidate' || !identity.candidateId) {
    redirect(identity.role === 'admin' ? '/admin' : '/dashboard');
  }

  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { id: identity.candidateId },
    select: {
      name: true,
      email: true,
      applications: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          currentStep: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!candidate) redirect('/postular');

  const application = candidate.applications[0];
  const session = await prisma.roleplaySession.findFirst({
    where: { recruitmentCandidateId: identity.candidateId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      evaluatedAt: true,
      qaScore: { select: { totalScore: true, criticalError: true } },
      evaluatorId: true,
      qaScoreId: true,
      scenarios: {
        select: {
          responses: { select: { sourceAudioUrl: true, selfScore: true } },
        },
      },
    },
  });

  const status = application?.status ?? 'APPLIED';
  const statusLabel = STATUS_LABELS[status] ?? candidateStatusDisplay(status).label;
  const currentStepLabel = application?.currentStep
    ? CANDIDATE_STEP_LABELS[application.currentStep] ?? 'En evaluación'
    : 'Postulación';
  // The same recruitment status gate enforced by startCandidateRoleplay().
  // A stale active session must not expose "Continuar" after rejection,
  // hiring or while an already-submitted attempt awaits QA review.
  const canStartAssignedRoleplay = ['ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS'].includes(status);
  const roleplayActive = canStartAssignedRoleplay && !!session && ['STARTED', 'IN_PROGRESS'].includes(session.status);
  const roleplayFinished = !!session && ['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'].includes(session.status);
  // QA deliberately leaves failed evaluations in ROLEPLAY_REVIEW. The
  // server action can create a new attempt only for a failed QA verdict;
  // expose that existing action instead of trapping candidates on a
  // permanent "finished" screen after a failed assessment.
  const qaFailed = !!session && (
    session.status === 'FAILED' ||
    (session.status === 'EVALUATED' && !!session.qaScore && (
      session.qaScore.criticalError ||
      (session.qaScore.totalScore !== null &&
        Number(session.qaScore.totalScore) < ROLEPLAY_PASS_THRESHOLD)
    ))
  );
  const canRetryRoleplay = status === 'ROLEPLAY_REVIEW' && qaFailed;
  const canRecoverAssessment = status === 'ROLEPLAY_REVIEW' &&
    session?.status === 'SUBMITTED' &&
    session.evaluatorId === null &&
    session.qaScoreId === null &&
    session.scenarios.length > 0 &&
    session.scenarios.every((scenario) =>
      scenario.responses.some((response) => Boolean(response.sourceAudioUrl))
    ) &&
    session.scenarios.some((scenario) =>
      scenario.responses.some((response) =>
        Boolean(response.sourceAudioUrl) &&
        !hasCompleteRoleplaySelfAssessment(response.selfScore)
      )
    );
  const roleplayLabel = !session
    ? 'Aún no iniciado'
    : ({
        DRAFT: 'Preparado para comenzar',
        INVITED: 'Disponible para comenzar',
        STARTED: 'En progreso',
        IN_PROGRESS: 'En progreso',
        SUBMITTED: 'Enviado',
        UNDER_REVIEW: 'En evaluación',
        EVALUATED: 'Evaluado',
        PASSED: 'Aprobado',
        FAILED: 'Requiere revisión o nuevo intento',
      } as Record<string, string>)[session.status] ?? session.status;

  const preferenceScope = notificationPreferenceScope(identity.userId, 'candidate');
  const recipientIds = authorizedNotificationRecipientIds(identity.userId, identity.profileId);
  const notifications = await loadNavbarNotifications(recipientIds, { candidateOnly: true });
  const showEmailBinding = identity.provider === 'supabase' && process.env.OPERATIONAL_EMAIL_BINDING_ENABLED === 'true';
  const mailboxState = showEmailBinding ? await getCandidateMailboxState() : 'unavailable';

  return (
    <main className="theme-candidate min-h-screen bg-slate-950 px-4 py-6 sm:py-10 text-[var(--foreground)]">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Image src="/interpretes-rd-logo.webp" alt="Intérpretes RD" width={58} height={58} className="mb-4 rounded-xl bg-white p-1" />
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">Intérpretes RD · Reclutamiento</p>
            <h1 className="mt-2 text-3xl font-bold">Hola, {candidate.name}</h1>
            <p className="mt-2 text-[var(--text-secondary)]">Este es tu espacio privado para continuar tu postulación.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeSwitcher />
            {recipientIds.length > 0 && <NotificationBell key={preferenceScope} initialNotifications={notifications} preferenceScope={preferenceScope} candidateOnly /> }
            <Link href="/postular" className="rounded-xl bg-[#002d72] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              Continuar mi postulación
            </Link>
          </div>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[var(--text-secondary)]">Estado de tu candidatura</p>
              <h2 className="mt-1 text-2xl font-semibold">{statusLabel}</h2>
            </div>
            <span className="rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-sm font-medium text-[var(--theme-active)]">Candidato</span>
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
            Tu información y tus avances se guardan en tu expediente. Puedes cerrar sesión y regresar más tarde desde cualquier dispositivo.
          </p>
        </section>

        {identity.provider === 'supabase' ? <CandidatePasswordSetup /> : null}
        {showEmailBinding ? <CandidateEmailBinding initialState={mailboxState} /> : null}

        <section className="grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-blue-300/20 bg-blue-300/[0.06] p-6">
            <p className="text-sm font-medium text-[var(--theme-active)]">Evaluación de Roleplay</p>
            <h2 className="mt-2 text-xl font-semibold">{roleplayLabel}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              El Roleplay es parte de tu postulación. Se realiza y evalúa antes de cualquier activación como intérprete.
            </p>
            {roleplayActive && session ? (
              <div className="mt-5"><CandidateRoleplayAction label="Continuar Roleplay" /></div>
            ) : canRetryRoleplay ? (
              <div className="mt-5 space-y-3">
                <p className="text-sm text-[var(--text-secondary)]">Tu evaluación permite realizar otro intento con los escenarios asignados.</p>
                <CandidateRoleplayAction label="Reintentar Roleplay" />
              </div>
            ) : canRecoverAssessment ? (
              <div className="mt-5 space-y-3">
                <p className="text-sm text-[var(--text-secondary)]">Tu grabación está enviada, pero falta completar una autoevaluación antes de la revisión de QA.</p>
                <CandidateRoleplayAction label="Completar autoevaluación" />
              </div>
            ) : !roleplayFinished && canStartAssignedRoleplay ? (
              <div className="mt-5"><CandidateRoleplayAction /></div>
            ) : roleplayFinished ? (
              <p className="mt-5 text-sm text-[var(--text-secondary)]">Tu intento quedó registrado. El equipo de evaluación actualizará aquí el resultado y los próximos pasos.</p>
            ) : (
              <p className="mt-5 text-sm text-[var(--text-secondary)]">El Roleplay se habilitará cuando corresponda según tu etapa de selección.</p>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <p className="text-sm font-medium text-[var(--text-secondary)]">Tu expediente</p>
            <h2 className="mt-2 text-xl font-semibold">Información de candidatura</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-[var(--text-secondary)]">Correo</dt><dd className="min-w-0 break-all text-right text-[var(--foreground)]">{candidate.email}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--text-secondary)]">Solicitud</dt><dd className="min-w-0 break-all text-right text-[var(--foreground)]">{application?.id ?? 'Registrada'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--text-secondary)]">Etapa</dt><dd className="text-right text-[var(--foreground)]">{currentStepLabel}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--text-secondary)]">Última actualización</dt><dd className="text-right text-[var(--foreground)]">{application?.updatedAt.toLocaleDateString('es-DO') ?? '—'}</dd></div>
            </dl>
          </div>
        </section>

        <footer className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-5 text-sm leading-6 text-[var(--text-secondary)]">
          <strong className="text-[var(--candidate-success-text)]">Tu cuenta todavía no es una cuenta operativa de intérprete.</strong>
          {' '}Los datos de intérpretes, operaciones, turnos y pagos permanecen protegidos. El acceso operativo solo se habilita después de completar el proceso y recibir aprobación administrativa.
        </footer>
      </div>
    </main>
  );
}
