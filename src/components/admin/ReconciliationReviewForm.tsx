'use client';

import { useActionState } from 'react';
import { recordReconciliationReview } from '@/app/actions/admin-reconciliation-reviews';

type Result = { success: boolean; error?: string };
export default function ReconciliationReviewForm({ reportId }: { reportId: number }) {
  const [state, action, pending] = useActionState(async (_previous: Result, data: FormData): Promise<Result> => recordReconciliationReview(data), { success: false });
  return <form action={action} className="mt-2 grid min-w-[230px] gap-2">
    <input type="hidden" name="reportId" value={reportId} />
    <select name="decision" required aria-label="Estado de revisión" className="rounded-lg border border-white/15 bg-slate-900 p-2">
      <option value="INVESTIGATING">En investigación</option><option value="DISPUTED">En disputa</option><option value="RESOLVED">Resuelto con observaciones</option><option value="MATCHED">Coincidencia confirmada</option>
    </select>
    <textarea name="note" minLength={5} maxLength={2000} required rows={2} placeholder="Justificación de la decisión" aria-label="Justificación" className="rounded-lg border border-white/15 bg-slate-900 p-2" />
    <button disabled={pending} className="rounded-lg bg-[#2675ff] p-2 font-semibold disabled:opacity-50">{pending ? 'Guardando…' : 'Registrar revisión'}</button>
    <p role="status" aria-live="polite" className={state.error ? 'text-red-300' : 'text-emerald-300'}>{state.error || (state.success ? 'Revisión registrada.' : '')}</p>
  </form>;
}
