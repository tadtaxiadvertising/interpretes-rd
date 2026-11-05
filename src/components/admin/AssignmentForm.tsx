'use client';

import { useActionState } from 'react';
import { createInterpreterAssignment } from '@/app/actions/admin-assignments';

type Result = { success: boolean; error?: string };
type AccountOption = { id: number; name: string; clientName: string | null; companyName: string | null };
export default function AssignmentForm({ interpreters, accounts }: {
  interpreters: { id: number; name: string }[];
  accounts: AccountOption[];
}) {
  const [state, action, pending] = useActionState(async (_previous: Result, data: FormData): Promise<Result> => createInterpreterAssignment(data), { success: false });
  const cls = 'rounded-lg border border-white/15 bg-slate-900 p-3 text-white';
  return <form action={action} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 md:grid-cols-2">
    <h2 className="md:col-span-2 text-lg font-semibold">Nueva asignación</h2>
    <label className="grid gap-1 text-sm">Intérprete<select required name="interpreterId" className={cls}><option value="">Seleccionar</option>{interpreters.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Cuenta<select required name="accountId" className={cls}><option value="">Seleccionar</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.clientName || 'Cliente pendiente'} · {a.companyName || 'Sin compañía'} · {a.name}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Inicio<input required type="date" name="startsAt" className={cls} /></label>
    <label className="grid gap-1 text-sm">Fin (opcional)<input type="date" name="endsAt" className={cls} /></label>
    <label className="grid gap-1 text-sm md:col-span-2">Notas<textarea name="notes" maxLength={500} rows={2} className={cls} /></label>
    <button disabled={pending || !accounts.length || !interpreters.length} className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold disabled:opacity-50">{pending ? 'Guardando…' : 'Crear asignación'}</button>
    <p role="status" aria-live="polite" className={state.error ? 'text-red-300' : 'text-emerald-300'}>{state.error || (state.success ? 'Asignación registrada.' : '')}</p>
  </form>;
}
