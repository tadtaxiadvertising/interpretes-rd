'use client';

import { useActionState } from 'react';
import { createOperationalAccount } from '@/app/actions/admin-accounts';

type State = { success: boolean; error?: string };
const initialState: State = { success: false };

export default function CreateAccountForm() {
  const [state, action, pending] = useActionState(async (_previous: State, data: FormData): Promise<State> => {
    return createOperationalAccount(data);
  }, initialState);
  return (
    <form action={action} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-4">
      <h2 className="text-lg font-semibold text-white">Nueva cuenta operativa</h2>
      <p className="text-sm text-slate-400">Registra una cuenta existente sin guardar contraseñas ni datos sensibles aquí.</p>
      <label className="block text-sm text-slate-300">Nombre
        <input name="name" required minLength={2} maxLength={120} className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white" />
      </label>
      <label className="block text-sm text-slate-300">Descripción
        <textarea name="description" maxLength={1000} rows={2} className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-white" />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-emerald-300">Cuenta registrada correctamente.</p>}
      <button disabled={pending} className="rounded-lg bg-[#2675ff] px-4 py-2 font-semibold text-white disabled:opacity-50">{pending ? 'Guardando…' : 'Crear cuenta'}</button>
    </form>
  );
}
