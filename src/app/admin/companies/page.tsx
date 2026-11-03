import prisma from '@/lib/prisma';
import CompanyForms from '@/components/admin/CompanyForms';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const [companies, accounts] = await Promise.all([
    prisma.company.findMany({ orderBy: { name: 'asc' }, include: { accounts: { select: { id: true, name: true } } } }),
    prisma.account.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, companyId: true } }),
  ]);
  return <section className="space-y-6 text-white">
    <header><p className="text-sm uppercase tracking-widest text-blue-400">Administración</p><h1 className="text-3xl font-bold">Compañías</h1><p className="text-slate-400">Una compañía puede administrar múltiples cuentas operativas. Los registros existentes se conservan.</p></header>
    <CompanyForms companies={companies.map(c => ({ id: c.id, name: c.name }))} accounts={accounts.map(a => ({ id: a.id, name: a.name }))} />
    <div className="grid gap-4 md:grid-cols-2">{companies.map(c => <article key={c.id} className="rounded-2xl border border-white/10 bg-white/5 p-5"><h2 className="text-xl font-semibold">{c.name}</h2><p className="text-sm text-slate-400">{c.legalName || 'Sin razón social'} · {c.country || 'País sin registrar'}</p><p className="mt-3 text-sm text-blue-300">{c.accounts.length} cuentas</p><ul className="mt-2 space-y-1 text-sm text-slate-300">{c.accounts.map(a => <li key={a.id}>{a.name}</li>)}</ul></article>)}</div>
  </section>;
}
