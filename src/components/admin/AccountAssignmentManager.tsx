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
  const field = 'mt-1 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 py-2 text-xs text-[var(--theme-control-text)]';

  return (
    <details className="mt-2 min-w-64">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--theme-link)] hover:text-[var(--theme-link)]">Gestionar asignaciones</summary>
      <div className="mt-2 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--theme-panel)] p-3">
        {assignments.length > 0 && (
          <ul className="space-y-2">
            {assignments.map(item => (
              <li key={item.id} className="rounded-md bg-[var(--theme-panel)] p-2">
                <p className="text-xs text-[var(--foreground)]">{item.interpreterName}</p>
                <p className="text-[11px] text-[var(--text-secondary)]">Desde {item.startsAt}{item.endsAt ? ` · Hasta ${item.endsAt}` : ' · Sin fecha final'}</p>
                {!item.endsAt && (
                  <form action={endAction} className="mt-2 flex items-end gap-2">
                    <input type="hidden" name="assignmentId" value={item.id} />
                    <label className="flex-1 text-[11px] text-[var(--text-secondary)]">Finalizar el
                      <input name="endsAt" type="date" required min={item.startsAt} defaultValue={today < item.startsAt ? item.startsAt : today} className={field} />
                    </label>
                    <button disabled={ending} className="rounded-md border border-amber-400/30 px-2 py-2 text-[11px] text-[var(--theme-warning)] disabled:opacity-50">
                      {ending ? '…' : 'Finalizar'}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <form action={createAction} className="grid gap-2 border-t border-[var(--border)] pt-3">
          <input type="hidden" name="accountId" value={accountId} />
          <label className="text-[11px] text-[var(--text-secondary)]">Intérprete
            <select name="interpreterId" required defaultValue="" className={field}>
              <option value="" disabled>Seleccionar intérprete</option>
              {interpreters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-[var(--text-secondary)]">Desde
              <input name="startsAt" type="date" required defaultValue={today} className={field} />
            </label>
            <label className="text-[11px] text-[var(--text-secondary)]">Hasta (opcional)
              <input name="endsAt" type="date" min={today} className={field} />
            </label>
          </div>
          <label className="text-[11px] text-[var(--text-secondary)]">Notas
            <input name="notes" maxLength={500} className={field} placeholder="Opcional" />
          </label>
          {createState.error && <p role="alert" className="text-[11px] text-[var(--theme-danger)]">{createState.error}</p>}
          {createState.success && <p role="status" className="text-[11px] text-[var(--theme-success)]">Asignación creada.</p>}
          <button disabled={creating || interpreters.length === 0} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {creating ? 'Guardando…' : 'Asignar intérprete'}
          </button>
          {endState.error && <p role="alert" className="text-[11px] text-[var(--theme-danger)]">{endState.error}</p>}
          {endState.success && <p role="status" className="text-[11px] text-[var(--theme-success)]">Asignación finalizada.</p>}
        </form>
      </div>
    </details>
  );
}
