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
  const field = 'mt-1 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 py-2 text-[var(--theme-control-text)]';
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--theme-link)] hover:text-[var(--theme-link)]">Editar cuenta y acceso</summary>
      <form action={action} className="mt-3 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] p-4 text-left">
        <input type="hidden" name="accountId" value={account.id} />
        <label className="text-xs text-[var(--text-secondary)]">Cliente propietario
          <select name="clientId" required defaultValue={account.clientId ?? ''} className={field}>
            <option value="">Seleccionar cliente</option>
            {clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--text-secondary)]">Compañía
          <select name="companyId" defaultValue={account.companyId ?? ''} className={field}>
            <option value="">Sin compañía</option>
            {companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--text-secondary)]">Identificador de cuenta
          <input name="name" required minLength={2} maxLength={120} defaultValue={account.name} className={field} />
        </label>
        <label className="text-xs text-[var(--text-secondary)]">Titular
          <input name="holderName" required minLength={2} maxLength={160} defaultValue={account.holderName ?? ''} className={field} />
        </label>
        <label className="text-xs text-[var(--text-secondary)]">Correo de acceso
          <input name="email" type="email" required maxLength={254} defaultValue={account.email ?? ''} className={field} />
        </label>
        <label className="text-xs text-[var(--text-secondary)]">Página de trabajo (HTTPS)
          <input name="loginUrl" type="url" required defaultValue={account.platform?.loginUrl ?? ''} className={field} />
        </label>
        <label className="text-xs text-[var(--text-secondary)]">Referencia del secreto (vault://)
          <input name="secretRef" required defaultValue={account.platform?.secretRef ?? ''} placeholder="vault://organizacion/cuenta/plataforma" className={field} />
        </label>
        <label className="text-xs text-[var(--text-secondary)]">Descripción
          <textarea name="description" maxLength={1000} rows={2} defaultValue={account.description ?? ''} className={field} />
        </label>
        {state.error && <p role="alert" className="text-xs text-[var(--theme-danger)]">{state.error}</p>}
        {state.success && <p role="status" className="text-xs text-[var(--theme-success)]">Cuenta actualizada correctamente.</p>}
        <button disabled={pending} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <p className="text-[11px] text-[var(--text-tertiary)]">La contraseña no se muestra ni se almacena aquí; solo se conserva su referencia segura.</p>
      </form>
    </details>
  );
}
