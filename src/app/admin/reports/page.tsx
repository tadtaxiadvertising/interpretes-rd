import prisma from '@/lib/prisma';
import CompanyReportForm from '@/components/admin/CompanyReportForm';
import CompanyCsvImport from '@/components/admin/CompanyCsvImport';

export const dynamic = 'force-dynamic';

export default async function CompanyReportsPage() {
  const [accounts, reports] = await Promise.all([
    prisma.account.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, client: { select: { name: true } }, company: { select: { name: true } } } }),
    prisma.companyProductionReport.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { account: { select: { name: true, client: { select: { name: true } }, company: { select: { name: true } } } } } }),
  ]);
  return <section className="space-y-6 text-white">
    <header><p className="text-sm uppercase tracking-widest text-blue-400">Administración · Operaciones</p><h1 className="text-3xl font-bold">Reportes externos</h1><p className="text-slate-400">Registra resúmenes externos por cuenta, cliente y período. No modifica producción interna ni nómina.</p></header>
    <CompanyReportForm accounts={accounts.map(a => ({ id: a.id, name: a.name, clientName: a.client?.name ?? null, companyName: a.company?.name ?? null }))} />
    <CompanyCsvImport />
    <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-white/5"><tr><th className="p-4">Cliente</th><th className="p-4">Compañía / cuenta</th><th className="p-4">Referencia</th><th className="p-4">Período</th><th className="p-4">Minutos</th><th className="p-4">Llamadas</th></tr></thead><tbody>
      {reports.map(r => <tr key={r.id} className="border-t border-white/10"><td className="p-4">{r.account.client?.name || 'Pendiente de identificar'}</td><td className="p-4">{r.account.company?.name || 'Sin compañía'} / {r.account.name}</td><td className="p-4">{r.sourceName}</td><td className="p-4">{r.periodStart.toISOString().slice(0,10)} — {r.periodEnd.toISOString().slice(0,10)}</td><td className="p-4">{r.reportedMinutes.toLocaleString('es-DO')}</td><td className="p-4">{r.reportedCalls ?? '—'}</td></tr>)}
      {!reports.length && <tr><td colSpan={6} className="p-6 text-center text-slate-400">Sin reportes externos registrados.</td></tr>}
    </tbody></table></div><p className="text-xs text-slate-500">Últimos 100 reportes. Los valores externos no se consideran conciliados automáticamente.</p>
  </section>;
}
