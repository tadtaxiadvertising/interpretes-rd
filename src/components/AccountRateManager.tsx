'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Plus, Trash2, Loader2, CreditCard } from 'lucide-react';
import { setInterpreterAccountRate, getAccounts, deleteInterpreterAccountRate, type AccountOption } from '@/app/actions/account-rates';

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

  useEffect(() => {
    let active = true;
    async function loadAccounts() {
      try {
        const data = await getAccounts();
        if (active && data.success && data.data) setAccounts(data.data);
      } catch (error) {
        console.error('Unable to load account directory:', error);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadAccounts();
    return () => { active = false; };
  }, []);

  function handleAddRate() {
    if (!newAccountId || !newRateValue) return;
    const accountId = Number(newAccountId);
    const rate = Number(newRateValue);
    if (!Number.isInteger(accountId) || accountId <= 0 || !Number.isFinite(rate) || rate <= 0 || rate > 99999) return;

    startTransition(async () => {
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
      }
    });
  }

  function handleDeleteRate(accountId: number) {
    if (!confirm('¿Estás seguro de eliminar esta tarifa?')) return;
    startTransition(async () => {
      const result = await deleteInterpreterAccountRate(interpreterId, accountId);
      if (result.success) setRates(prev => prev.filter(r => r.accountId !== accountId));
    });
  }

  if (loading) return <div role="status" aria-label="Cargando cuentas" className="flex justify-center p-4"><Loader2 className="animate-spin text-[var(--theme-link)]" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] mb-2">
        <CreditCard size={16} className="text-[var(--theme-link)]" />
        Tarifas por Cuenta (Pago por Hora)
      </div>
      <div className="grid gap-2">
        {rates.map(rate => {
          const account = accounts.find(a => a.id === rate.accountId);
          return (
            <div key={rate.accountId} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[var(--theme-surface-muted)] border border-[var(--border)] rounded-xl hover:bg-[var(--theme-hover)] transition-colors">
              <span className="min-w-0 break-words text-sm text-[var(--text-secondary)]">{account ? accountLabel(account) : 'Cuenta no disponible'}</span>
              <div className="flex items-center gap-4">
                <span className="font-mono text-[var(--foreground)] font-bold">RD${rate.tariffPerHour.toFixed(2)}/hr</span>
                <button className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--theme-danger)] hover:bg-red-500/10 rounded-lg transition-colors" onClick={() => handleDeleteRate(rate.accountId)} disabled={isPending} aria-label="Eliminar tarifa">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="pt-4 border-t border-[var(--border)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <select aria-label="Cuenta para tarifa especial" value={newAccountId} onChange={e => setNewAccountId(e.target.value)} className="bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl px-3 py-2 text-sm text-[var(--theme-control-text)] focus:outline-none focus:border-[var(--theme-focus)]">
            <option value="">Seleccionar cuenta...</option>
            {accounts.map(acc => <option key={acc.id} value={acc.id}>{accountLabel(acc)}</option>)}
          </select>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] text-sm">RD$</span>
            <input aria-label="Tarifa por hora en pesos dominicanos" type="number" min="0.01" max="99999" step="0.01" placeholder="0.00/hr" value={newRateValue} onChange={e => setNewRateValue(e.target.value)} className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl pl-10 pr-3 py-2 text-sm text-[var(--theme-control-text)] focus:outline-none focus:border-[var(--theme-focus)]" />
          </div>
        </div>
        <button onClick={handleAddRate} disabled={isPending || !newAccountId || !newRateValue} className="w-full flex items-center justify-center gap-2 theme-action-primary py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Asignar tarifa
        </button>
      </div>
    </div>
  );
}
