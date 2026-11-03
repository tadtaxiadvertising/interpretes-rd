import prisma from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

// Read-only comparison. A difference is not an approved payroll adjustment.
export default async function CompanyReconciliationPage() {
  const reports = await prisma.companyProductionReport.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    include: { account: { select: { name: true, company: { select: { name: true } } } } },
  });

  const accountIds = [...new Set(reports.map(report => report.accountId))];
  const dates = reports.flatMap(report => [report.periodStart, report.periodEnd]);
  const earliest = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
  const latest = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

  // One aggregate query, even when several reports share the same account and period.
  const daily = earliest && latest ? await prisma.productionLog.groupBy({
    by: ['accountId', 'date'],
    where: { accountId: { in: accountIds }, date: { gte: earliest, lte: latest } },
    _sum: { interpretedMinutes: true, callsAttended: true },
    _count: { _all: true },
  }) : [];

  const byAccount = new Map<number, typeof daily>();
  for (const row of daily) {
    if (row.accountId === null) continue;
    const rows = byAccount.get(row.accountId) ?? [];
    rows.push(row);
    byAccount.set(row.accountId, rows);
  }

  const comparisons = reports.map(report => {
    const rows = (byAccount.get(report.accountId) ?? []).filter(row =>
      row.date >= report.periodStart && row.date <= report.periodEnd
    );
    const internalMinutes = rows.reduce((sum, row) => sum + (row._sum.interpretedMinutes ?? 0), 0);
    const internalCalls = rows.reduce((sum, row) => sum + (row._sum.callsAttended ?? 0), 0);
    const logCount = rows.reduce((sum, row) => sum + row._count._all, 0);
    return {
      report,
      internalMinutes,
      internalCalls,
      logCount,
      difference: report.reportedMinutes - internalMinutes,
      callDifference: report.reportedCalls === null ? null : report.reportedCalls - internalCalls,
    };
  });

  const mismatches = comparisons.filter(c => c.difference !== 0).length;
  const noLogs = comparisons.filter(c => c.logCount === 0).length;

  return <section className="space-y-6 text-white">
    <header className="space-y-2">
      <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Administración · Operaciones</p>
      <h1 className="text-3xl font-bold">Conciliación de producción</h1>
      <p className="max-w-3xl text-slate-400">Comparación preliminar entre reportes externos y producción interna por cuenta y período. Las diferencias requieren revisión humana: esta página no liquida, aprueba ni modifica nóminas.</p>
      <Link href="/admin/reports" className="inline-block text-blue-300 hover:underline">Registrar o consultar reportes externos</Link>
    </header>
    <div className="grid gap-3 md:grid-cols-3">
      {[
        ['Reportes comparados', comparisons.length],
        ['Con diferencias en minutos', mismatches],
        ['Sin registros internos', noLogs],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}
    </div>
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-white/5"><tr><th className="p-3">Compañía / cuenta</th><th className="p-3">Reporte y período</th><th className="p-3 text-right">Externo (min)</th><th className="p-3 text-right">Interno (min)</th><th className="p-3 text-right">Diferencia</th><th className="p-3">Revisión</th></tr></thead>
        <tbody>{comparisons.map(({ report, internalMinutes, difference, logCount, callDifference }) => <tr key={report.id} className="border-t border-white/10">
          <td className="p-3">{report.account.company?.name || 'Sin compañía'} / {report.account.name}</td>
          <td className="p-3"><span className="block">{report.sourceName}</span><span className="text-xs text-slate-400">{report.periodStart.toISOString().slice(0,10)} — {report.periodEnd.toISOString().slice(0,10)}</span></td>
          <td className="p-3 text-right tabular-nums">{report.reportedMinutes.toLocaleString('es-DO')}</td>
          <td className="p-3 text-right tabular-nums">{internalMinutes.toLocaleString('es-DO')}</td>
          <td className={`p-3 text-right font-semibold tabular-nums ${difference === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{difference > 0 ? '+' : ''}{difference.toLocaleString('es-DO')}</td>
          <td className="p-3">{logCount === 0 ? <span className="text-amber-300">Sin registros internos</span> : difference !== 0 || (callDifference !== null && callDifference !== 0) ? <span className="text-amber-300">Revisar diferencias</span> : <span className="text-emerald-300">Coincidencia numérica</span>}</td>
        </tr>)}
        {!comparisons.length && <tr><td colSpan={6} className="p-6 text-center text-slate-400">Registra un reporte externo para iniciar una comparación.</td></tr>}</tbody>
      </table>
    </div>
    <p className="text-sm text-slate-400">Criterio: minutos interpretados y llamadas de todos los registros internos asociados a la cuenta, dentro de las fechas inclusivas. No se filtra por estado ni se sustituyen valores por minutos verificados. Una coincidencia numérica no significa aprobación. Se muestran los últimos 100 reportes; un mismo período puede aparecer en varios reportes.</p>
  </section>;
}
