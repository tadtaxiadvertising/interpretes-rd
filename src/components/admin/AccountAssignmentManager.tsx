'use client';

import { useActionState } from 'react';
import { assignInterpreterToAccount, endInterpreterAccountAssignment } from '@/app/actions/admin-account-assignments';

type Result = { success: boolean; error?: string };
const initial: Result = { success: false };
type Interpreter = { id: number; name: string };
type Assignment = { id: number; interpreterId: number; interpreterName: string; startsAt: string; endsAt: string | null };

export default function AccountAssignmentManager({
  accountId,
  interpreters,
  assignments,
  today,
}: {
  accountId: number;
  interpreters: Interpreter[];
  assignments: Assignment[];
  today: string;
}) {
  const [createState, createAction, creating] = useActionState(
    async (_previous: Result, data: FormData): Promise<Result> => assignInterpreterToAccount(data),
    initial
  );
  const [endState, endAction, ending] = useActionState(
    async (_previous: Result, data: FormData): Promise<Result> => endInterpreterAccountAssignment(data),
    initial
  );
  const field = 'mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-xs text-white';

  return (
    <details className="mt-2 min-w-64">
      <summary className="cursor-pointer text-xs font-semibold text-blue-300 hover:text-blue-200">Gestionar asignaciones</summary>
      <div className="mt-2 space-y-3 rounded-lg border border-white/10 bg-slate-950/70 p-3">
        {assignments.length > 0 && (
          <ul className="space-y-2">
            {assignments.map(item => (
              <li key={item.id} className="rounded-md bg-white/[0.04] p-2">
                <p className="text-xs text-white">{item.interpreterName}</p>
                <p className="text-[11px] text-slate-400">Desde {item.startsAt}{item.endsAt ? ` · Hasta ${item.endsAt}` : ' · Sin fecha final'}</p>
                {!item.endsAt && (
                  <form action={endAction} className="mt-2 flex items-end gap-2">
                    <input type="hidden" name="assignmentId" value={item.id} />
                    <label className="flex-1 text-[11px] text-slate-400">Finalizar el
                      <input name="endsAt" type="date" required min={item.startsAt} defaultValue={today < item.startsAt ? item.startsAt : today} className={field} />
                    </label>
                    <button disabled={ending} className="rounded-md border border-amber-400/30 px-2 py-2 text-[11px] text-amber-200 disabled:opacity-50">
                      {ending ? '…' : 'Finalizar'}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <form action={createAction} className="grid gap-2 border-t border-white/10 pt-3">
          <input type="hidden" name="accountId" value={accountId} />
          <label className="text-[11px] text-slate-300">Intérprete
            <select name="interpreterId" required defaultValue="" className={field}>
              <option value="" disabled>Seleccionar intérprete</option>
              {interpreters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-300">Desde
              <input name="startsAt" type="date" required defaultValue={today} className={field} />
            </label>
            <label className="text-[11px] text-slate-300">Hasta (opcional)
              <input name="endsAt" type="date" min={today} className={field} />
            </label>
          </div>
          <label className="text-[11px] text-slate-300">Notas
            <input name="notes" maxLength={500} className={field} placeholder="Opcional" />
          </label>
          {createState.error && <p role="alert" className="text-[11px] text-red-300">{createState.error}</p>}
          {createState.success && <p role="status" className="text-[11px] text-emerald-300">Asignación creada.</p>}
          <button disabled={creating || interpreters.length === 0} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {creating ? 'Guardando…' : 'Asignar intérprete'}
          </button>
          {endState.error && <p role="alert" className="text-[11px] text-red-300">{endState.error}</p>}
          {endState.success && <p role="status" className="text-[11px] text-emerald-300">Asignación finalizada.</p>}
        </form>
      </div>
    </details>
  );
}
