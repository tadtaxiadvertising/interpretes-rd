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

const PAGE_SIZE = 20;
const VALID_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;

function audioJobsHref(status: string, page: number) {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin/roleplay-audio-jobs${query ? `?${query}` : ''}`;
}

async function getAudioJobs(status: string, page: number) {
  try {
    const where = status === 'all' ? {} : { status: status as typeof VALID_STATUSES[number] };
    const [data, total, groups, failedAttempts] = await Promise.all([
      prisma.roleplayAudioJob.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          session: { select: { id: true, status: true, interpreterId: true, recruitmentCandidateId: true } },
          scenario: { select: { id: true, title: true, order: true } },
        },
      }),
      prisma.roleplayAudioJob.count({ where }),
      prisma.roleplayAudioJob.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.roleplayAudioJob.findMany({
        where: { status: 'FAILED' },
        select: { attempts: true, maxAttempts: true },
      }),
    ]);
    const counts = Object.fromEntries(groups.map((entry) => [entry.status, entry._count._all])) as Record<string, number>;
    const exhaustedCount = failedAttempts.filter((job) => job.attempts >= job.maxAttempts).length;
    return { data, total, counts, exhaustedCount, error: null as string | null };
  } catch (error) {
    console.error('[ADMIN ROLEPLAY AUDIO JOBS] Failed to load audio queue:', error);
    return {
      data: [],
      total: 0,
      counts: {} as Record<string, number>,
      exhaustedCount: 0,
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
  value: number | null;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="glass rounded-2xl border border-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">{label}</p>
        <Icon size={19} className="text-gray-500" />
      </div>
      <p className="mt-3 text-3xl font-bold text-white tabular-nums">{value ?? '—'}</p>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );
}

export default async function AdminRoleplayAudioJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = VALID_STATUSES.find((value) => value === params.status) ?? 'all';
  const rawPage = Number(params.page);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1;
  const result = await getAudioJobs(status, page);
  const jobs = result.data;
  const count = (name: string) => result.counts[name] ?? 0;
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

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
        <QueueMetric label="Pendientes" value={result.error ? null : count('PENDING')} hint="Esperando procesamiento" icon={Clock3} />
        <QueueMetric label="Procesando" value={result.error ? null : count('PROCESSING')} hint="Trabajos reclamados por un worker" icon={Waves} />
        <QueueMetric label="Completados" value={result.error ? null : count('COMPLETED')} hint="Conversión finalizada" icon={CheckCircle2} />
        <QueueMetric label="Fallidos" value={result.error ? null : count('FAILED')} hint={result.error ? 'No disponible' : `${result.exhaustedCount} agotaron sus intentos`} icon={AlertTriangle} />
      </section>

      <section aria-label="Filtrar trabajos de audio" className="glass rounded-2xl border border-white/5 p-5">
        <form action="/admin/roleplay-audio-jobs" method="get" className="flex flex-wrap gap-3">
          <label htmlFor="audio-status" className="sr-only">Estado del trabajo</label>
          <select id="audio-status" name="status" defaultValue={status}
            className="min-w-56 flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white">
            <option value="all">Todos los estados</option>
            {VALID_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="submit" className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500">Filtrar</button>
          {status !== 'all' && (
            <Link href="/admin/roleplay-audio-jobs" className="rounded-xl border border-white/10 px-5 py-3 text-sm text-gray-300 hover:bg-white/5">Limpiar</Link>
          )}
        </form>
      </section>

      <section className="glass rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-white">Trabajos recientes</h3>
            <p className="mt-1 text-xs text-gray-500">Historial paginado de 20 trabajos, ordenados por creación</p>
          </div>
          <span className="text-sm text-gray-400">{result.error ? 'Datos no disponibles' : `${result.total} trabajos coincidentes`}</span>
        </div>

        {result.error ? (
          <div className="p-12 text-center text-gray-400">La cola está temporalmente indisponible. No se mostrarán datos vacíos como si fueran un estado válido.</div>
        ) : page > totalPages ? (
          <div className="p-12 text-center">
            <p className="font-semibold text-white">Página fuera del rango disponible.</p>
            <Link href={audioJobsHref(status, totalPages)} className="mt-3 inline-block text-blue-300 hover:text-blue-200">Volver al historial disponible</Link>
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-16 text-center">
            <Waves size={42} className="mx-auto text-gray-700 mb-4" />
            <p className="font-semibold text-white">{status === 'all' ? 'No hay trabajos de audio registrados' : 'No hay trabajos con este estado'}</p>
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
                    <td className="py-4 px-4 font-mono text-xs">
                      <Link href={`/admin/roleplays/${job.session.id}`} className="text-blue-300 hover:text-blue-200 underline underline-offset-2">
                        {job.session.id.slice(0, 12)}…
                      </Link>
                    </td>
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

      {!result.error && result.total > 0 && (
        <nav aria-label="Paginación de trabajos de audio" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 p-4">
          <p className="text-sm text-gray-400">
            Página {Math.min(page, totalPages)} de {totalPages} · {result.total} trabajos coincidentes
          </p>
          <div className="flex gap-2">
            {page > 1 && page <= totalPages && (
              <Link href={audioJobsHref(status, page - 1)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10">Anterior</Link>
            )}
            {page < totalPages && (
              <Link href={audioJobsHref(status, page + 1)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10">Siguiente</Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
