'use client';

import { useActionState } from 'react';
import { createOperationalAccount } from '@/app/actions/admin-accounts';

type State = { success: boolean; error?: string };
const initialState: State = { success: false };

export default function CreateAccountForm({ clients, companies }: { clients: { id: number; name: string }[]; companies: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(async (_previous: State, data: FormData): Promise<State> => createOperationalAccount(data), initialState);
  const field = 'mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white';
  return (
    <form action={action} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-4">
      <h2 className="text-lg font-semibold text-white">Nueva cuenta operativa</h2>
      <p className="text-sm text-slate-400">Registra titular, acceso a la plataforma y cliente propietario. La aplicación solo registra una referencia al gestor de secretos; no guarda ni recupera la contraseña.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">Cliente propietario
          <select name="clientId" required className={field}>
            <option value="">Seleccionar cliente</option>
            {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label className="block text-sm text-slate-300">Compañía asociada (opcional)
          <select name="companyId" className={field}><option value="">Sin compañía asignada</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select>
        </label>
        <label className="block text-sm text-slate-300">Identificador de cuenta
          <input name="name" required minLength={2} maxLength={120} placeholder="Ej. Cuenta principal" className={field} />
        </label>
        <label className="block text-sm text-slate-300">Nombre del titular
          <input name="holderName" required minLength={2} maxLength={160} autoComplete="name" className={field} />
        </label>
        <label className="block text-sm text-slate-300">Correo de acceso
          <input name="email" type="email" required maxLength={254} autoComplete="username" className={field} />
        </label>
        <label className="block text-sm text-slate-300 md:col-span-2">Página donde se trabaja (HTTPS)
          <input name="loginUrl" type="url" required placeholder="https://plataforma.example.com" className={field} />
        </label>
        <label className="block text-sm text-slate-300 md:col-span-2">Referencia de contraseña en gestor seguro
          <input name="secretRef" required placeholder="vault://organizacion/cuenta/plataforma" className={field} />
        </label>
        <label className="block text-sm text-slate-300 md:col-span-2">Descripción (opcional)
          <textarea name="description" maxLength={1000} rows={2} className={field} />
        </label>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-emerald-300">Cuenta registrada correctamente.</p>}
      <button disabled={pending || !clients.length} className="rounded-lg bg-[#2675ff] px-4 py-2 font-semibold text-white disabled:opacity-50">{pending ? 'Guardando…' : 'Crear cuenta'}</button>
      {!clients.length && <p className="text-xs text-amber-300">Registra un cliente antes de crear cuentas operativas.</p>}
    </form>
  );
}
