import prisma from '@/lib/prisma';
import CreateAccountForm from '@/components/admin/CreateAccountForm';

export const dynamic = 'force-dynamic';

export default async function AdminAccountsPage() {
  // Access is enforced by /admin/layout.tsx and again by the write action.
  // Aggregate on the database side instead of loading every historical log into memory.
  const [accounts, production, rates] = await Promise.all([
    prisma.account.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true },
    }),
    prisma.productionLog.groupBy({
      by: ['accountId'],
      where: { accountId: { not: null } },
      _sum: { interpretedMinutes: true, connectedHours: true },
    }),
    prisma.interpreterAccountRate.findMany({
      where: { accountId: { not: null }, interpreterId: { not: null } },
      select: { accountId: true, interpreterId: true },
    }),
  ]);
  const productionByAccount = new Map(production.map(row => [row.accountId, row._sum]));
  const interpretersByAccount = new Map<number, Set<number>>();
  const interpreterIds = new Set<number>();
  for (const rate of rates) {
    if (rate.accountId === null || rate.interpreterId === null) continue;
    interpreterIds.add(rate.interpreterId);
    const assigned = interpretersByAccount.get(rate.accountId) ?? new Set<number>();
    assigned.add(rate.interpreterId);
    interpretersByAccount.set(rate.accountId, assigned);
  }
  const totalMinutes = production.reduce((sum, row) => sum + (row._sum.interpretedMinutes ?? 0), 0);
  return (
    <section className="space-y-7 text-slate-100">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Administración · Operaciones</p>
        <h1 className="mt-2 text-3xl font-bold">Cuentas y compañías</h1>
        <p className="mt-2 text-slate-400">Primera etapa: cuentas operativas y producción histórica vinculada. Las compañías, credenciales protegidas y reportes externos se incorporarán en etapas posteriores.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['Cuentas registradas', accounts.length.toLocaleString('es-DO')],
          ['Intérpretes vinculados', interpreterIds.size.toLocaleString('es-DO')],
          ['Minutos históricos', totalMinutes.toLocaleString('es-DO')],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <CreateAccountForm />
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="bg-white/[0.06] text-slate-300"><tr><th className="p-4">Cuenta</th><th className="p-4">Intérpretes vinculados</th><th className="p-4">Minutos</th><th className="p-4">Horas conectadas</th></tr></thead>
          <tbody>
            {accounts.map(account => {
              const minutes = productionByAccount.get(account.id)?.interpretedMinutes ?? 0;
              const hours = Number(productionByAccount.get(account.id)?.connectedHours ?? 0);
              const assigned = interpretersByAccount.get(account.id)?.size ?? 0;
              return <tr key={account.id} className="border-t border-white/10">
                <td className="p-4"><strong className="text-white">{account.name}</strong><p className="mt-1 text-slate-400">{account.description || 'Sin descripción'}</p></td>
                <td className="p-4">{assigned}</td><td className="p-4">{minutes.toLocaleString('es-DO')}</td><td className="p-4">{hours.toLocaleString('es-DO', { maximumFractionDigits: 2 })}</td>
              </tr>;
            })}
            {accounts.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400">Todavía no hay cuentas registradas.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
