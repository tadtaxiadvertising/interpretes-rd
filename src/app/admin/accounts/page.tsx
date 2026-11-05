import prisma from '@/lib/prisma';
import CreateAccountForm from '@/components/admin/CreateAccountForm';

export const dynamic = 'force-dynamic';

export default async function AdminAccountsPage() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [accounts, production, clients] = await Promise.all([
    prisma.account.findMany({
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true, name: true, description: true,
        client: { select: { name: true } },
        company: { select: { name: true } },
        _count: { select: { assignments: { where: { startsAt: { lte: today }, OR: [{ endsAt: null }, { endsAt: { gte: today } }] } } } },
      },
    }),
    prisma.productionLog.groupBy({
      by: ['accountId'], where: { accountId: { not: null } },
      _sum: { interpretedMinutes: true, connectedHours: true },
    }),
    prisma.client.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const productionByAccount = new Map(production.map(row => [row.accountId, row._sum]));
  const totalMinutes = production.reduce((sum, row) => sum + (row._sum.interpretedMinutes ?? 0), 0);
  const totalAssignedInterpreters = accounts.reduce((sum, account) => sum + account._count.assignments, 0);
  return <section className="space-y-7 text-slate-100">
    <header>
      <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Administración · Operaciones</p>
      <h1 className="mt-2 text-3xl font-bold">Cuentas operativas</h1>
      <p className="mt-2 text-slate-400">Cada cuenta pertenece a un cliente. La compañía solo identifica la plataforma o empresa a la que pertenece la cuenta.</p>
    </header>
    <div className="grid gap-4 md:grid-cols-3">
      {[
        ['Cuentas registradas', accounts.length.toLocaleString('es-DO')],
        ['Asignaciones vigentes', totalAssignedInterpreters.toLocaleString('es-DO')],
        ['Minutos históricos', totalMinutes.toLocaleString('es-DO')],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div>)}
    </div>
    <CreateAccountForm clients={clients} />
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-white/[0.06] text-slate-300"><tr><th className="p-4">Cuenta</th><th className="p-4">Cliente</th><th className="p-4">Compañía</th><th className="p-4">Intérpretes asignados</th><th className="p-4">Minutos</th><th className="p-4">Horas conectadas</th></tr></thead>
        <tbody>{accounts.map(account => {
          const totals = productionByAccount.get(account.id);
          return <tr key={account.id} className="border-t border-white/10">
            <td className="p-4"><strong className="text-white">{account.name}</strong><p className="mt-1 text-slate-400">{account.description || 'Sin descripción'}</p></td>
            <td className="p-4">{account.client?.name || <span className="text-amber-300">Pendiente de identificar</span>}</td>
            <td className="p-4">{account.company?.name || 'Sin compañía'}</td>
            <td className="p-4">{account._count.assignments}</td>
            <td className="p-4">{(totals?.interpretedMinutes ?? 0).toLocaleString('es-DO')}</td>
            <td className="p-4">{Number(totals?.connectedHours ?? 0).toLocaleString('es-DO', { maximumFractionDigits: 2 })}</td>
          </tr>;
        })}
        {!accounts.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">Todavía no hay cuentas registradas.</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}
