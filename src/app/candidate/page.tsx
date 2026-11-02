import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import prisma from '@/lib/prisma';
import { CandidateRoleplayAction } from '@/components/recruitment/CandidateRoleplayAction';

export const dynamic = 'force-dynamic';

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
    select: { id: true, status: true, submittedAt: true, evaluatedAt: true },
  });

  const status = application?.status ?? 'APPLIED';
  const roleplayActive = !!session && ['STARTED', 'IN_PROGRESS'].includes(session.status);
  const roleplayFinished = !!session && ['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'].includes(session.status);
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

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">Intérpretes RD · Reclutamiento</p>
            <h1 className="mt-2 text-3xl font-bold">Hola, {candidate.name}</h1>
            <p className="mt-2 text-slate-400">Este es tu espacio privado para continuar tu postulación.</p>
          </div>
          <Link href="/postular" className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400">
            Continuar mi postulación
          </Link>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Estado de tu candidatura</p>
              <h2 className="mt-1 text-2xl font-semibold">{STATUS_LABELS[status] ?? status}</h2>
            </div>
            <span className="rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-sm text-blue-200">Candidato</span>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Tu información y tus avances se guardan en tu expediente. Puedes cerrar sesión y regresar más tarde desde cualquier dispositivo.
          </p>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-blue-300/20 bg-blue-300/[0.06] p-6">
            <p className="text-sm font-medium text-blue-200">Evaluación de Roleplay</p>
            <h2 className="mt-2 text-xl font-semibold">{roleplayLabel}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              El Roleplay es parte de tu postulación. Se realiza y evalúa antes de cualquier activación como intérprete.
            </p>
            {roleplayActive && session ? (
              <Link href={`/roleplays/${session.id}`} className="mt-5 inline-flex rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-400">
                Continuar Roleplay
              </Link>
            ) : !roleplayFinished && ['ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS', 'ROLEPLAY_REVIEW'].includes(status) ? (
              <div className="mt-5"><CandidateRoleplayAction /></div>
            ) : roleplayFinished ? (
              <p className="mt-5 text-sm text-slate-300">Tu intento quedó registrado. El equipo de evaluación actualizará aquí el resultado y los próximos pasos.</p>
            ) : (
              <p className="mt-5 text-sm text-slate-400">El Roleplay se habilitará cuando corresponda según tu etapa de selección.</p>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <p className="text-sm font-medium text-slate-400">Tu expediente</p>
            <h2 className="mt-2 text-xl font-semibold">Información de candidatura</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Correo</dt><dd className="text-right text-slate-200">{candidate.email}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Solicitud</dt><dd className="text-right text-slate-200">{application?.id ?? 'Registrada'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Etapa</dt><dd className="text-right text-slate-200">{application?.currentStep ?? 'APPLICATION'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Última actualización</dt><dd className="text-right text-slate-200">{application?.updatedAt.toLocaleDateString('es-DO') ?? '—'}</dd></div>
            </dl>
          </div>
        </section>

        <footer className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-5 text-sm leading-6 text-slate-300">
          <strong className="text-emerald-200">Tu cuenta todavía no es una cuenta operativa de intérprete.</strong>
          {' '}Los datos de intérpretes, operaciones, turnos y pagos permanecen protegidos. El acceso operativo solo se habilita después de completar el proceso y recibir aprobación administrativa.
        </footer>
      </div>
    </main>
  );
}
