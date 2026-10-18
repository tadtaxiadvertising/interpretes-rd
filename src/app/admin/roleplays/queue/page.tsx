import React from 'react';
import { Loader2, Filter, Search, ArrowUpDown, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Clock, User } from 'lucide-react';
import Link from 'next/link';
import { cn, formatDate } from '@/lib/utils';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: 'bg-yellow-500/10 text-yellow-400',
  UNDER_REVIEW: 'bg-blue-500/10 text-blue-400',
  EVALUATED: 'bg-green-500/10 text-green-400',
  PASSED: 'bg-emerald-500/10 text-emerald-400',
  FAILED: 'bg-red-500/10 text-red-400',
  EXPIRED: 'bg-slate-500/10 text-slate-400',
  CANCELLED: 'bg-slate-500/10 text-slate-400',
};

const PARTICIPANT_COLORS: Record<string, string> = {
  interpreter: 'bg-blue-500/10 text-blue-400',
  candidate: 'bg-purple-500/10 text-purple-400',
};

interface QueueFilters {
  status?: string;
  participantType?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

async function getQueueData(filters: QueueFilters = {}) {
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: any = {
    status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'] },
  };

  if (filters.status && filters.status !== 'all') {
    where.status = filters.status;
  }

  if (filters.participantType === 'interpreter') {
    where.interpreterId = { not: null };
  } else if (filters.participantType === 'candidate') {
    where.recruitmentCandidateId = { not: null };
  }

  if (filters.search) {
    where.OR = [
      { interpreter: { name: { contains: filters.search, mode: 'insensitive' } } },
      { interpreter: { emailCorporativo: { contains: filters.search, mode: 'insensitive' } } },
      { recruitmentCandidate: { name: { contains: filters.search, mode: 'insensitive' } } },
      { recruitmentCandidate: { email: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }

  const [sessions, total] = await Promise.all([
    prisma.roleplaySession.findMany({
      where,
      include: {
        interpreter: { select: { id: true, name: true, emailCorporativo: true, externalId: true } },
        recruitmentCandidate: { select: { id: true, name: true, email: true } },
        access: true,
        qaScore: { select: { id: true, totalScore: true, criticalError: true, createdAt: true } },
        scenarios: {
          include: { responses: { select: { id: true, selfScore: true, durationSec: true } } },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { [filters.sortBy || 'submittedAt']: filters.sortOrder || 'desc' },
      take: pageSize,
      skip,
    }),
    prisma.roleplaySession.count({ where }),
  ]);

// Calculate stats
  const statsGroupBy = await prisma.roleplaySession.groupBy({
    by: ['status'],
    where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'] } },
    _count: true,
  });

  const stats = statsGroupBy.reduce((acc, s) => ({ ...acc, [s.status]: s._count }), {} as Record<string, number>);

  return {
    sessions,
    total,
    totalPages: Math.ceil(total / pageSize),
    stats,
  };
}

async function getEvaluators() {
  return prisma.rbacUser.findMany({
    where: { role: { in: ['ADMIN', 'HOLDER'] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}

export default async function AdminRoleplayQueuePage({
  searchParams,
}: {
  searchParams: Promise<QueueFilters>;
}) {
  const params = await searchParams;
  const [{ sessions, total, totalPages, stats }, evaluators] = await Promise.all([
    getQueueData(params),
    getEvaluators(),
  ]);

  const evaluatorById = new Map(evaluators.map((e) => [e.id, e]));

  const currentPage = params.page || 1;
  const statusFilter = params.status || 'all';
  const typeFilter = params.participantType || 'all';
  const searchQuery = params.search || '';

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white">Cola de Evaluación QA</h2>
          <p className="text-gray-400">Gestiona y asigna evaluaciones de roleplay pendientes</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/roleplays"
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-colors border border-white/10"
          >
            Volver a Roleplays
          </Link>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard 
          label="Enviados" 
          value={stats.SUBMITTED || 0} 
          icon={Clock} 
          color="yellow"
          isActive={statusFilter === 'SUBMITTED'}
          href={`/admin/roleplays/queue?status=SUBMITTED`}
        />
        <StatCard 
          label="En Revisión" 
          value={stats.UNDER_REVIEW || 0} 
          icon={User} 
          color="blue"
          isActive={statusFilter === 'UNDER_REVIEW'}
          href={`/admin/roleplays/queue?status=UNDER_REVIEW`}
        />
        <StatCard 
          label="Evaluados" 
          value={((stats.EVALUATED || 0) + (stats.PASSED || 0) + (stats.FAILED || 0))} 
          icon={CheckCircle2} 
          color="green"
          isActive={statusFilter === 'EVALUATED'}
          href={`/admin/roleplays/queue?status=EVALUATED`}
        />
        <StatCard 
          label="Aprobados" 
          value={stats.PASSED || 0} 
          icon={CheckCircle2} 
          color="emerald"
          isActive={statusFilter === 'PASSED'}
          href={`/admin/roleplays/queue?status=PASSED`}
        />
        <StatCard 
          label="Rechazados" 
          value={stats.FAILED || 0} 
          icon={AlertTriangle} 
          color="red"
          isActive={statusFilter === 'FAILED'}
          href={`/admin/roleplays/queue?status=FAILED`}
        />
      </div>

      {/* Filters */}
      <div className="glass rounded-3xl p-6 border border-white/5">
        <form className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              name="search"
              placeholder="Buscar por nombre, email..."
              defaultValue={searchQuery}
              className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <select
            name="status"
            defaultValue={statusFilter}
            className="bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
          >
            <option value="all">Todos los estados</option>
            <option value="SUBMITTED">Enviados</option>
            <option value="UNDER_REVIEW">En Revisión</option>
            <option value="EVALUATED">Evaluados</option>
            <option value="PASSED">Aprobados</option>
            <option value="FAILED">Rechazados</option>
          </select>
          <select
            name="participantType"
            defaultValue={typeFilter}
            className="bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
          >
            <option value="all">Todos los tipos</option>
            <option value="interpreter">Intérpretes</option>
            <option value="candidate">Candidatos</option>
          </select>
          <button
            type="submit"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors"
          >
            Filtrar
          </button>
        </form>
      </div>

      {/* Queue Table */}
      <div className="glass rounded-3xl overflow-visible">
        <div className="p-6 border-b border-white/5 flex flex-wrap gap-4 items-center justify-between">
          <h3 className="text-xl font-bold text-white">Sesiones en Cola ({total})</h3>
          <div className="flex gap-2">
            <select
              name="sortBy"
              defaultValue={params.sortBy || 'submittedAt'}
              className="bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-white focus:outline-none focus:border-blue-500/50 transition-colors text-sm"
              onChange={(e) => {
                const url = new URL(window.location.href);
                url.searchParams.set('sortBy', e.target.value);
                window.location.href = url.toString();
              }}
            >
              <option value="submittedAt">Fecha envío</option>
              <option value="createdAt">Fecha creación</option>
              <option value="reviewStartedAt">Inicio revisión</option>
            </select>
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set('sortOrder', params.sortOrder === 'asc' ? 'desc' : 'asc');
                window.location.href = url.toString();
              }}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors"
              title="Cambiar orden"
            >
              {params.sortOrder === 'asc' ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
            </button>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="p-20 text-center">
            <Clock size={48} className="mx-auto text-gray-700 mb-4" />
            <p className="text-gray-500">No hay sesiones en cola con los filtros actuales.</p>
          </div>
        ) : (
          <>
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                  <th className="py-6 px-8">Sesión</th>
                  <th className="py-6 px-4">Participante</th>
                  <th className="py-6 px-4">Tipo</th>
                  <th className="py-6 px-4">Estado</th>
                  <th className="py-6 px-4">Enviado</th>
                  <th className="py-6 px-4">Evaluador</th>
                  <th className="py-6 px-4">Escenarios</th>
                  <th className="py-6 px-4">Autoeval</th>
                  <th className="py-6 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sessions.map((session: any) => (
                  <tr key={session.id} className="group hover:bg-white/5 transition-colors">
                    <td className="py-6 px-8">
                      <div className="font-mono text-sm text-gray-400">{session.id.slice(0, 12)}...</div>
                      <div className="text-xs text-gray-500 mt-1">{formatDate(session.createdAt)}</div>
                    </td>
                    <td className="py-6 px-4">
                      <div>
                        <p className="font-bold text-white">
                          {session.interpreter?.name || session.recruitmentCandidate?.name || 'Desconocido'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {session.interpreter?.emailCorporativo || session.recruitmentCandidate?.email}
                        </p>
                        {session.interpreter?.externalId && (
                          <p className="text-xs text-blue-400">ID: {session.interpreter.externalId}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-6 px-4">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-xs font-bold",
                        PARTICIPANT_COLORS[session.interpreter ? 'interpreter' : 'candidate']
                      )}>
                        {session.interpreter ? 'Intérprete' : 'Candidato'}
                      </span>
                    </td>
                    <td className="py-6 px-4">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-xs font-bold",
                        STATUS_COLORS[session.status]
                      )}>
                        {session.status}
                      </span>
                      {session.reviewPriority > 0 && (
                        <span className="ml-1 px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">
                          Prioridad {session.reviewPriority}
                        </span>
                      )}
                    </td>
                    <td className="py-6 px-4 text-sm text-gray-300">
                      {session.submittedAt ? formatDate(session.submittedAt) : '—'}
                    </td>
                    <td className="py-6 px-4">
                      {session.evaluatorId ? (
                        <div>
                          <p className="font-medium text-white">
                            {evaluatorById.get(session.evaluatorId)?.name || 'Evaluador asignado'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {evaluatorById.get(session.evaluatorId)?.email || `ID: ${session.evaluatorId.slice(0, 12)}...`}
                          </p>
                          {session.reviewStartedAt && (
                            <p className="text-xs text-blue-400">Iniciado: {formatDate(session.reviewStartedAt)}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-500 text-sm">Sin asignar</span>
                      )}
                    </td>
                    <td className="py-6 px-4 text-center">
                      {session.scenarios?.length || 0}
                    </td>
                    <td className="py-6 px-4 text-center">
                      {session.scenarios?.filter((s: any) => s.responses?.length > 0).length || 0} / {session.scenarios?.length || 0}
                    </td>
                    <td className="py-6 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/roleplays/${session.id}`}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors"
                        >
                          {session.status === 'SUBMITTED' ? 'Reclamar' : session.status === 'UNDER_REVIEW' ? 'Continuar' : 'Ver Evaluación'}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-6 border-t border-white/5 flex items-center justify-between">
                <p className="text-sm text-gray-400">
                  Mostrando {((currentPage - 1) * 20) + 1} - {Math.min(currentPage * 20, total)} de {total}
                </p>
                <div className="flex gap-2">
                  <Link
                    href={`/admin/roleplays/queue?page=${currentPage - 1}&status=${statusFilter}&participantType=${typeFilter}&search=${searchQuery}`}
                    className={cn(
                      "px-4 py-2 rounded-xl font-medium transition-colors",
                      currentPage === 1 ? "bg-white/5 text-gray-400 cursor-not-allowed" : "bg-white/5 hover:bg-white/10 text-white"
                    )}
                    aria-disabled={currentPage === 1}
                  >
                    <ChevronLeft size={18} />
                  </Link>
                  <Link
                    href={`/admin/roleplays/queue?page=${currentPage + 1}&status=${statusFilter}&participantType=${typeFilter}&search=${searchQuery}`}
                    className={cn(
                      "px-4 py-2 rounded-xl font-medium transition-colors",
                      currentPage === totalPages ? "bg-white/5 text-gray-400 cursor-not-allowed" : "bg-white/5 hover:bg-white/10 text-white"
                    )}
                    aria-disabled={currentPage === totalPages}
                  >
                    <ChevronRight size={18} />
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  icon: Icon, 
  color, 
  isActive, 
  href 
}: { 
  label: string; 
  value: number; 
  icon: React.ComponentType<{ size?: number; className?: string }>; 
  color: string; 
  isActive?: boolean; 
  href?: string; 
}) {
  const colorMap: Record<string, string> = {
    yellow: 'bg-yellow-500/10 text-yellow-400',
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-green-500/10 text-green-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    red: 'bg-red-500/10 text-red-400',
  };

  const content = (
    <div className={cn(
      "glass rounded-3xl p-6 border border-white/5 transition-all",
      isActive && "ring-2 ring-blue-500/50 shadow-lg shadow-blue-500/10"
    )}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white font-semibold mb-1">{label}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
        </div>
        <div className={cn("p-3 rounded-xl", colorMap[color])}>
          <Icon size={24} />
        </div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}