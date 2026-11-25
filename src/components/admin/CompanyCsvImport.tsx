'use client';

import { useActionState } from 'react';
import { importCompanyReportsCsv } from '@/app/actions/admin-company-csv';

type Result = { success: boolean; error?: string; inserted?: number; duplicates?: number };

export default function CompanyCsvImport() {
  const [state, action, pending] = useActionState(async (_previous: Result, data: FormData): Promise<Result> => importCompanyReportsCsv(data), { success: false });
  return <form action={action} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
    <h2 className="text-lg font-semibold">Importar reportes desde CSV</h2>
    <p className="text-sm text-[var(--text-secondary)]">Máximo 500 filas y 1 MB. Columnas obligatorias: accountId, periodStart, periodEnd, sourceName, reportedMinutes, reportedCalls, notes. Fechas YYYY-MM-DD; usa valores vacíos para llamadas o notas opcionales. Los duplicados exactos se omiten.</p>
    <p className="text-xs text-[var(--text-secondary)]">Ejemplo: 1,2026-11-01,2026-11-03,Reporte noviembre,240,15,Importación inicial</p>
    <input type="file" name="file" required accept=".csv,text/csv" aria-label="Archivo CSV de reportes" className="block min-w-0 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-3 text-sm text-[var(--theme-control-text)]" />
    <button disabled={pending} className="rounded-lg theme-action-primary px-4 py-3 font-semibold">{pending ? 'Importando…' : 'Validar e importar CSV'}</button>
    <p role="status" aria-live="polite" className={state.error ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-success)]'}>{state.error || (state.success ? `Importados: ${state.inserted ?? 0}. Duplicados omitidos: ${state.duplicates ?? 0}.` : '')}</p>
  </form>;
}
