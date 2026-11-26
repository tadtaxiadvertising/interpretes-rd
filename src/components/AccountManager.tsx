'use client';

import { useRef, useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, Check, X, Layers } from 'lucide-react';
import { createAccount, updateAccount, deleteAccount } from '@/app/actions/account-rates';
import { operationalAccountInputSchema } from '@/lib/client-validation';
import { Modal } from './Modal';

interface Account {
  id: number;
  name: string;
  description: string | null;
  clientId: number | null;
  clientName: string | null;
}

interface Props {
  initialAccounts: Account[];
  clients: { id: number; name: string }[];
}

const fieldClass = 'min-h-11 w-full min-w-0 rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 py-2 text-sm text-[var(--theme-control-text)] focus-visible:outline-2 focus-visible:outline-[var(--theme-focus)]';

export function AccountManager({ initialAccounts, clients }: Props) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [isPending, startTransition] = useTransition();
  const busy = useRef(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newClientId, setNewClientId] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const locked = isPending || needsReview;

  function run(operation: () => Promise<void>) {
    if (busy.current || needsReview) return;
    busy.current = true;
    setFeedback(null);
    startTransition(async () => {
      try { await operation(); }
      catch {
        setFeedback({ kind: 'error', message: 'No se pudo confirmar la operación. Revisa los registros antes de repetirla.' });
        setNeedsReview(true);
      } finally { busy.current = false; }
    });
  }
  function fail(message: string) { setFeedback({ kind: 'error', message }); }
  function succeed(message: string) { setFeedback({ kind: 'success', message }); }

  function handleCreate() {
    const parsed = operationalAccountInputSchema.safeParse({ name: newName, description: newDesc, clientId: newClientId });
    if (!parsed.success || !clients.some(client => client.id === parsed.data.clientId)) {
      fail('Selecciona un cliente válido y revisa el nombre y la descripción.');
      return;
    }
    run(async () => {
      const result = await createAccount(parsed.data.name, parsed.data.description, parsed.data.clientId);
      if (!result.success || !result.data) { fail(result.error || 'No se pudo crear la cuenta.'); return; }
      const saved = result.data;
      setAccounts(current => [...current.filter(account => account.id !== saved.id), saved]);
      setNewName(''); setNewDesc(''); setNewClientId(''); setShowAdd(false);
      succeed('Cuenta creada correctamente.');
    });
  }

  function handleUpdate(id: number) {
    if (editName.trim().length < 2 || editName.trim().length > 120 || editDesc.trim().length > 1000) {
      fail('Revisa el nombre y la descripción de la cuenta.'); return;
    }
    run(async () => {
      const result = await updateAccount(id, editName.trim(), editDesc.trim());
      if (!result.success || !result.data) { fail(result.error || 'No se pudo actualizar la cuenta.'); return; }
      const saved = result.data;
      setAccounts(current => current.map(account => account.id === id ? saved : account));
      setEditingId(null);
      succeed('Cuenta actualizada correctamente.');
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    run(async () => {
      const result = await deleteAccount(id);
      if (!result.success) { fail(result.error || 'No se pudo eliminar la cuenta.'); return; }
      setAccounts(current => current.filter(account => account.id !== id));
      setDeleteTarget(null);
      succeed('Cuenta eliminada correctamente.');
    });
  }

  function startEditing(account: Account) {
    setFeedback(null); setShowAdd(false);
    setEditingId(account.id); setEditName(account.name); setEditDesc(account.description || '');
  }

  const feedbackNode = feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-surface-muted)] p-3 text-sm ${feedback.kind === 'error' ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-success)]'}`}>{feedback.message}</p>;

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-bold text-[var(--foreground)]"><Layers aria-hidden="true" className="text-[var(--theme-purple)]" /> Gestión de cuentas</h3>
        <button type="button" disabled={locked} onClick={() => { setFeedback(null); setEditingId(null); setShowAdd(!showAdd); }} className="theme-action-secondary flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-50">
          {showAdd ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{showAdd ? 'Cancelar creación' : 'Nueva Cuenta'}
        </button>
      </div>
      {!deleteTarget && feedbackNode}
      {showAdd && (
        <form onSubmit={event => { event.preventDefault(); handleCreate(); }} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-[var(--text-secondary)]">Cliente propietario
              <select required disabled={locked} value={newClientId} onChange={event => setNewClientId(event.target.value)} className={fieldClass}>
                <option value="">Seleccionar cliente propietario</option>
                {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-[var(--text-secondary)]">Nombre de la cuenta
              <input required minLength={2} maxLength={120} disabled={locked} value={newName} onChange={event => setNewName(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm text-[var(--text-secondary)]">Descripción (opcional)
              <input maxLength={1000} disabled={locked} value={newDesc} onChange={event => setNewDesc(event.target.value)} className={fieldClass} />
            </label>
          </div>
          <button type="submit" disabled={locked || newName.trim().length < 2 || !newClientId || !clients.length} aria-busy={isPending} className="theme-action-primary min-h-11 rounded-xl px-4 font-semibold disabled:opacity-50">{isPending ? 'Guardando…' : 'Crear Cuenta'}</button>
        </form>
      )}
      <div className="space-y-3">
        {accounts.map(account => (
          <article key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3">
            {editingId === account.id ? (
              <form onSubmit={event => { event.preventDefault(); handleUpdate(account.id); }} className="flex w-full flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">Editar nombre<input required minLength={2} maxLength={120} disabled={locked} value={editName} onChange={event => setEditName(event.target.value)} className={fieldClass} /></label>
                <label className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">Editar descripción<input maxLength={1000} disabled={locked} value={editDesc} onChange={event => setEditDesc(event.target.value)} className={fieldClass} /></label>
                <button type="submit" disabled={locked} aria-label="Guardar cambios" className="theme-action-primary min-h-11 min-w-11 rounded-lg px-3"><Check size={16} aria-hidden="true" /></button>
                <button type="button" disabled={isPending} onClick={() => setEditingId(null)} aria-label="Cancelar edición" className="theme-action-secondary min-h-11 min-w-11 rounded-lg px-3"><X size={16} aria-hidden="true" /></button>
              </form>
            ) : <>
              <div className="min-w-0 flex-1 break-words">
                <p className="font-semibold text-[var(--foreground)]">{account.name}</p>
                <p className="text-xs text-[var(--theme-link)]">{account.clientName || 'Cliente pendiente de identificar'}</p>
                {account.description && <p className="text-xs text-[var(--text-secondary)]">{account.description}</p>}
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={locked} onClick={() => startEditing(account)} aria-label={`Editar cuenta: ${account.name}`} className="theme-action-secondary min-h-11 min-w-11 rounded-lg px-3"><Pencil size={16} aria-hidden="true" /></button>
                <button type="button" disabled={locked} onClick={() => { setFeedback(null); setDeleteTarget(account); }} aria-label={`Eliminar cuenta: ${account.name}`} className="theme-action-secondary min-h-11 min-w-11 rounded-lg px-3 text-[var(--theme-danger)]"><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            </>}
          </article>
        ))}
        {!accounts.length && <p className="py-6 text-center text-[var(--text-secondary)]">No hay cuentas registradas aún.</p>}
      </div>
      <Modal isOpen={deleteTarget !== null} onClose={() => { setDeleteTarget(null); }} title="Confirmar eliminación de cuenta" closeDisabled={isPending}>
        <div className="space-y-3">
          <p className="break-words text-sm text-[var(--foreground)]">¿Eliminar la cuenta <strong>{deleteTarget?.name}</strong>? Verifica que sea la cuenta correcta. La eliminación puede ser irreversible.</p>
          {deleteTarget && feedbackNode}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={isPending} onClick={() => setDeleteTarget(null)} className="theme-action-secondary min-h-11 rounded-xl px-4">Cancelar</button>
            <button type="button" disabled={locked} aria-busy={isPending} onClick={handleDelete} className="theme-action-danger min-h-11 rounded-xl px-4">Eliminar cuenta</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
