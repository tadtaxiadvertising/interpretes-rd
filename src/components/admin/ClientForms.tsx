'use client';

import { useActionState } from 'react';
import { assignAccountToClient, createClient } from '@/app/actions/admin-clients';

type Result = { success: boolean; error?: string };
const initial: Result = { success: false };
type ClientOption = { id: number; name: string };
type AccountOption = { id: number; name: string; companyName: string | null };

export default function ClientForms({ clients, unassignedAccounts }: {
  clients: ClientOption[];
  unassignedAccounts: AccountOption[];
}) {
  const [createResult, createAction, creating] = useActionState(
    async (_previous: Result, data: FormData): Promise<Result> => createClient(data), initial,
  );
  const [assignResult, assignAction, assigning] = useActionState(
    async (_previous: Result, data: FormData): Promise<Result> => assignAccountToClient(data), initial,
  );
  const input = 'rounded-lg border border-white/15 bg-slate-900 p-3 text-white';
  return <>
    <form action={createAction} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 md:grid-cols-2">
      <h2 className="md:col-span-2 font-semibold">Registrar cliente</h2>
      <input name="name" required minLength={2} maxLength={150} placeholder="Nombre del cliente" aria-label="Nombre del cliente" className={input} />
      <input name="legalName" maxLength={200} placeholder="Razón social (opcional)" aria-label="Razón social" className={input} />
      <input name="contactName" maxLength={150} placeholder="Persona de contacto (opcional)" aria-label="Persona de contacto" className={input} />
      <input name="contactEmail" type="email" placeholder="Correo de contacto (opcional)" aria-label="Correo de contacto" className={input} />
      <input name="phone" maxLength={40} placeholder="Teléfono (opcional)" aria-label="Teléfono" className={input} />
      <input name="notes" maxLength={1000} placeholder="Notas (opcional)" aria-label="Notas" className={input} />
      <button disabled={creating} className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold disabled:opacity-50">{creating ? 'Guardando…' : 'Registrar cliente'}</button>
      <p role="status" aria-live="polite" className={createResult.error ? 'text-red-300 md:col-span-2' : 'text-emerald-300 md:col-span-2'}>{createResult.error || (createResult.success ? 'Cliente registrado correctamente.' : '')}</p>
    </form>
    <form action={assignAction} className="flex flex-wrap gap-3 rounded-2xl border border-white/10 p-5">
      <select required name="accountId" aria-label="Cuenta sin cliente" className={input}>
        <option value="">Seleccionar cuenta sin cliente</option>
        {unassignedAccounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.companyName ? ' · ' + account.companyName : ''}</option>)}
      </select>
      <select required name="clientId" aria-label="Cliente" className={input}>
        <option value="">Seleccionar cliente</option>
        {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select>
      <button disabled={assigning || !unassignedAccounts.length || !clients.length} className="rounded-lg bg-[#2675ff] px-4 py-3 font-semibold disabled:opacity-50">{assigning ? 'Vinculando…' : 'Asignar cuenta al cliente'}</button>
      <p role="status" aria-live="polite" className={assignResult.error ? 'w-full text-red-300' : 'w-full text-emerald-300'}>{assignResult.error || (assignResult.success ? 'Cuenta asignada correctamente.' : '')}</p>
      <p className="w-full text-xs text-slate-400">Solo se ofrecen cuentas sin cliente. Las cuentas ya asignadas no se pueden mover desde esta acción para proteger su historial operativo.</p>
    </form>
  </>;
}
