'use client';

import { useActionState } from 'react';
import { createAccountPlatform } from '@/app/actions/admin-account-platforms';

type Result = { success: boolean; error?: string };
type AccountOption = { id: number; name: string; client: { name: string } | null; company: { name: string } | null };
function accountLabel(account: AccountOption) {
  return [account.client?.name || 'Cliente pendiente', account.company?.name || 'Sin compañía', account.name].join(' · ');
}

export default function AccountPlatformForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState(async (_previous: Result, data: FormData): Promise<Result> => createAccountPlatform(data), { success: false });
  const cls = 'rounded-lg border border-white/15 bg-slate-900 p-3 text-white';
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 md:grid-cols-2">
      <h2 className="md:col-span-2 text-lg font-semibold">Registrar plataforma y conexión VPN</h2>
      <label className="grid gap-1 text-sm">Cuenta
        <select name="accountId" required className={cls}>
          <option value="">Seleccionar cuenta</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Nombre de plataforma<input name="name" required minLength={2} maxLength={120} className={cls} /></label>
      <label className="grid gap-1 text-sm">URL de acceso HTTPS<input name="loginUrl" type="url" placeholder="https://..." className={cls} /></label>
      <label className="grid gap-1 text-sm">Usuario de plataforma (no contraseña)<input name="usernameHint" maxLength={150} className={cls} /></label>
      <label className="grid gap-1 text-sm md:col-span-2">Referencia de contraseña en gestor seguro<input name="secretRef" placeholder="vault://empresa/cuenta/plataforma" className={cls} /></label>

      <div className="md:col-span-2 mt-2 border-t border-white/10 pt-4">
        <h3 className="font-semibold">Configuración VPN</h3>
        <p className="mt-1 text-xs text-slate-400">Los datos son editables y no están vinculados a un proveedor, país, perfil o slot específico.</p>
      </div>
      <label className="grid gap-1 text-sm">Proveedor VPN<input name="vpnProvider" maxLength={120} placeholder="Proveedor o servicio" className={cls} /></label>
      <label className="grid gap-1 text-sm">Aplicación VPN<input name="vpnApp" maxLength={120} placeholder="Nombre de la aplicación" className={cls} /></label>
      <label className="grid gap-1 text-sm">Usuario VPN<input name="vpnUsernameHint" maxLength={150} autoComplete="off" className={cls} /></label>
      <label className="grid gap-1 text-sm">Referencia de contraseña VPN<input name="vpnSecretRef" placeholder="vault://empresa/cuenta/vpn" className={cls} /></label>
      <label className="grid gap-1 text-sm">País de salida esperado<input name="vpnCountry" maxLength={80} placeholder="País" className={cls} /></label>
      <label className="grid gap-1 text-sm">Ciudad / región<input name="vpnRegion" maxLength={100} placeholder="Ciudad o región" className={cls} /></label>
      <label className="grid gap-1 text-sm">Servidor / hostname<input name="vpnServer" maxLength={255} className={cls} /></label>
      <label className="grid gap-1 text-sm">IP de salida esperada<input name="vpnExitIp" maxLength={45} placeholder="IPv4 o IPv6" className={cls} /></label>
      <label className="grid gap-1 text-sm">Perfil / slot<input name="vpnProfile" maxLength={100} placeholder="Opcional; depende del proveedor" className={cls} /></label>
      <label className="grid gap-1 text-sm">Protocolo<input name="vpnProtocol" maxLength={40} placeholder="WireGuard, OpenVPN, etc." className={cls} /></label>
      <label className="grid gap-1 text-sm">Puerto<input name="vpnPort" type="number" min={1} max={65535} inputMode="numeric" className={cls} /></label>
      <label className="grid gap-1 text-sm md:col-span-2">Notas operativas<textarea name="notes" maxLength={500} rows={2} className={cls} /></label>

      <div className="md:col-span-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">
        Antes de iniciar sesión en el portal, abre <a href="https://whoer.net/" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Whoer.net</a> y comprueba manualmente que el país y la IP de salida coincidan con los valores esperados. Las contraseñas no se guardan aquí: utiliza referencias vault://.
      </div>
      <button disabled={pending || !accounts.length} className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold disabled:opacity-50">{pending ? 'Guardando…' : 'Registrar plataforma'}</button>
      <p role="status" aria-live="polite" className={state.error ? 'text-red-300' : 'text-emerald-300'}>{state.error || (state.success ? 'Plataforma registrada.' : '')}</p>
    </form>
  );
}
