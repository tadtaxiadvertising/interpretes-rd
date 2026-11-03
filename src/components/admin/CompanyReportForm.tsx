'use client';

import { useActionState } from 'react';
import { registerCompanyReport } from '@/app/actions/admin-company-reports';

type Result = { success: boolean; error?: string };
export default function CompanyReportForm({ accounts }: { accounts: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(async (_previous: Result, formData: FormData): Promise<Result> => registerCompanyReport(formData), { success: false });
  const cls = 'rounded-lg border border-white/15 bg-slate-900 p-3 text-white';
  return <form action={action} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 md:grid-cols-2">
    <h2 className="md:col-span-2 text-lg font-semibold">Registrar resumen externo</h2>
    <label className="grid gap-1 text-sm">Cuenta<select required name="accountId" className={cls}><option value="">Seleccionar</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Referencia del reporte<input required name="sourceName" maxLength={150} placeholder="Nombre / referencia" className={cls} /></label>
    <label className="grid gap-1 text-sm">Desde<input required type="date" name="periodStart" className={cls} /></label>
    <label className="grid gap-1 text-sm">Hasta<input required type="date" name="periodEnd" className={cls} /></label>
    <label className="grid gap-1 text-sm">Minutos reportados<input required type="number" min={0} name="reportedMinutes" className={cls} /></label>
    <label className="grid gap-1 text-sm">Llamadas reportadas (opcional)<input type="number" min={0} name="reportedCalls" className={cls} /></label>
    <label className="grid gap-1 text-sm md:col-span-2">Observaciones<textarea name="notes" maxLength={1000} rows={2} className={cls} /></label>
    <button disabled={pending || !accounts.length} className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold disabled:opacity-50">{pending ? 'Registrando…' : 'Registrar reporte'}</button>
    <p role="status" aria-live="polite" className={state.error ? 'text-red-300' : 'text-emerald-300'}>{state.error || (state.success ? 'Reporte registrado correctamente.' : '')}</p>
  </form>;
}
