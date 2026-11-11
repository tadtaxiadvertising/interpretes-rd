'use client';

import { useActionState } from 'react';
import { updateOperationalAccount } from '@/app/actions/admin-accounts';

type State = { success: boolean; error?: string };
const initialState: State = { success: false };

type Props = {
  account: {
    id: number;
    name: string;
    holderName: string | null;
    email: string | null;
    description: string | null;
    clientId: number | null;
    companyId: number | null;
    platform: { loginUrl: string | null; secretRef: string | null } | null;
  };
  clients: { id: number; name: string }[];
  companies: { id: number; name: string }[];
};

export default function EditOperationalAccountForm({ account, clients, companies }: Props) {
  const [state, action, pending] = useActionState(
    async (_previous: State, data: FormData): Promise<State> => updateOperationalAccount(data),
    initialState
  );
  const field = 'mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white';
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-semibold text-blue-300 hover:text-blue-200">Editar cuenta y acceso</summary>
      <form action={action} className="mt-3 grid gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-4 text-left">
        <input type="hidden" name="accountId" value={account.id} />
        <label className="text-xs text-slate-300">Cliente propietario
          <select name="clientId" required defaultValue={account.clientId ?? ''} className={field}>
            <option value="">Seleccionar cliente</option>
            {clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-300">Compañía
          <select name="companyId" defaultValue={account.companyId ?? ''} className={field}>
            <option value="">Sin compañía</option>
            {companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-300">Identificador de cuenta
          <input name="name" required minLength={2} maxLength={120} defaultValue={account.name} className={field} />
        </label>
        <label className="text-xs text-slate-300">Titular
          <input name="holderName" required minLength={2} maxLength={160} defaultValue={account.holderName ?? ''} className={field} />
        </label>
        <label className="text-xs text-slate-300">Correo de acceso
          <input name="email" type="email" required maxLength={254} defaultValue={account.email ?? ''} className={field} />
        </label>
        <label className="text-xs text-slate-300">Página de trabajo (HTTPS)
          <input name="loginUrl" type="url" required defaultValue={account.platform?.loginUrl ?? ''} className={field} />
        </label>
        <label className="text-xs text-slate-300">Referencia del secreto (vault://)
          <input name="secretRef" required defaultValue={account.platform?.secretRef ?? ''} placeholder="vault://organizacion/cuenta/plataforma" className={field} />
        </label>
        <label className="text-xs text-slate-300">Descripción
          <textarea name="description" maxLength={1000} rows={2} defaultValue={account.description ?? ''} className={field} />
        </label>
        {state.error && <p role="alert" className="text-xs text-red-300">{state.error}</p>}
        {state.success && <p role="status" className="text-xs text-emerald-300">Cuenta actualizada correctamente.</p>}
        <button disabled={pending} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <p className="text-[11px] text-slate-500">La contraseña no se muestra ni se almacena aquí; solo se conserva su referencia segura.</p>
      </form>
    </details>
  );
}
