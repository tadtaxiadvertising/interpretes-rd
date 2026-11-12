import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Mic2, Waves } from 'lucide-react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { SessionActions } from '@/components/admin/SessionActions';
import { cn, formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

async function getRoleplays() {
  try {
    const data = await prisma.roleplaySession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        interpreter: { select: { id: true, name: true, externalId: true, emailCorporativo: true } },
        recruitmentCandidate: { select: { id: true, name: true, email: true } },
        qaScore: { select: { id: true, totalScore: true, criticalError: true } },
      },
    });
    return { data, error: null as string | null };
  } catch (error) {
    console.error('[ADMIN ROLEPLAYS] Failed to load roleplay sessions:', error);
    return {
      data: [],
      error: 'No se pudieron cargar las sesiones. Comprueba la conexión con la base de datos e inténtalo de nuevo.',
    };
  }
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="glass rounded-2xl border border-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">{label}</p>
        <Icon size={19} className="text-gray-500" />
      </div>
      <p className="mt-3 text-3xl font-bold text-white tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  );
}

export default async function AdminRoleplaysPage() {
  const result = await getRoleplays();
  const roleplays = result.data;

  const activeCount = roleplays.filter((session) =>
    ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS'].includes(session.status),
  ).length;
  const awaitingReviewCount = roleplays.filter((session) =>
    ['SUBMITTED', 'UNDER_REVIEW'].includes(session.status),
  ).length;
  const evaluatedCount = roleplays.filter((session) =>
    ['EVALUATED', 'PASSED', 'FAILED'].includes(session.status),
  ).length;

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-slate-500/10 text-slate-400',
    INVITED: 'bg-amber-500/10 text-amber-400',
    STARTED: 'bg-blue-500/10 text-blue-400',
    IN_PROGRESS: 'bg-blue-500/10 text-blue-400',
    SUBMITTED: 'bg-yellow-500/10 text-yellow-400',
    UNDER_REVIEW: 'bg-blue-500/10 text-blue-400',
    EVALUATED: 'bg-green-500/10 text-green-400',
    PASSED: 'bg-emerald-500/10 text-emerald-400',
    FAILED: 'bg-red-500/10 text-red-400',
    EXPIRED: 'bg-slate-500/10 text-slate-400',
    CANCELLED: 'bg-slate-500/10 text-slate-400',
  };

  const participantTypeColors: Record<string, string> = {
    interpreter: 'bg-blue-500/10 text-blue-400',
    candidate: 'bg-purple-500/10 text-purple-400',
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white">Roleplay Management</h2>
          <p className="text-gray-400">Control de sesiones, participantes y evaluaciones</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/roleplay-audio-jobs"
            className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-semibold flex items-center gap-2 transition-colors border border-white/10"
          >
            <Waves size={18} /> Cola de audio
          </Link>
          <Link
            href="/admin/roleplays/new"
            className="px-5 py-3 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-bold flex items-center gap-2 transition-colors"
          >
            <Mic2 size={20} /> Crear roleplay
          </Link>
        </div>
      </header>

      {result.error && (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-400" />
          <div>
            <p className="font-semibold text-red-300">No fue posible consultar las sesiones</p>
            <p className="mt-1 text-sm text-red-200/80">{result.error}</p>
          </div>
        </div>
      )}

      <section aria-label="Resumen de roleplays" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Sesiones cargadas" value={roleplays.length} detail="Máximo 50 sesiones recientes" icon={Mic2} />
        <MetricCard label="En curso" value={activeCount} detail="Borrador, invitadas o iniciadas" icon={Clock3} />
        <MetricCard label="Pendientes de QA" value={awaitingReviewCount} detail="Entregadas o bajo revisión" icon={AlertTriangle} />
        <MetricCard label="Evaluadas" value={evaluatedCount} detail="Evaluadas, aprobadas o no aprobadas" icon={CheckCircle2} />
      </section>

      <section className="glass rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-white">Sesiones recientes</h3>
            <p className="mt-1 text-xs text-gray-500">Ordenadas por fecha de creación, de más reciente a más antigua</p>
          </div>
          <span className="text-sm text-gray-400">{roleplays.length} registros</span>
        </div>

        {result.error ? (
          <div className="p-12 text-center">
            <p className="text-gray-300">La lista está temporalmente indisponible.</p>
            <p className="mt-2 text-sm text-gray-500">Los indicadores no se mostrarán como cero cuando la consulta falle.</p>
          </div>
        ) : roleplays.length === 0 ? (
          <div className="p-16 text-center">
            <Mic2 size={44} className="mx-auto text-gray-700 mb-4" />
            <p className="font-semibold text-white">Todavía no hay sesiones de roleplay</p>
            <p className="mt-2 text-sm text-gray-500">Crea una sesión para asignar escenarios y audios a un participante.</p>
            <Link href="/admin/roleplays/new" className="mt-5 inline-flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-colors">
              <Mic2 size={18} /> Crear primer roleplay
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                  <th className="py-5 px-6">Sesión</th>
                  <th className="py-5 px-4">Participante</th>
                  <th className="py-5 px-4">Tipo</th>
                  <th className="py-5 px-4">Estado</th>
                  <th className="py-5 px-4">Creación</th>
                  <th className="py-5 px-4">Puntuación QA</th>
                  <th className="py-5 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {roleplays.map((session) => (
                  <tr key={session.id} className="group hover:bg-white/5 transition-colors">
                    <td className="py-5 px-6">
                      <div className="font-mono text-sm text-gray-300">{session.id.slice(0, 12)}…</div>
                      <div className="text-xs text-gray-500 mt-1">{formatDate(session.createdAt)}</div>
                    </td>
                    <td className="py-5 px-4">
                      <p className="font-semibold text-white">{session.interpreter?.name || session.recruitmentCandidate?.name || 'Participante no disponible'}</p>
                      <p className="text-xs text-gray-500 mt-1">{session.interpreter?.emailCorporativo || session.recruitmentCandidate?.email || '—'}</p>
                    </td>
                    <td className="py-5 px-4">
                      <span className={cn('px-3 py-1 rounded-full text-xs font-bold', participantTypeColors[session.interpreter ? 'interpreter' : 'candidate'])}>
                        {session.interpreter ? 'Intérprete' : 'Candidato'}
                      </span>
                    </td>
                    <td className="py-5 px-4">
                      <span className={cn('px-3 py-1 rounded-full text-xs font-bold', statusColors[session.status] ?? 'bg-slate-500/10 text-slate-400')}>
                        {session.status}
                      </span>
                    </td>
                    <td className="py-5 px-4 text-sm text-gray-300">{formatDate(session.createdAt)}</td>
                    <td className="py-5 px-4">
                      {session.qaScore ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-white/5 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', session.qaScore.criticalError ? 'bg-red-500' : (session.qaScore.totalScore || 0) >= 80 ? 'bg-green-500' : (session.qaScore.totalScore || 0) >= 70 ? 'bg-yellow-500' : 'bg-red-500')}
                              style={{ width: `${Math.max(0, Math.min(100, session.qaScore.totalScore || 0))}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold text-white">
                            {session.qaScore.criticalError ? '0 (Crítico)' : `${session.qaScore.totalScore}%`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600">Sin evaluar</span>
                      )}
                    </td>
                    <td className="py-5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/admin/roleplays/${session.id}`} className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-colors border border-white/10 text-sm">
                          Ver evaluación
                        </Link>
                        <SessionActions sessionId={session.id} status={session.status} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="text-xs text-gray-500">
        Vista administrativa limitada a las 50 sesiones más recientes. El historial completo permanece en la base de datos.
      </div>
    </div>
  );
}
