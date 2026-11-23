import Link from 'next/link';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { candidateStatusDisplay } from '@/lib/recruitment/status-display';

type RecruitmentFollowUpProps = {
  terminal?: boolean;
  applicationStatus?: string | null;
};

/**
 * This is deliberately a tracking screen, not an interview scheduler.
 * Interview slots are not configured in the public recruitment flow.
 * The authenticated candidate portal owns status/next-action visibility.
 */
export function RecruitmentFollowUp({ terminal = false, applicationStatus }: RecruitmentFollowUpProps) {
  const status = candidateStatusDisplay(applicationStatus);
  const Icon = terminal ? CheckCircle2 : ClipboardCheck;

  return (
    <section className="space-y-5 py-6 text-center" aria-label="Seguimiento de candidatura">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-[#1764bf]">
        <Icon size={30} aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold text-slate-900">
        {terminal ? 'Tu proceso de selección ha finalizado' : 'Consulta el avance de tu postulación'}
      </h2>
      {terminal ? (
        <>
          <p className="text-sm leading-6 text-slate-600">
            Estado registrado: <strong>{status.label}</strong>. Puedes revisar tu expediente en el portal del candidato.
          </p>
          <p className="text-sm text-slate-600">
            Si necesitas una aclaración, utiliza los canales oficiales de Intérpretes RD.
          </p>
        </>
      ) : (
        <>
          <p className="mx-auto max-w-xl text-sm leading-6 text-slate-600">
            Tu evaluación de roleplay ya cuenta con un registro. El estado de revisión y los próximos
            pasos de tu candidatura se consultan en el portal del candidato.
          </p>
          <p className="mx-auto max-w-xl text-sm leading-6 text-slate-600">
            No hay un calendario de entrevistas disponible en esta pantalla. Una entrevista o
            incorporación depende de la revisión y aprobación correspondiente.
          </p>
        </>
      )}
      <Link
        href="/candidate"
        className="mx-auto inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1764bf] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1764bf]"
      >
        Ver mi candidatura
      </Link>
      <p className="text-xs leading-5 text-slate-500">
        Inicia sesión con el correo de tu postulación. Si recibiste un enlace de activación,
        utilízalo antes de entrar.
      </p>
    </section>
  );
}
