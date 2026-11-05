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
      <h2 className="md:col-span-2 text-lg font-semibold">Registrar plataforma externa</h2>
      <label className="grid gap-1 text-sm">Cuenta
        <select name="accountId" required className={cls}>
          <option value="">Seleccionar cuenta</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Nombre de plataforma<input name="name" required minLength={2} maxLength={120} className={cls} /></label>
      <label className="grid gap-1 text-sm">URL de acceso HTTPS<input name="loginUrl" type="url" placeholder="https://..." className={cls} /></label>
      <label className="grid gap-1 text-sm">Identificador de usuario (no contraseña)<input name="usernameHint" maxLength={150} className={cls} /></label>
      <label className="grid gap-1 text-sm md:col-span-2">Referencia externa a gestor de secretos<input name="secretRef" placeholder="vault://empresa/cuenta/plataforma" className={cls} /></label>
      <label className="grid gap-1 text-sm md:col-span-2">Notas (sin contraseñas ni tokens)<textarea name="notes" maxLength={500} rows={2} className={cls} /></label>
      <p className="text-xs text-amber-200 md:col-span-2">No pegues contraseñas, API keys ni tokens. Esta función solo guarda una referencia; no se conecta a un gestor de secretos.</p>
      <button disabled={pending || !accounts.length} className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold disabled:opacity-50">{pending ? 'Guardando…' : 'Registrar plataforma'}</button>
      <p role="status" aria-live="polite" className={state.error ? 'text-red-300' : 'text-emerald-300'}>{state.error || (state.success ? 'Plataforma registrada.' : '')}</p>
    </form>
  );
}
