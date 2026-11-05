import prisma from '@/lib/prisma';
import AccountPlatformForm from '@/components/admin/AccountPlatformForm';

export const dynamic = 'force-dynamic';

export default async function AccountPlatformsPage() {
  const [accounts, platforms] = await Promise.all([
    prisma.account.findMany({
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, client: { select: { name: true } }, company: { select: { name: true } } },
    }),
    prisma.accountPlatform.findMany({ orderBy: [{ accountId: 'asc' }, { name: 'asc' }], take: 200, include: { account: { select: { name: true, client: { select: { name: true } }, company: { select: { name: true } } } } } }),
  ]);
  return <section className="space-y-6 text-white">
    <header><p className="text-sm uppercase tracking-widest text-blue-400">Administración · Operaciones</p><h1 className="text-3xl font-bold">Plataformas externas</h1><p className="text-slate-400">Directorio de plataformas por cuenta y cliente. No almacena contraseñas ni tokens, y las referencias a gestores de secretos no conceden acceso por sí mismas.</p></header>
    <AccountPlatformForm accounts={accounts} />
    <div className="grid gap-3 md:grid-cols-2">{platforms.map(p => <article key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold">{p.name}</h2>
      <p className="text-sm text-slate-400">{p.account.client?.name || 'Cliente pendiente'} · {p.account.company?.name || 'Sin compañía'} / {p.account.name}</p>
      <p className="mt-2 text-xs text-slate-400">{p.active ? 'Activa' : 'Inactiva'} · {p.secretRef ? 'Referencia de secreto registrada' : 'Sin referencia de secreto'}</p>
      {p.loginUrl && <a href={p.loginUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-blue-300 hover:underline">Abrir acceso externo</a>}
    </article>)}</div>
    {!platforms.length && <p className="text-slate-400">No hay plataformas registradas.</p>}
    <p className="text-xs text-slate-500">Se muestran hasta 200 plataformas. No se muestran identificadores de usuario ni referencias internas de secretos en este listado.</p>
  </section>;
}
