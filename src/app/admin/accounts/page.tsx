import prisma from '@/lib/prisma';
import CreateAccountForm from '@/components/admin/CreateAccountForm';

export const dynamic = 'force-dynamic';

export default async function AdminAccountsPage() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Use the assignment history as the source of interpreter-account links.
  // InterpreterAccountRate is a pricing relation, not an assignment record.
  const [accounts, production] = await Promise.all([
    prisma.account.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        company: { select: { name: true } },
        _count: {
          select: {
            assignments: {
              where: {
                startsAt: { lte: today },
                OR: [{ endsAt: null }, { endsAt: { gte: today } }],
              },
            },
          },
        },
      },
    }),
    prisma.productionLog.groupBy({
      by: ['accountId'],
      where: { accountId: { not: null } },
      _sum: { interpretedMinutes: true, connectedHours: true },
    }),
  ]);

  const productionByAccount = new Map(production.map(row => [row.accountId, row._sum]));
  const totalMinutes = production.reduce(
    (sum, row) => sum + (row._sum.interpretedMinutes ?? 0),
    0,
  );
  const totalAssignedInterpreters = accounts.reduce(
    (sum, account) => sum + account._count.assignments,
    0,
  );

  return (
    <section className="space-y-7 text-slate-100">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Administración · Operaciones</p>
        <h1 className="mt-2 text-3xl font-bold">Cuentas y compañías</h1>
        <p className="mt-2 text-slate-400">
          Administra las cuentas operativas, sus compañías asociadas, las asignaciones vigentes y la producción histórica.
          Las plataformas y los reportes externos se gestionan en sus secciones correspondientes.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['Cuentas registradas', accounts.length.toLocaleString('es-DO')],
          ['Asignaciones vigentes', totalAssignedInterpreters.toLocaleString('es-DO')],
          ['Minutos históricos', totalMinutes.toLocaleString('es-DO')],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <CreateAccountForm />
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-white/[0.06] text-slate-300">
            <tr>
              <th className="p-4">Cuenta</th>
              <th className="p-4">Compañía</th>
              <th className="p-4">Intérpretes asignados</th>
              <th className="p-4">Minutos</th>
              <th className="p-4">Horas conectadas</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(account => {
              const productionTotals = productionByAccount.get(account.id);
              const minutes = productionTotals?.interpretedMinutes ?? 0;
              const hours = Number(productionTotals?.connectedHours ?? 0);
              return (
                <tr key={account.id} className="border-t border-white/10">
                  <td className="p-4">
                    <strong className="text-white">{account.name}</strong>
                    <p className="mt-1 text-slate-400">{account.description || 'Sin descripción'}</p>
                  </td>
                  <td className="p-4">{account.company?.name || 'Sin compañía'}</td>
                  <td className="p-4">{account._count.assignments}</td>
                  <td className="p-4">{minutes.toLocaleString('es-DO')}</td>
                  <td className="p-4">{hours.toLocaleString('es-DO', { maximumFractionDigits: 2 })}</td>
                </tr>
              );
            })}
            {accounts.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">Todavía no hay cuentas registradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
