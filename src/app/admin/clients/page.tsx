import prisma from '@/lib/prisma';
import ClientForms from '@/components/admin/ClientForms';

export const dynamic = 'force-dynamic';

export default async function AdminClientsPage() {
  const [clients, accounts] = await Promise.all([
    prisma.client.findMany({
      orderBy: { name: 'asc' },
      include: { accounts: { orderBy: { name: 'asc' }, select: { id: true, name: true, company: { select: { name: true } } } } },
    }),
    prisma.account.findMany({
      where: { clientId: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, company: { select: { name: true } } },
    }),
  ]);
  return <section className="space-y-6 text-white">
    <header>
      <p className="text-sm uppercase tracking-widest text-blue-400">Administración · Operaciones</p>
      <h1 className="text-3xl font-bold">Clientes</h1>
      <p className="max-w-3xl text-slate-400">Cada cliente es quien proporciona y administra sus cuentas operativas. Una misma compañía puede estar presente en cuentas pertenecientes a distintos clientes.</p>
    </header>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-sm text-slate-400">Clientes registrados</p><p className="mt-2 text-3xl font-bold">{clients.length}</p></div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-sm text-slate-400">Cuentas asignadas</p><p className="mt-2 text-3xl font-bold">{clients.reduce((sum, client) => sum + client.accounts.length, 0)}</p></div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-sm text-slate-400">Cuentas por identificar</p><p className="mt-2 text-3xl font-bold">{accounts.length}</p></div>
    </div>
    <ClientForms
      clients={clients.filter(client => client.active).map(client => ({ id: client.id, name: client.name }))}
      unassignedAccounts={accounts.map(account => ({ id: account.id, name: account.name, companyName: account.company?.name ?? null }))}
    />
    <div className="grid gap-4 md:grid-cols-2">
      {clients.map(client => <article key={client.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start justify-between gap-3"><h2 className="text-xl font-semibold">{client.name}</h2><span className="text-xs text-slate-400">{client.active ? 'Activo' : 'Inactivo'}</span></div>
        <p className="mt-1 text-sm text-slate-400">{client.contactName || 'Sin contacto'}{client.contactEmail ? ' · ' + client.contactEmail : ''}</p>
        <p className="mt-3 text-sm text-blue-300">{client.accounts.length} cuentas</p>
        <ul className="mt-2 space-y-2 text-sm text-slate-300">
          {client.accounts.map(account => <li key={account.id} className="flex justify-between gap-3"><span>{account.name}</span><span className="text-slate-500">{account.company?.name || 'Sin compañía'}</span></li>)}
          {!client.accounts.length && <li className="text-slate-500">Sin cuentas asignadas.</li>}
        </ul>
      </article>)}
      {!clients.length && <p className="text-slate-400">Todavía no hay clientes registrados.</p>}
    </div>
  </section>;
}
