import prisma, { getRawPool } from '@/lib/prisma';
import { inspectAccountVpnSchema } from '@/lib/account-vpn-schema-readiness';
import AccountPlatformForm from '@/components/admin/AccountPlatformForm';

export const dynamic = 'force-dynamic';

export default async function AccountPlatformsPage() {
  // The VPN schema may lag the generated Prisma model while deployment is blocked.
  const vpnSchemaStatus = await inspectAccountVpnSchema(getRawPool());
  const [accounts, platforms] = await Promise.all([
    prisma.account.findMany({
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, client: { select: { name: true } }, company: { select: { name: true } } },
    }),
    prisma.accountPlatform.findMany({
      orderBy: [{ accountId: 'asc' }, { name: 'asc' }],
      take: 200,
      select: {
        id: true, name: true, active: true, loginUrl: true, secretRef: true,
        account: { select: { name: true, client: { select: { name: true } }, company: { select: { name: true } } } },
      },
    }),
  ]);
  // Read VPN fields only after ALL expected columns and the CHECK are verified.
  const vpnDetails = vpnSchemaStatus === 'complete' && platforms.length
    ? await prisma.accountPlatform.findMany({
        where: { id: { in: platforms.map(platform => platform.id) } },
        select: {
          id: true, vpnProvider: true, vpnApp: true, vpnUsernameHint: true,
          vpnSecretRef: true, vpnCountry: true, vpnRegion: true,
          vpnServer: true, vpnExitIp: true, vpnProfile: true,
          vpnProtocol: true, vpnPort: true,
        },
      })
    : [];
  const vpnByPlatformId = new Map(vpnDetails.map(vpn => [vpn.id, vpn]));
  const platformsWithVpn = platforms.map(platform => ({
    ...platform,
    vpn: vpnByPlatformId.get(platform.id),
  }));
  return <section className="space-y-6 text-white">
    <header><p className="text-sm uppercase tracking-widest text-blue-400">Administración · Operaciones</p><h1 className="text-3xl font-bold">Plataformas externas</h1><p className="text-slate-400">Directorio de plataformas por cuenta y cliente. No almacena contraseñas ni tokens, y las referencias a gestores de secretos no conceden acceso por sí mismas.</p></header>
    {vpnSchemaStatus !== 'complete' && (
      <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        <strong>Configuración VPN temporalmente no disponible.</strong>{' '}
        {vpnSchemaStatus === 'missing'
          ? 'La migración VPN todavía no está aplicada en esta base de datos.'
          : 'La configuración VPN de esta base de datos está incompleta.'}
        {' '}Se conserva el directorio de plataformas, pero la creación y los detalles VPN
        permanecen suspendidos hasta verificar la migración. No vuelvas a guardar secretos para resolverlo.
      </div>
    )}
    {vpnSchemaStatus === 'complete' && <AccountPlatformForm accounts={accounts} />}
    <div className="grid gap-3 md:grid-cols-2">{platformsWithVpn.map(p => <article key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold">{p.name}</h2>
      <p className="text-sm text-slate-400">{p.account.client?.name || 'Cliente pendiente'} · {p.account.company?.name || 'Sin compañía'} / {p.account.name}</p>
      <p className="mt-2 text-xs text-slate-400">{p.active ? 'Activa' : 'Inactiva'} · {p.secretRef ? 'Referencia de secreto registrada' : 'Sin referencia de secreto'}</p>
      {p.vpn ? <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300">
        <p className="font-semibold text-slate-200">Configuración VPN</p>
        <p className="mt-1">{[p.vpn.vpnProvider, p.vpn.vpnApp, p.vpn.vpnUsernameHint ? 'Usuario configurado' : null].filter(Boolean).join(' · ') || 'Proveedor y aplicación pendientes'}</p>
        <p className="mt-1">{[p.vpn.vpnCountry, p.vpn.vpnRegion, p.vpn.vpnServer, p.vpn.vpnExitIp, p.vpn.vpnProfile, p.vpn.vpnProtocol, p.vpn.vpnPort ? `Puerto ${p.vpnPort}` : null].filter(Boolean).join(' · ') || 'Sin detalles de servidor o ubicación'}</p>
        <p className="mt-1">{p.vpn.vpnSecretRef ? 'Referencia segura VPN registrada' : 'Sin referencia segura VPN'}</p>
      </div> : <p className="mt-3 text-xs text-amber-300">Detalles VPN ocultos hasta verificar la migración.</p>}
      {p.loginUrl && <a href="https://whoer.net/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-blue-300 hover:underline">Comprobar VPN en Whoer.net ↗</a>}
    </article>)}</div>
    {!platforms.length && <p className="text-slate-400">No hay plataformas registradas.</p>}
    <p className="text-xs text-slate-500">Se muestran hasta 200 plataformas. No se muestran identificadores de usuario ni referencias internas de secretos en este listado.</p>
  </section>;
}
