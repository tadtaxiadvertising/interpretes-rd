import React from 'react';
import Link from 'next/link';
import { Clock, Plus, Calendar, Zap, PhoneCall } from 'lucide-react';
import prisma from '@/lib/prisma';
import { cn } from '@/lib/utils';
import { ProductionLogActions } from '@/components/admin/ProductionLogActions';
import { ProductionLogControls } from '@/components/admin/ProductionLogControls';

interface ProductionLog {
  id: number;
  interpreterId: number | null;
  interpretedMinutes: number | null;
  callsAttended: number | null;
  adherence: any;
  date: Date;
  status: string;
  observaciones: string | null;
  campaign: string | null;
  interpreter: { id: number; name: string | null; campaign: string | null; externalId: string | null } | null;
}

interface InterpreterHistoryRow {
  key: string;
  log: ProductionLog | null;
  interpreterId: number | null;
  interpreterName: string;
  interpreterInitial: string;
  interpreterCampaign: string | null;
  interpreterExternalId: string | null;
  date: Date | null;
  interpretedMinutes: number;
  callsAttended: number;
  adherence: number;
  status: string;
  observaciones: string | null;
}

type ProductionSearchParams = Promise<{
  search?: string;
  filter?: string;
  fromDate?: string;
  toDate?: string;
  interpreterId?: string;
  showAll?: string;
  page?: string;
}>;

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

async function getProductionHistory(searchParams: {
  search?: string;
  filter?: string;
  fromDate?: string;
  toDate?: string;
  interpreterId?: string;
  showAll?: string;
  page?: string;
}): Promise<{
  rows: InterpreterHistoryRow[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}> {
  const search = searchParams.search?.trim();
  const filter = searchParams.filter?.trim();
  const fromDate = searchParams.fromDate?.trim();
  const toDate = searchParams.toDate?.trim();
  const interpreterIdStr = searchParams.interpreterId?.trim();
  const isSpecificInterpreter = Boolean(interpreterIdStr && interpreterIdStr !== 'all');
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);

  const isFiltered = Boolean(filter && filter !== 'all');

  const where: Record<string, any> = {};
  if (isFiltered) where.status = filter;
  if (fromDate) where.date = { ...where.date, gte: new Date(`${fromDate}T00:00:00Z`) };
  if (toDate) where.date = { ...where.date, lte: new Date(`${toDate}T23:59:59Z`) };
  if (isSpecificInterpreter) where.interpreterId = parseInt(interpreterIdStr!, 10);
  if (search) {
    where.OR = [
      { status: { contains: search, mode: 'insensitive' as const } },
      { campaign: { contains: search, mode: 'insensitive' as const } },
      { observaciones: { contains: search, mode: 'insensitive' as const } },
      { interpreter: { name: { contains: search, mode: 'insensitive' as const } } },
      { interpreter: { externalId: { contains: search, mode: 'insensitive' as const } } },
    ];
  }

  try {
    // Step 1: Fetch ALL interpreters (always, regardless of filters)
    const interpreterFilter: Record<string, any> = {};
    if (isSpecificInterpreter) {
      interpreterFilter.id = parseInt(interpreterIdStr!, 10);
    }

    const allInterpreters = await prisma.interpreter.findMany({
      where: interpreterFilter,
      select: { id: true, name: true, externalId: true, status: true, campaign: true },
      orderBy: { name: 'asc' },
    });

    // Step 2: Fetch paginated production logs
    const [logTotalCount, logs] = await Promise.all([
      prisma.productionLog.count({ where }),
      prisma.productionLog.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { interpreter: { select: { id: true, name: true, campaign: true, externalId: true } } },
      }),
    ]);

    // Step 3: Find ALL interpreter IDs that have ANY matching log
    // (not limited by pagination, using simple findMany + JS Set)
    const allLogInterpreterIdsRaw = await prisma.productionLog.findMany({
      where,
      select: { interpreterId: true },
    });
    const idsWithAnyMatchingLog = new Set<number>();
    for (const row of allLogInterpreterIdsRaw) {
      if (row.interpreterId !== null) idsWithAnyMatchingLog.add(row.interpreterId);
    }

    // Step 4: Build log rows from paginated results
    const logRows: InterpreterHistoryRow[] = logs.map((log) => {
      const name = log.interpreter?.name || 'Unknown';
      return {
        key: `log-${log.id}`,
        log,
        interpreterId: log.interpreterId,
        interpreterName: name,
        interpreterInitial: name.charAt(0) || '?',
        interpreterCampaign: log.interpreter?.campaign ?? log.campaign,
        interpreterExternalId: log.interpreter?.externalId ?? null,
        date: log.date,
        interpretedMinutes: log.interpretedMinutes ?? 0,
        callsAttended: log.callsAttended ?? 0,
        adherence: Number(log.adherence ?? 0),
        status: log.status,
        observaciones: log.observaciones,
      };
    });

    // Step 5: Build placeholder rows for interpreters WITHOUT any matching logs
    // (search filter applied to interpreters when no specific interpreter is selected)
    let filteredInterpreters = allInterpreters;
    if (!isSpecificInterpreter && search) {
      const searchLower = search.toLowerCase();
      filteredInterpreters = allInterpreters.filter((interp) => {
        const nameMatch = (interp.name || '').toLowerCase().includes(searchLower);
        const idMatch = (interp.externalId || '').toLowerCase().includes(searchLower);
        const campaignMatch = (interp.campaign || '').toLowerCase().includes(searchLower);
        const hasLogMatch = idsWithAnyMatchingLog.has(interp.id);
        return nameMatch || idMatch || campaignMatch || hasLogMatch;
      });
    }

    const placeholderRows: InterpreterHistoryRow[] = filteredInterpreters
      .filter((interp) => !idsWithAnyMatchingLog.has(interp.id))
      .map((interp) => ({
        key: `interpreter-${interp.id}`,
        log: null,
        interpreterId: interp.id,
        interpreterName: interp.name || 'Unknown',
        interpreterInitial: (interp.name || 'U').charAt(0),
        interpreterCampaign: interp.campaign,
        interpreterExternalId: interp.externalId,
        date: null,
        interpretedMinutes: 0,
        callsAttended: 0,
        adherence: 0,
        status: isFiltered ? `Sin registros ${filter}` : 'Sin registros',
        observaciones: null,
      }));

    const allRows = [...logRows, ...placeholderRows];
    const totalWithPlaceholders = logTotalCount + placeholderRows.length;
    const totalPages = Math.max(1, Math.ceil(totalWithPlaceholders / PAGE_SIZE));

    return {
      rows: allRows,
      totalCount: totalWithPlaceholders,
      totalPages,
      currentPage: page,
    };
  } catch (error) {
    console.error('[PRODUCTION] Error fetching production history:', error);
    return { rows: [], totalCount: 0, totalPages: 1, currentPage: 1 };
  }
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function Pagination({ currentPage, totalPages, searchParams }: { currentPage: number; totalPages: number; searchParams: Record<string, string | undefined> }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const visiblePages = pages.filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2
  );

  const baseQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value && key !== 'page') baseQuery.set(key, value);
  }

  return (
    <div className="flex items-center justify-center gap-2 py-6">
      {visiblePages.map((p, idx) => {
        const prev = visiblePages[idx - 1];
        const showGap = idx > 0 && p - prev > 1;
        const query = new URLSearchParams(baseQuery.toString());
        if (p > 1) query.set('page', String(p));
        return (
          <React.Fragment key={p}>
            {showGap && <span className="text-gray-500 px-1">...</span>}
            <a
              href={`?${query.toString()}`}
              className={cn(
                'px-3 py-1 rounded-lg text-sm font-medium transition',
                p === currentPage
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              )}
            >
              {p}
            </a>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default async function ProductionPage({ searchParams }: { searchParams: ProductionSearchParams }) {
  const resolvedSearchParams = await searchParams;
  const { rows: historyRows, totalCount, totalPages, currentPage } = await getProductionHistory(resolvedSearchParams);
  const logs = historyRows.filter((row) => row.log).map((row) => row.log as ProductionLog);
  const avgAdherence = logs.length
    ? logs.reduce((acc, log) => acc + Number(log.adherence ?? 0), 0) / logs.length
    : 0;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white">Registros de producción</h2>
          <p className="text-gray-400">
            Daily connection metrics, call statistics and full interpreter history — {totalCount} records
          </p>
        </div>
        <Link href="/admin/production/manual" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-bold transition-all glow">
          <Plus size={20} />
          Log Session
        </Link>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass p-6 rounded-3xl border border-white/5">
          <p className="text-sm text-gray-500 font-medium">Adherencia promedio</p>
          <div className="flex items-center gap-3 mt-2"><h3 className="text-3xl font-bold text-white">{avgAdherence.toFixed(1)}%</h3><span className="text-xs font-bold text-blue-400 bg-blue-400/10 px-2 py-1 rounded-full">Óptimo</span></div>
          <Zap size={24} className="mt-4 text-blue-400" />
        </div>
        <div className="glass p-6 rounded-3xl border border-white/5">
          <p className="text-sm text-gray-500 font-medium">Minutos contabilizados</p>
          <div className="flex items-center gap-3 mt-2"><h3 className="text-3xl font-bold text-white">{logs.reduce((acc, log) => acc + (log.interpretedMinutes || 0), 0).toLocaleString()}</h3><span className="text-xs font-bold text-green-400 bg-green-400/10 px-2 py-1 rounded-full">Total</span></div>
          <Clock size={24} className="mt-4 text-green-400" />
        </div>
        <div className="glass p-6 rounded-3xl border border-white/5">
          <p className="text-sm text-gray-500 font-medium">Llamadas atendidas</p>
          <div className="flex items-center gap-3 mt-2"><h3 className="text-3xl font-bold text-white">{logs.reduce((acc, log) => acc + (log.callsAttended || 0), 0).toLocaleString()}</h3><span className="text-xs font-bold text-purple-400 bg-purple-400/10 px-2 py-1 rounded-full">Total</span></div>
          <PhoneCall size={24} className="mt-4 text-purple-400" />
        </div>
      </div>

      <div className="glass rounded-3xl overflow-visible">
        <div className="p-6 border-b border-white/5 space-y-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-xl font-bold text-white">Historial de actividad</h3>
            <p className="text-sm text-gray-500">
              Consulta los registros de producción de los intérpretes. Utiliza los filtros para encontrar la información que necesitas.
            </p>
          </div>
          <ProductionLogControls />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5"><th className="py-6 px-8">Intérprete</th><th className="py-6 px-4">Fecha</th><th className="py-6 px-4">Minutos</th><th className="py-6 px-4">Llamadas</th><th className="py-6 px-4">Estado</th><th className="py-6 px-4">Adherencia</th><th className="py-6 px-4 text-right">Acciones</th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {historyRows.map((row) => {
                const isPlaceholder = !row.log;
                return (
                  <tr key={row.key} className={cn("group transition-colors", isPlaceholder ? "opacity-40" : "hover:bg-white/5")}>
                    <td className="py-6 px-8">
                      <div className="flex items-center gap-4">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-bold border border-white/5", isPlaceholder ? "bg-slate-500/10 text-slate-400" : "bg-green-500/10 text-green-400")}>
                          {row.interpreterInitial}
                        </div>
                        <div>
                          <p className="font-bold text-white">{row.interpreterName}</p>
                          <p className="text-sm text-gray-500">{row.interpreterExternalId ?? row.interpreterCampaign ?? 'Sin campaña'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-6 px-4 text-gray-400 text-sm"><span className="flex items-center gap-2"><Calendar size={14} />{row.date ? row.date.toLocaleDateString() : '—'}</span></td>
                    <td className="py-6 px-4 text-white font-mono">{row.interpretedMinutes}m</td>
                    <td className="py-6 px-4 text-gray-300">{row.callsAttended}</td>
                    <td className="py-6 px-4">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-semibold",
                        row.status === 'Completed' ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                          row.status === 'Importado' ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                            row.status === 'PROCESSED' ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" :
                              row.status === 'OK' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                                row.status === 'Pending' ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20" :
                                  row.status === 'Inactive' ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                                    row.status.startsWith('Sin registros') ? "bg-gray-500/10 text-gray-400 border border-gray-500/20" :
                                      "bg-white/5 text-gray-300 border border-white/10"
                      )}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-6 px-4"><div className="flex items-center gap-2"><div className="w-12 bg-white/5 h-1.5 rounded-full overflow-hidden"><div className={cn("h-full rounded-full", row.adherence >= 90 ? "bg-green-500" : row.adherence >= 80 ? "bg-yellow-500" : "bg-red-500")} style={{ width: `${Math.min(row.adherence, 100)}%` }} /></div><span className="text-xs font-bold text-white">{row.adherence.toFixed(2)}%</span></div></td>
                    <td className="py-6 px-4 text-right">
                      {row.log ? (
                        <ProductionLogActions log={{ id: row.log.id, interpreterId: row.log.interpreterId, date: toDateInputValue(row.log.date), interpretedMinutes: row.interpretedMinutes, callsAttended: row.callsAttended, adherence: row.adherence, status: row.status, observaciones: row.observaciones, interpreterName: row.interpreterName }} />
                      ) : (
                        <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-gray-400">{row.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination currentPage={currentPage} totalPages={totalPages} searchParams={resolvedSearchParams as Record<string, string | undefined>} />

        {historyRows.length === 0 && <div className="p-20 text-center"><Clock size={48} className="mx-auto text-gray-700 mb-4" /><p className="text-gray-500">No se encontraron registros de producción.</p></div>}
      </div>
    </div>
  );
}
