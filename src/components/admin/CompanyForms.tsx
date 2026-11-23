'use client';

import { useActionState } from 'react';
import { createCompany, assignAccountToCompany } from '@/app/actions/admin-companies';

type Result = { success: boolean; error?: string };
const initial: Result = { success: false };
type CompanyOption = { id: number; name: string };
type AccountOption = { id: number; name: string; clientName: string | null };

export default function CompanyForms({ companies, accounts }: { companies: CompanyOption[]; accounts: AccountOption[] }) {
  const [createResult, createAction, creating] = useActionState(
    async (_previous: Result, formData: FormData): Promise<Result> => createCompany(formData), initial,
  );
  const [assignResult, assignAction, assigning] = useActionState(
    async (_previous: Result, formData: FormData): Promise<Result> => assignAccountToCompany(formData), initial,
  );
  const input = 'min-w-0 w-full sm:w-auto rounded-lg border border-[var(--border)] bg-[var(--theme-panel)] p-3 text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';
  return <>
    <form action={createAction} className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5 md:grid-cols-2">
      <h2 className="md:col-span-2 font-semibold">Registrar identificador de compañía</h2>
      <input name="name" required minLength={2} maxLength={150} placeholder="Nombre de compañía" aria-label="Nombre de compañía" className={input} />
      <button disabled={creating} className="min-h-11 rounded-lg bg-[#1764bf] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">{creating ? 'Guardando…' : 'Registrar compañía'}</button>
      <p role="status" aria-live="polite" className={createResult.error ? 'text-[var(--theme-danger)] md:col-span-2' : 'text-[var(--theme-success)] md:col-span-2'}>{createResult.error || (createResult.success ? 'Compañía registrada correctamente.' : '')}</p>
    </form>
    <form action={assignAction} className="flex flex-wrap gap-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
      <select required name="accountId" aria-label="Cuenta" className={input}><option value="">Seleccionar cuenta</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.clientName || 'Cliente pendiente'} · {a.name}</option>)}</select>
      <select required name="companyId" aria-label="Compañía" className={input}><option value="">Seleccionar compañía</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <button disabled={assigning || !accounts.length || !companies.length} className="min-h-11 rounded-lg bg-[#1764bf] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">{assigning ? 'Vinculando…' : 'Identificar compañía de la cuenta'}</button>
      <p role="status" aria-live="polite" className={assignResult.error ? 'w-full text-[var(--theme-danger)]' : 'w-full text-[var(--theme-success)]'}>{assignResult.error || (assignResult.success ? 'Compañía identificada correctamente.' : '')}</p>
    </form>
  </>;
}
