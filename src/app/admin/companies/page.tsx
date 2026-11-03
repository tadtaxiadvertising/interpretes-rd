import prisma from '@/lib/prisma';
import { createCompany, assignAccountToCompany } from '@/app/actions/admin-companies';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const [companies, accounts] = await Promise.all([
    prisma.company.findMany({ orderBy: { name: 'asc' }, include: { accounts: { select: { id: true, name: true } } } }),
    prisma.account.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, companyId: true } }),
  ]);
  return <section className="space-y-6 text-white">
    <header><p className="text-sm uppercase tracking-widest text-blue-400">Administración</p><h1 className="text-3xl font-bold">Compañías</h1><p className="text-slate-400">Una compañía puede administrar múltiples cuentas operativas. Los registros existentes se conservan.</p></header>
    <form action={createCompany} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 md:grid-cols-2">
      <h2 className="md:col-span-2 font-semibold">Registrar compañía</h2>
      <input name="name" required minLength={2} maxLength={150} placeholder="Nombre de compañía" aria-label="Nombre de compañía" className="rounded-lg bg-slate-900 p-3" />
      <input name="legalName" maxLength={200} placeholder="Razón social" aria-label="Razón social" className="rounded-lg bg-slate-900 p-3" />
      <input name="contactEmail" type="email" placeholder="Correo de contacto" aria-label="Correo de contacto" className="rounded-lg bg-slate-900 p-3" />
      <input name="billingEmail" type="email" placeholder="Correo de facturación" aria-label="Correo de facturación" className="rounded-lg bg-slate-900 p-3" />
      <input name="country" maxLength={100} placeholder="País" aria-label="País" className="rounded-lg bg-slate-900 p-3" />
      <button className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold">Registrar compañía</button>
    </form>
    <form action={assignAccountToCompany} className="flex flex-wrap gap-3 rounded-2xl border border-white/10 p-5">
      <select required name="accountId" aria-label="Cuenta" className="rounded-lg bg-slate-900 p-3"><option value="">Seleccionar cuenta</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <select required name="companyId" aria-label="Compañía" className="rounded-lg bg-slate-900 p-3"><option value="">Seleccionar compañía</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <button className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold">Vincular cuenta</button>
    </form>
    <div className="grid gap-4 md:grid-cols-2">{companies.map(c => <article key={c.id} className="rounded-2xl border border-white/10 bg-white/5 p-5"><h2 className="text-xl font-semibold">{c.name}</h2><p className="text-sm text-slate-400">{c.legalName || 'Sin razón social'} · {c.country || 'País sin registrar'}</p><p className="mt-3 text-sm text-blue-300">{c.accounts.length} cuentas</p><ul className="mt-2 space-y-1 text-sm text-slate-300">{c.accounts.map(a => <li key={a.id}>{a.name}</li>)}</ul></article>)}</div>
  </section>;
}
