import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Mic2, Waves, Library } from 'lucide-react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { SessionActions } from '@/components/admin/SessionActions';
import { cn, formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const FILTERABLE_STATUSES = [
  'DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED',
  'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED',
] as const;

type RoleplaySearchParams = {
  search?: string;
  status?: string;
  participantType?: string;
  page?: string;
};

function parseRoleplayFilters(params: RoleplaySearchParams) {
  const search = (params.search ?? '').trim().slice(0, 100);
  const status = FILTERABLE_STATUSES.find((value) => value === params.status) ?? 'all';
  const participantType = params.participantType === 'candidate' || params.participantType === 'interpreter'
    ? params.participantType
    : 'all';
  const parsedPage = Number(params.page);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;
  return { search, status, participantType, page };
}

function roleplayPageHref(filters: ReturnType<typeof parseRoleplayFilters>, page: number) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.participantType !== 'all') params.set('participantType', filters.participantType);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin/roleplays${query ? `?${query}` : ''}`;
}

async function getRoleplays(filters: ReturnType<typeof parseRoleplayFilters>) {
  const where: Prisma.RoleplaySessionWhereInput = {};
  if (filters.status !== 'all') where.status = filters.status;
  if (filters.participantType === 'interpreter') where.interpreterId = { not: null };
  if (filters.participantType === 'candidate') where.recruitmentCandidateId = { not: null };
  if (filters.search) {
    where.OR = [
      { interpreter: { name: { contains: filters.search, mode: 'insensitive' } } },
      { interpreter: { emailCorporativo: { contains: filters.search, mode: 'insensitive' } } },
      { interpreter: { externalId: { contains: filters.search, mode: 'insensitive' } } },
      { recruitmentCandidate: { name: { contains: filters.search, mode: 'insensitive' } } },
      { recruitmentCandidate: { email: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }
  try {
    const [data, total, statusGroups] = await Promise.all([
      prisma.roleplaySession.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          interpreter: { select: { id: true, name: true, externalId: true, emailCorporativo: true } },
          recruitmentCandidate: { select: { id: true, name: true, email: true } },
          qaScore: { select: { id: true, totalScore: true, criticalError: true } },
        },
      }),
      prisma.roleplaySession.count({ where }),
      prisma.roleplaySession.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(statusGroups.map((entry) => [entry.status, entry._count._all])) as Record<string, number>;
    return { data, total, counts, error: null as string | null };
  } catch (error) {
    console.error('[ADMIN ROLEPLAYS] Failed to load roleplay sessions:', error);
    return {
      data: [],
      total: 0,
      counts: {} as Record<string, number>,
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
  value: number | null;
  detail: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="glass rounded-2xl border border-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">{label}</p>
        <Icon size={19} className="text-gray-500" />
      </div>
      <p className="mt-3 text-3xl font-bold text-white tabular-nums">{value ?? '—'}</p>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  );
}

export default async function AdminRoleplaysPage({
  searchParams,
}: {
  searchParams: Promise<RoleplaySearchParams>;
}) {
  const filters = parseRoleplayFilters(await searchParams);
  const result = await getRoleplays(filters);
  const roleplays = result.data;
  const count = (status: string) => result.counts[status] ?? 0;
  const activeCount = ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS'].reduce((total, status) => total + count(status), 0);
  const awaitingReviewCount = count('SUBMITTED') + count('UNDER_REVIEW');
  const evaluatedCount = count('EVALUATED') + count('PASSED') + count('FAILED');
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const currentPage = Math.min(filters.page, totalPages);

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
            href="/admin/roleplays/library"
            className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-semibold flex items-center gap-2 transition-colors border border-white/10"
          >
            <Library size={18} /> Biblioteca
          </Link>
          <Link
            href="/admin/roleplays/queue"
            className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-semibold flex items-center gap-2 transition-colors border border-white/10"
          >
            <CheckCircle2 size={18} /> Evaluación QA
          </Link>
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
        <MetricCard label="Sesiones" value={result.error ? null : Object.values(result.counts).reduce((sum, value) => sum + value, 0)} detail="Total histórico, sin limitar a la página" icon={Mic2} />
        <MetricCard label="En curso" value={result.error ? null : activeCount} detail="Borrador, invitadas o iniciadas" icon={Clock3} />
        <MetricCard label="Pendientes de QA" value={result.error ? null : awaitingReviewCount} detail="Entregadas o bajo revisión" icon={AlertTriangle} />
        <MetricCard label="Evaluadas" value={result.error ? null : evaluatedCount} detail="Evaluadas, aprobadas o no aprobadas" icon={CheckCircle2} />
      </section>

      <section aria-label="Filtros de roleplays" className="glass rounded-2xl border border-white/5 p-5">
        <form action="/admin/roleplays" method="get" className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,200px)_minmax(0,180px)_auto]">
          <label className="sr-only" htmlFor="roleplay-search">Buscar participante</label>
          <input id="roleplay-search" name="search" type="search" maxLength={100}
            placeholder="Buscar nombre, correo o ID de intérprete"
            defaultValue={filters.search}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white placeholder:text-gray-500" />
          <label className="sr-only" htmlFor="roleplay-status">Estado</label>
          <select id="roleplay-status" name="status" defaultValue={filters.status}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white">
            <option value="all">Todos los estados</option>
            {FILTERABLE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <label className="sr-only" htmlFor="roleplay-participant">Tipo de participante</label>
          <select id="roleplay-participant" name="participantType" defaultValue={filters.participantType}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white">
            <option value="all">Todos los participantes</option>
            <option value="interpreter">Intérpretes</option>
            <option value="candidate">Candidatos</option>
          </select>
          <button type="submit" className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500">
            Aplicar filtros
          </button>
        </form>
        {(filters.search || filters.status !== 'all' || filters.participantType !== 'all') && (
          <Link href="/admin/roleplays" className="mt-3 inline-block text-sm text-blue-300 hover:text-blue-200">Limpiar filtros</Link>
        )}
      </section>

      <section className="glass rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-white">Sesiones recientes</h3>
            <p className="mt-1 text-xs text-gray-500">Ordenadas por fecha de creación, de más reciente a más antigua</p>
          </div>
          <span className="text-sm text-gray-400">{result.error ? 'Datos no disponibles' : `${result.total} registros coincidentes`}</span>
        </div>

        {result.error ? (
          <div className="p-12 text-center">
            <p className="text-gray-300">La lista está temporalmente indisponible.</p>
            <p className="mt-2 text-sm text-gray-500">Los indicadores no se mostrarán como cero cuando la consulta falle.</p>
          </div>
        ) : filters.page > totalPages ? (
          <div className="p-12 text-center">
            <p className="font-semibold text-white">Esta página ya no existe para los filtros seleccionados.</p>
            <p className="mt-2 text-sm text-gray-400">Es posible que las sesiones hayan cambiado desde la última consulta.</p>
            <Link href={roleplayPageHref(filters, totalPages)} className="mt-4 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500">
              Ir a la última página disponible
            </Link>
          </div>
        ) : roleplays.length === 0 ? (
          <div className="p-16 text-center">
            <Mic2 size={44} className="mx-auto text-gray-700 mb-4" />
            <p className="font-semibold text-white">{filters.search || filters.status !== 'all' || filters.participantType !== 'all' ? 'No hay sesiones que coincidan con los filtros' : 'Todavía no hay sesiones de roleplay'}</p>
            <p className="mt-2 text-sm text-gray-500">Puedes cambiar los filtros o crear una sesión para asignar escenarios y audios.</p>
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

      {!result.error && result.total > 0 && (
        <nav aria-label="Paginación de roleplays" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 p-4">
          <p className="text-sm text-gray-400">
            Página {currentPage} de {totalPages} · {filters.page > totalPages ? 0 : Math.min((filters.page - 1) * PAGE_SIZE + 1, result.total)}–{filters.page > totalPages ? 0 : Math.min(filters.page * PAGE_SIZE, result.total)} de {result.total} coincidencias
          </p>
          <div className="flex items-center gap-2">
            {filters.page > 1 && filters.page <= totalPages && (
              <Link href={roleplayPageHref(filters, Math.max(1, currentPage - 1))} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10">Anterior</Link>
            )}
            {filters.page < totalPages && (
              <Link href={roleplayPageHref(filters, filters.page + 1)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10">Siguiente</Link>
            )}
          </div>
        </nav>
      )}
      <p className="text-xs text-gray-500">Historial paginado de 20 sesiones por página. El total y los indicadores se consultan sin truncar el historial.</p>
    </div>
  );
}
