import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Mic2, Waves, Library, Settings } from 'lucide-react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import {
  ADMIN_ROLEPLAY_FILTERABLE_STATUSES, ADMIN_ROLEPLAY_PAGE_SIZE,
  boundAdminRoleplayPage, buildAdminRoleplayWhere, parseAdminRoleplayFilters,
  type AdminRoleplayFilters, type AdminRoleplaySearchParams,
} from '@/lib/admin-roleplays-list';
import { SessionActions } from '@/components/admin/SessionActions';
import { cn, formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ROLEPLAY_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador', INVITED: 'Invitación enviada',
  STARTED: 'Iniciado', IN_PROGRESS: 'En progreso',
  SUBMITTED: 'Entregado', UNDER_REVIEW: 'En evaluación',
  EVALUATED: 'Evaluado', PASSED: 'Aprobado',
  FAILED: 'No aprobado', EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
};


function roleplayPageHref(filters: AdminRoleplayFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.participantType !== 'all') params.set('participantType', filters.participantType);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin/roleplays${query ? `?${query}` : ''}`;
}

async function getRoleplays(filters: AdminRoleplayFilters) {
  const where = buildAdminRoleplayWhere(filters);
  try {
    const [total, statusGroups] = await Promise.all([
      prisma.roleplaySession.count({ where }),
      prisma.roleplaySession.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    // Clamp before querying, not only when drawing pagination controls.
    // Otherwise ?page=999 shows "page 2" with an empty table.
    const page = boundAdminRoleplayPage(filters.page, total);
    const data = await prisma.roleplaySession.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * ADMIN_ROLEPLAY_PAGE_SIZE,
      take: ADMIN_ROLEPLAY_PAGE_SIZE,
      include: {
        interpreter: { select: { id: true, name: true, externalId: true, emailCorporativo: true } },
        recruitmentCandidate: { select: { id: true, name: true, email: true } },
        qaScore: { select: { id: true, totalScore: true, criticalError: true } },
      },
    });
    const counts = Object.fromEntries(statusGroups.map((entry) => [entry.status, entry._count._all])) as Record<string, number>;
    return { data, total, page, counts, error: null as string | null };
  } catch (error) {
    console.error('[ADMIN ROLEPLAYS] Failed to load roleplay sessions:', safeServerErrorCategory(error));
    return {
      data: [],
      total: 0,
      page: 1,
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
    <div className="glass rounded-2xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]">{label}</p>
        <Icon size={19} className="text-[var(--text-secondary)]" />
      </div>
      <p className="mt-3 text-3xl font-bold text-[var(--foreground)] tabular-nums">{value ?? '—'}</p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{detail}</p>
    </div>
  );
}

export default async function AdminRoleplaysPage({
  searchParams,
}: {
  searchParams: Promise<AdminRoleplaySearchParams>;
}) {
  const filters = parseAdminRoleplayFilters(await searchParams);
  const result = await getRoleplays(filters);
  const roleplays = result.data;
  const count = (status: string) => result.counts[status] ?? 0;
  const activeCount = ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS'].reduce((total, status) => total + count(status), 0);
  const awaitingReviewCount = count('SUBMITTED') + count('UNDER_REVIEW');
  const evaluatedCount = count('EVALUATED') + count('PASSED') + count('FAILED');
  const totalPages = Math.max(1, Math.ceil(result.total / ADMIN_ROLEPLAY_PAGE_SIZE));
  const currentPage = result.page;

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-slate-500/10 text-[var(--text-secondary)]',
    INVITED: 'bg-amber-500/10 text-[var(--theme-warning)]',
    STARTED: 'bg-blue-500/10 text-[var(--theme-link)]',
    IN_PROGRESS: 'bg-blue-500/10 text-[var(--theme-link)]',
    SUBMITTED: 'bg-yellow-500/10 text-[var(--theme-warning)]',
    UNDER_REVIEW: 'bg-blue-500/10 text-[var(--theme-link)]',
    EVALUATED: 'bg-green-500/10 text-[var(--theme-success)]',
    PASSED: 'bg-emerald-500/10 text-[var(--theme-success)]',
    FAILED: 'bg-red-500/10 text-[var(--theme-danger)]',
    EXPIRED: 'bg-slate-500/10 text-[var(--text-secondary)]',
    CANCELLED: 'bg-slate-500/10 text-[var(--text-secondary)]',
  };

  const participantTypeColors: Record<string, string> = {
    interpreter: 'bg-blue-500/10 text-[var(--theme-link)]',
    candidate: 'bg-purple-500/10 text-[var(--theme-purple)]',
  };

  return (
    <div className="min-w-0 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">Gestión de roleplays</h2>
          <p className="text-[var(--text-secondary)]">Control de sesiones, participantes y evaluaciones</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/roleplays/creation-readiness" prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-3 font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"><CheckCircle2 size={18} /> Diagnóstico de creación</Link>
          <Link href="/admin/roleplays/settings" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-3 font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"><Settings size={18} /> Configuración Audio Studio</Link>
          <Link
            href="/admin/roleplays/studio"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-blue-400/20 bg-blue-600/10 px-4 py-3 font-semibold text-[var(--theme-link)] transition-colors hover:bg-blue-600/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
          >
            <Waves size={18} /> Audio Studio
          </Link>
          <Link
            href="/admin/roleplays/library"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-3 font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
          >
            <Library size={18} /> Biblioteca
          </Link>
          <Link
            href="/admin/roleplays/queue"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-3 font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
          >
            <CheckCircle2 size={18} /> Evaluación QA
          </Link>
          <Link
            href="/admin/roleplay-audio-jobs"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-3 font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
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
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[var(--theme-danger)]" />
          <div>
            <p className="font-semibold text-[var(--theme-danger)]">No fue posible consultar las sesiones</p>
            <p className="mt-1 text-sm text-[var(--theme-danger)]">{result.error}</p>
          </div>
        </div>
      )}

      <section aria-label="Resumen de roleplays" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Sesiones" value={result.error ? null : Object.values(result.counts).reduce((sum, value) => sum + value, 0)} detail="Total histórico, sin limitar a la página" icon={Mic2} />
        <MetricCard label="En curso" value={result.error ? null : activeCount} detail="Borrador, invitadas o iniciadas" icon={Clock3} />
        <MetricCard label="Pendientes de QA" value={result.error ? null : awaitingReviewCount} detail="Entregadas o bajo revisión" icon={AlertTriangle} />
        <MetricCard label="Evaluadas" value={result.error ? null : evaluatedCount} detail="Evaluadas, aprobadas o no aprobadas" icon={CheckCircle2} />
      </section>

      <section aria-label="Filtros de roleplays" className="glass rounded-2xl border border-[var(--border)] p-4 sm:p-5">
        <form action="/admin/roleplays" method="get" className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,200px)_minmax(0,180px)_auto]">
          <label className="sr-only" htmlFor="roleplay-search">Buscar participante</label>
          <input id="roleplay-search" name="search" type="search" maxLength={100}
            placeholder="Buscar nombre, correo o ID de intérprete"
            defaultValue={filters.search}
            className="w-full min-w-0 rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-4 py-3 text-[var(--foreground)] placeholder:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]" />
          <label className="sr-only" htmlFor="roleplay-status">Estado</label>
          <select id="roleplay-status" name="status" defaultValue={filters.status}
            className="w-full min-w-0 rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-4 py-3 text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]">
            <option value="all">Todos los estados</option>
            {ADMIN_ROLEPLAY_FILTERABLE_STATUSES.map((status) => <option key={status} value={status}>{ROLEPLAY_STATUS_LABELS[status] ?? status}</option>)}
          </select>
          <label className="sr-only" htmlFor="roleplay-participant">Tipo de participante</label>
          <select id="roleplay-participant" name="participantType" defaultValue={filters.participantType}
            className="w-full min-w-0 rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-4 py-3 text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]">
            <option value="all">Todos los participantes</option>
            <option value="interpreter">Intérpretes</option>
            <option value="candidate">Candidatos</option>
          </select>
          <button type="submit" className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500">
            Aplicar filtros
          </button>
        </form>
        {(filters.search || filters.status !== 'all' || filters.participantType !== 'all') && (
          <Link href="/admin/roleplays" className="mt-3 inline-block text-sm font-semibold text-[var(--theme-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]">Limpiar filtros</Link>
        )}
      </section>

      <section className="glass rounded-3xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4 sm:p-6">
          <div>
            <h3 className="text-xl font-bold text-[var(--foreground)]">Sesiones recientes</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Ordenadas por fecha de creación, de más reciente a más antigua</p>
          </div>
          <span className="text-sm text-[var(--text-secondary)]">{result.error ? 'Datos no disponibles' : `${result.total} registros coincidentes`}</span>
        </div>

        {result.error ? (
          <div className="p-12 text-center">
            <p className="text-[var(--text-secondary)]">La lista está temporalmente indisponible.</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Los indicadores no se mostrarán como cero cuando la consulta falle.</p>
          </div>
        ) : filters.page > totalPages ? (
          <div className="p-12 text-center">
            <p className="font-semibold text-[var(--foreground)]">Esta página ya no existe para los filtros seleccionados.</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Es posible que las sesiones hayan cambiado desde la última consulta.</p>
            <Link href={roleplayPageHref(filters, totalPages)} className="mt-4 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500">
              Ir a la última página disponible
            </Link>
          </div>
        ) : roleplays.length === 0 ? (
          <div className="p-16 text-center">
            <Mic2 size={44} className="mx-auto text-gray-700 mb-4" />
            <p className="font-semibold text-[var(--foreground)]">{filters.search || filters.status !== 'all' || filters.participantType !== 'all' ? 'No hay sesiones que coincidan con los filtros' : 'Todavía no hay sesiones de roleplay'}</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Puedes cambiar los filtros o crear una sesión para asignar escenarios y audios.</p>
            <Link href="/admin/roleplays/new" className="mt-5 inline-flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-colors">
              <Mic2 size={18} /> Crear primer roleplay
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--text-secondary)]">
                  <th className="py-5 px-6">Sesión</th>
                  <th className="py-5 px-4">Participante</th>
                  <th className="py-5 px-4">Tipo</th>
                  <th className="py-5 px-4">Estado</th>
                  <th className="py-5 px-4">Creación</th>
                  <th className="py-5 px-4">Puntuación QA</th>
                  <th className="py-5 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {roleplays.map((session) => (
                  <tr key={session.id} className="group transition-colors hover:bg-[var(--theme-hover)]">
                    <td className="py-5 px-6">
                      <div className="font-mono text-sm text-[var(--text-secondary)]">{session.id.slice(0, 12)}…</div>
                      <div className="text-xs text-[var(--text-secondary)] mt-1">{formatDate(session.createdAt)}</div>
                    </td>
                    <td className="py-5 px-4">
                      <p className="font-semibold text-[var(--foreground)]">{session.interpreter?.name || session.recruitmentCandidate?.name || 'Participante no disponible'}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-1">{session.interpreter?.emailCorporativo || session.recruitmentCandidate?.email || '—'}</p>
                    </td>
                    <td className="py-5 px-4">
                      <span className={cn('px-3 py-1 rounded-full text-xs font-bold', participantTypeColors[session.interpreter ? 'interpreter' : 'candidate'])}>
                        {session.interpreter ? 'Intérprete' : 'Candidato'}
                      </span>
                    </td>
                    <td className="py-5 px-4">
                      <span className={cn('px-3 py-1 rounded-full text-xs font-bold', statusColors[session.status] ?? 'bg-slate-500/10 text-[var(--text-secondary)]')}>
                        {ROLEPLAY_STATUS_LABELS[session.status] ?? "Estado desconocido"}
                      </span>
                    </td>
                    <td className="py-5 px-4 text-sm text-[var(--text-secondary)]">{formatDate(session.createdAt)}</td>
                    <td className="py-5 px-4">
                      {session.qaScore ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--theme-track)]">
                            <div
                              className={cn('h-full rounded-full', session.qaScore.criticalError ? 'bg-red-500' : Number(session.qaScore.totalScore ?? 0) >= 80 ? 'bg-green-500' : Number(session.qaScore.totalScore ?? 0) >= 70 ? 'bg-yellow-500' : 'bg-red-500')}
                              style={{ width: `${Math.max(0, Math.min(100, Number(session.qaScore.totalScore ?? 0)))}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold text-[var(--foreground)]">
                            {session.qaScore.criticalError ? '0 (Crítico)' : `${session.qaScore.totalScore}%`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">Sin evaluar</span>
                      )}
                    </td>
                    <td className="py-5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/admin/roleplays/${session.id}`} className="inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--theme-hover)]">
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
        <nav aria-label="Paginación de roleplays" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] p-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Página {currentPage} de {totalPages} · {filters.page > totalPages ? 0 : Math.min((filters.page - 1) * ADMIN_ROLEPLAY_PAGE_SIZE + 1, result.total)}–{filters.page > totalPages ? 0 : Math.min(filters.page * ADMIN_ROLEPLAY_PAGE_SIZE, result.total)} de {result.total} coincidencias
          </p>
          <div className="flex items-center gap-2">
            {filters.page > 1 && filters.page <= totalPages && (
              <Link href={roleplayPageHref(filters, Math.max(1, currentPage - 1))} className="rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--theme-hover)]">Anterior</Link>
            )}
            {filters.page < totalPages && (
              <Link href={roleplayPageHref(filters, filters.page + 1)} className="rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--theme-hover)]">Siguiente</Link>
            )}
          </div>
        </nav>
      )}
      <p className="text-xs text-[var(--text-secondary)]">Historial paginado de 20 sesiones por página. El total y los indicadores se consultan sin truncar el historial.</p>
    </div>
  );
}
