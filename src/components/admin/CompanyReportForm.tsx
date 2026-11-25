'use client';

import { useActionState } from 'react';
import { registerCompanyReport } from '@/app/actions/admin-company-reports';

type Result = { success: boolean; error?: string };
type AccountOption = { id: number; name: string; clientName: string | null; companyName: string | null };
export default function CompanyReportForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState(async (_previous: Result, formData: FormData): Promise<Result> => registerCompanyReport(formData), { success: false });
  const cls = 'min-w-0 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-3 text-[var(--theme-control-text)]';
  return <form action={action} className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5 md:grid-cols-2">
    <h2 className="md:col-span-2 text-lg font-semibold">Registrar resumen externo</h2>
    <label className="grid min-w-0 gap-1 text-sm">Cuenta<select required name="accountId" className={cls}><option value="">Seleccionar</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.clientName || 'Cliente pendiente'} · {a.companyName || 'Sin compañía'} · {a.name}</option>)}</select></label>
    <label className="grid min-w-0 gap-1 text-sm">Referencia del reporte<input required name="sourceName" maxLength={150} placeholder="Nombre / referencia" className={cls} /></label>
    <label className="grid min-w-0 gap-1 text-sm">Desde<input required type="date" name="periodStart" className={cls} /></label>
    <label className="grid min-w-0 gap-1 text-sm">Hasta<input required type="date" name="periodEnd" className={cls} /></label>
    <label className="grid min-w-0 gap-1 text-sm">Minutos reportados<input required type="number" min={0} name="reportedMinutes" className={cls} /></label>
    <label className="grid min-w-0 gap-1 text-sm">Llamadas reportadas (opcional)<input type="number" min={0} name="reportedCalls" className={cls} /></label>
    <label className="grid min-w-0 gap-1 text-sm md:col-span-2">Observaciones<textarea name="notes" maxLength={1000} rows={2} className={cls} /></label>
    <button disabled={pending || !accounts.length} className="rounded-lg theme-action-primary px-4 py-3 font-semibold">{pending ? 'Registrando…' : 'Registrar reporte'}</button>
    <p role="status" aria-live="polite" className={state.error ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-success)]'}>{state.error || (state.success ? 'Reporte registrado correctamente.' : '')}</p>
  </form>;
}
