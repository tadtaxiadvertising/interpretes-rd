import prisma from '@/lib/prisma';
import CreateAccountForm from '@/components/admin/CreateAccountForm';
import EditOperationalAccountForm from '@/components/admin/EditOperationalAccountForm';

export const dynamic = 'force-dynamic';

export default async function AdminAccountsPage() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [accounts, production, clients, companies] = await Promise.all([
    prisma.account.findMany({
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true, name: true, holderName: true, email: true, description: true, clientId: true, companyId: true,
        client: { select: { name: true } },
        company: { select: { name: true } },
        platforms: { where: { active: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { name: true, loginUrl: true, secretRef: true } },
        assignments: { where: { startsAt: { lte: today }, OR: [{ endsAt: null }, { endsAt: { gte: today } }] }, select: { interpreter: { select: { id: true, name: true } } } },
        _count: { select: { assignments: { where: { startsAt: { lte: today }, OR: [{ endsAt: null }, { endsAt: { gte: today } }] } } } },
      },
    }),
    prisma.productionLog.groupBy({
      by: ['accountId'], where: { accountId: { not: null } },
      _sum: { interpretedMinutes: true, connectedHours: true },
    }),
    prisma.client.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.company.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const productionByAccount = new Map(production.map(row => [row.accountId, row._sum]));
  const totalMinutes = production.reduce((sum, row) => sum + (row._sum.interpretedMinutes ?? 0), 0);
  const totalAssignedInterpreters = accounts.reduce((sum, account) => sum + account._count.assignments, 0);
  return <section className="space-y-7 text-slate-100">
    <header>
      <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Administración · Operaciones</p>
      <h1 className="mt-2 text-3xl font-bold">Cuentas operativas</h1>
      <p className="mt-2 text-slate-400">Cada cuenta pertenece a un cliente. La compañía identifica a qué compañía corresponde, sin sustituir al cliente propietario. Las contraseñas nunca se muestran ni se almacenan en texto plano.</p>
    </header>
    <div className="grid gap-4 md:grid-cols-3">
      {[
        ['Cuentas registradas', accounts.length.toLocaleString('es-DO')],
        ['Asignaciones vigentes', totalAssignedInterpreters.toLocaleString('es-DO')],
        ['Minutos históricos', totalMinutes.toLocaleString('es-DO')],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div>)}
    </div>
    <CreateAccountForm clients={clients} companies={companies} />
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[1250px] text-left text-sm">
        <thead className="bg-white/[0.06] text-slate-300"><tr>
          <th className="p-4">Titular / cuenta</th><th className="p-4">Correo</th><th className="p-4">Página de trabajo</th><th className="p-4">Cliente</th><th className="p-4">Compañía</th><th className="p-4">Intérpretes asignados</th><th className="p-4">Minutos</th><th className="p-4">Horas conectadas</th>
        </tr></thead>
        <tbody>{accounts.map(account => {
          const totals = productionByAccount.get(account.id);
          const platform = account.platforms.find(item => item.name === 'Plataforma principal') ?? account.platforms[0];
          return <tr key={account.id} className="border-t border-white/10 align-top">
            <td className="p-4"><strong className="text-white">{account.holderName || 'Titular pendiente'}</strong><p className="mt-1 text-slate-400">{account.name}</p>{account.description && <p className="mt-1 text-xs text-slate-500">{account.description}</p>}<EditOperationalAccountForm account={{ id: account.id, name: account.name, holderName: account.holderName, email: account.email, description: account.description, clientId: account.clientId, companyId: account.companyId, platform: platform ? { loginUrl: platform.loginUrl, secretRef: platform.secretRef } : null }} clients={clients} companies={companies} /></td>
            <td className="p-4">{account.email || 'Pendiente'}</td>
            <td className="p-4">{platform?.loginUrl ? <a href={platform.loginUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline">{platform.name} ↗</a> : 'Sin página registrada'}</td>
            <td className="p-4">{account.client?.name || <span className="text-amber-300">Pendiente de identificar</span>}</td>
            <td className="p-4">{account.company?.name || 'Sin compañía'}</td>
            <td className="p-4"><span>{account._count.assignments}</span>{account.assignments.length > 0 && <ul className="mt-1 space-y-1 text-xs text-slate-400">{account.assignments.map(({ interpreter }) => <li key={interpreter.id}>{interpreter.name}</li>)}</ul>}</td>
            <td className="p-4 tabular-nums">{(totals?.interpretedMinutes ?? 0).toLocaleString('es-DO')}</td>
            <td className="p-4 tabular-nums">{Number(totals?.connectedHours ?? 0).toLocaleString('es-DO', { maximumFractionDigits: 2 })}</td>
          </tr>;
        })}
        {!accounts.length && <tr><td colSpan={8} className="p-8 text-center text-slate-400">Todavía no hay cuentas registradas.</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}
