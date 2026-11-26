'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import { Plus, Trash2, Loader2, CreditCard } from 'lucide-react';
import { setInterpreterAccountRate, getAccounts, deleteInterpreterAccountRate, type AccountOption } from '@/app/actions/account-rates';

import { Modal } from './Modal';

interface Rate {
  accountId: number;
  tariffPerHour: number;
}

interface Props {
  interpreterId: number;
  initialRates: Rate[];
}

function accountLabel(account: AccountOption) {
  return [account.client?.name || 'Cliente pendiente', account.company?.name || 'Sin compañía', account.name].join(' · ');
}

export function AccountRateManager({ interpreterId, initialRates }: Props) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [rates, setRates] = useState<Rate[]>(initialRates);
  const [isPending, startTransition] = useTransition();
  const [newAccountId, setNewAccountId] = useState<string>('');
  const [newRateValue, setNewRateValue] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const busy = useRef(false);
  const locked = isPending || needsReview;

  useEffect(() => {
    let active = true;
    async function loadAccounts() {
      try {
        const data = await getAccounts();
        if (!active) return;
        if (data.success && data.data) { setAccounts(data.data); setLoadFailed(false); }
        else setLoadFailed(true);
      } catch {
        if (active) setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadAccounts();
    return () => { active = false; };
  }, [loadVersion]);

  function handleAddRate() {
    if (busy.current || needsReview || loadFailed || loading) return;
    if (!newAccountId || !newRateValue) { setFeedback({ kind: 'error', message: 'Selecciona una cuenta y una tarifa válida.' }); return; }
    const accountId = Number(newAccountId);
    const rate = Number(newRateValue);
    if (!Number.isInteger(accountId) || !accounts.some(account => account.id === accountId) || !Number.isFinite(rate) || rate < 0.01 || rate > 99999) {
      setFeedback({ kind: 'error', message: 'Selecciona una cuenta válida y una tarifa entre 0.01 y 99,999 pesos por hora.' }); return;
    }

    run(async () => {
      const result = await setInterpreterAccountRate(interpreterId, accountId, rate);
      if (result.success) {
        setRates(prev => {
          const existing = prev.findIndex(r => r.accountId === accountId);
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = { accountId, tariffPerHour: rate };
            return next;
          }
          return [...prev, { accountId, tariffPerHour: rate }];
        });
        setNewAccountId('');
        setNewRateValue('');
        setFeedback({ kind: 'success', message: 'Tarifa guardada correctamente.' });
      } else setFeedback({ kind: 'error', message: 'No se pudo guardar la tarifa. Revisa los datos y el estado de la cuenta.' });
    });
  }

  function run(operation: () => Promise<void>) {
    if (busy.current || needsReview) return;
    busy.current = true;
    setFeedback(null);
    startTransition(async () => {
      try { await operation(); }
      catch {
        setFeedback({ kind: 'error', message: 'No se pudo confirmar la operación. Revisa las tarifas registradas antes de repetirla.' });
        setNeedsReview(true);
      } finally { busy.current = false; }
    });
  }

  function handleDeleteRate() {
    if (deleteTarget === null || loadFailed || loading) return;
    const accountId = deleteTarget;
    run(async () => {
      const result = await deleteInterpreterAccountRate(interpreterId, accountId);
      if (result.success) {
        setRates(prev => prev.filter(r => r.accountId !== accountId));
        setDeleteTarget(null);
        setFeedback({ kind: 'success', message: 'Tarifa especial eliminada correctamente.' });
      } else setFeedback({ kind: 'error', message: 'No se pudo eliminar la tarifa especial.' });
    });
  }

  const feedbackNode = feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-surface-muted)] p-3 text-sm ${feedback.kind === 'error' ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-success)]'}`}>{feedback.message}</p>;

  if (loading) return <div role="status" aria-label="Cargando cuentas" className="flex justify-center p-4"><Loader2 className="animate-spin text-[var(--theme-link)]" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] mb-2">
        <CreditCard size={16} className="text-[var(--theme-link)]" />
        Tarifas por Cuenta (Pago por Hora)
      </div>
      {deleteTarget === null && feedbackNode}
      {loadFailed && <div role="alert" className="rounded-xl border border-[var(--theme-control-border)] p-3 text-sm text-[var(--theme-danger)]">No se pudo cargar el directorio de cuentas. Las tarifas existentes se conservan.<button type="button" className="block min-h-11 text-[var(--theme-link)] underline" onClick={() => { setLoading(true); setLoadVersion(version => version + 1); }}>Reintentar carga</button></div>}
      <div className="grid gap-2">
        {rates.map(rate => {
          const account = accounts.find(a => a.id === rate.accountId);
          return (
            <div key={rate.accountId} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[var(--theme-surface-muted)] border border-[var(--border)] rounded-xl hover:bg-[var(--theme-hover)] transition-colors">
              <span className="min-w-0 break-words text-sm text-[var(--text-secondary)]">{account ? accountLabel(account) : 'Cuenta no disponible'}</span>
              <div className="flex items-center gap-4">
                <span className="font-mono text-[var(--foreground)] font-bold">RD${rate.tariffPerHour.toFixed(2)}/hr</span>
                <button className="min-h-11 min-w-11 p-2 text-[var(--text-tertiary)] hover:text-[var(--theme-danger)] hover:bg-red-500/10 rounded-lg transition-colors" type="button" onClick={() => { setFeedback(null); setDeleteTarget(rate.accountId); }} disabled={locked || loadFailed} aria-label="Eliminar tarifa">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="pt-4 border-t border-[var(--border)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <select disabled={locked || loadFailed} aria-label="Cuenta para tarifa especial" value={newAccountId} onChange={e => setNewAccountId(e.target.value)} className="min-h-11 min-w-0 w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl px-3 py-2 text-sm text-[var(--theme-control-text)] focus:outline-none focus:border-[var(--theme-focus)]">
            <option value="">Seleccionar cuenta...</option>
            {accounts.map(acc => <option key={acc.id} value={acc.id}>{accountLabel(acc)}</option>)}
          </select>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] text-sm">RD$</span>
            <input disabled={locked || loadFailed} aria-label="Tarifa por hora en pesos dominicanos" type="number" min="0.01" max="99999" step="0.01" placeholder="0.00/hr" value={newRateValue} onChange={e => setNewRateValue(e.target.value)} className="min-h-11 w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl pl-10 pr-3 py-2 text-sm text-[var(--theme-control-text)] focus:outline-none focus:border-[var(--theme-focus)]" />
          </div>
        </div>
        <button type="button" onClick={handleAddRate} aria-busy={isPending} disabled={locked || loadFailed || !newAccountId || !newRateValue} className="w-full flex items-center justify-center gap-2 theme-action-primary min-h-11 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {accounts.some(account => String(account.id) === newAccountId && rates.some(rate => rate.accountId === account.id)) ? "Actualizar tarifa" : "Asignar tarifa"}
        </button>
      </div>
      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Confirmar eliminación de tarifa" closeDisabled={isPending}>
        <div className="space-y-3">
          <p className="text-sm text-[var(--foreground)]">¿Eliminar la tarifa especial de {accounts.find(account => account.id === deleteTarget)?.name || 'esta cuenta'}? Verifica la cuenta antes de continuar.</p>
          {deleteTarget !== null && feedbackNode}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={isPending} onClick={() => setDeleteTarget(null)} className="theme-action-secondary min-h-11 rounded-xl px-4">Cancelar</button>
            <button type="button" disabled={locked || loadFailed} onClick={handleDeleteRate} className="theme-action-danger min-h-11 rounded-xl px-4">Eliminar tarifa especial</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
