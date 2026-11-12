import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock3, Waves } from 'lucide-react';
import { RequeueButton } from './RequeueButton';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-400',
  PROCESSING: 'bg-blue-500/10 text-blue-400',
  COMPLETED: 'bg-green-500/10 text-green-400',
  FAILED: 'bg-red-500/10 text-red-400',
};

async function getAudioJobs() {
  try {
    const data = await prisma.roleplayAudioJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        session: { select: { id: true, status: true, interpreterId: true, recruitmentCandidateId: true } },
        scenario: { select: { id: true, title: true, order: true } },
      },
    });
    return { data, error: null as string | null };
  } catch (error) {
    console.error('[ADMIN ROLEPLAY AUDIO JOBS] Failed to load audio queue:', error);
    return {
      data: [],
      error: 'No se pudo consultar la cola de audio. Verifica la conexión con la base de datos e inténtalo nuevamente.',
    };
  }
}

function QueueMetric({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="glass rounded-2xl border border-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">{label}</p>
        <Icon size={19} className="text-gray-500" />
      </div>
      <p className="mt-3 text-3xl font-bold text-white tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );
}

export default async function AdminRoleplayAudioJobsPage() {
  const result = await getAudioJobs();
  const jobs = result.data;
  const pendingCount = jobs.filter((job) => job.status === 'PENDING').length;
  const processingCount = jobs.filter((job) => job.status === 'PROCESSING').length;
  const failedCount = jobs.filter((job) => job.status === 'FAILED').length;
  const completedCount = jobs.filter((job) => job.status === 'COMPLETED').length;
  const exhaustedCount = jobs.filter((job) => job.status === 'FAILED' && job.attempts >= job.maxAttempts).length;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white">Cola de audio Roleplay</h2>
          <p className="text-gray-400">Supervisión de conversión, reintentos y fallos de procesamiento</p>
        </div>
        <Link
          href="/admin/roleplays"
          className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-colors border border-white/10"
        >
          Volver a Roleplay Management
        </Link>
      </header>

      {result.error && (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-400" />
          <div>
            <p className="font-semibold text-red-300">No fue posible consultar la cola</p>
            <p className="mt-1 text-sm text-red-200/80">{result.error}</p>
          </div>
        </div>
      )}

      <section aria-label="Estado de la cola de audio" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <QueueMetric label="Pendientes" value={pendingCount} hint="Esperando procesamiento" icon={Clock3} />
        <QueueMetric label="Procesando" value={processingCount} hint="Trabajos reclamados por un worker" icon={Waves} />
        <QueueMetric label="Completados" value={completedCount} hint="Conversión finalizada" icon={CheckCircle2} />
        <QueueMetric label="Fallidos" value={failedCount} hint={`${exhaustedCount} agotaron sus intentos`} icon={AlertTriangle} />
      </section>

      <section className="glass rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-white">Trabajos recientes</h3>
            <p className="mt-1 text-xs text-gray-500">Máximo 100 trabajos, ordenados por creación</p>
          </div>
          <span className="text-sm text-gray-400">{jobs.length} registros</span>
        </div>

        {result.error ? (
          <div className="p-12 text-center text-gray-400">La cola está temporalmente indisponible. No se mostrarán datos vacíos como si fueran un estado válido.</div>
        ) : jobs.length === 0 ? (
          <div className="p-16 text-center">
            <Waves size={42} className="mx-auto text-gray-700 mb-4" />
            <p className="font-semibold text-white">No hay trabajos de audio registrados</p>
            <p className="mt-2 text-sm text-gray-500">Los trabajos aparecerán aquí cuando se envíen respuestas que requieran procesamiento.</p>
            <p className="mt-1 text-xs text-gray-600">Una cola vacía no confirma por sí sola que el worker esté operativo.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                  <th className="py-4 px-6">Trabajo</th>
                  <th className="py-4 px-4">Estado</th>
                  <th className="py-4 px-4">Intentos</th>
                  <th className="py-4 px-4">Escenario</th>
                  <th className="py-4 px-4">Sesión</th>
                  <th className="py-4 px-4">Último error</th>
                  <th className="py-4 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-4 px-6 font-mono text-xs text-gray-400">{job.id.slice(0, 12)}…</td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[job.status] ?? 'bg-slate-500/10 text-slate-400'}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-300">{job.attempts}/{job.maxAttempts}</td>
                    <td className="py-4 px-4 text-sm text-gray-300">{job.scenario.title} (#{job.scenario.order})</td>
                    <td className="py-4 px-4 font-mono text-xs text-gray-400">{job.session.id.slice(0, 12)}…</td>
                    <td className="py-4 px-4 text-xs text-red-300 max-w-xs truncate" title={job.lastError ?? ''}>
                      {job.lastError ?? '—'}
                    </td>
                    <td className="py-4 px-4 text-right">
                      {job.status === 'FAILED' ? <RequeueButton jobId={job.id} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
