'use client';

import { useActionState } from 'react';
import { createCompany, assignAccountToCompany } from '@/app/actions/admin-companies';

type Result = { success: boolean; error?: string };
const initial: Result = { success: false };

type CompanyOption = { id: number; name: string };
type AccountOption = { id: number; name: string };

export default function CompanyForms({ companies, accounts }: { companies: CompanyOption[]; accounts: AccountOption[] }) {
  const [createResult, createAction, creating] = useActionState(
    async (_previous: Result, formData: FormData): Promise<Result> => createCompany(formData), initial
  );
  const [assignResult, assignAction, assigning] = useActionState(
    async (_previous: Result, formData: FormData): Promise<Result> => assignAccountToCompany(formData), initial
  );
  const input = 'rounded-lg border border-white/15 bg-slate-900 p-3 text-white';
  return <>
    <form action={createAction} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 md:grid-cols-2">
      <h2 className="md:col-span-2 font-semibold">Registrar compañía</h2>
      <input name="name" required minLength={2} maxLength={150} placeholder="Nombre de compañía" aria-label="Nombre de compañía" className={input} />
      <input name="legalName" maxLength={200} placeholder="Razón social" aria-label="Razón social" className={input} />
      <input name="contactEmail" type="email" placeholder="Correo de contacto" aria-label="Correo de contacto" className={input} />
      <input name="billingEmail" type="email" placeholder="Correo de facturación" aria-label="Correo de facturación" className={input} />
      <input name="country" maxLength={100} placeholder="País" aria-label="País" className={input} />
      <button disabled={creating} className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold disabled:opacity-50">{creating ? 'Guardando…' : 'Registrar compañía'}</button>
      <p role="status" aria-live="polite" className={createResult.error ? 'text-red-300 md:col-span-2' : 'text-emerald-300 md:col-span-2'}>{createResult.error || (createResult.success ? 'Compañía registrada correctamente.' : '')}</p>
    </form>
    <form action={assignAction} className="flex flex-wrap gap-3 rounded-2xl border border-white/10 p-5">
      <select required name="accountId" aria-label="Cuenta" className={input}><option value="">Seleccionar cuenta</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <select required name="companyId" aria-label="Compañía" className={input}><option value="">Seleccionar compañía</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <button disabled={assigning || !accounts.length || !companies.length} className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold disabled:opacity-50">{assigning ? 'Vinculando…' : 'Vincular cuenta'}</button>
      <p role="status" aria-live="polite" className={assignResult.error ? 'w-full text-red-300' : 'w-full text-emerald-300'}>{assignResult.error || (assignResult.success ? 'Cuenta vinculada correctamente.' : '')}</p>
    </form>
  </>;
}
