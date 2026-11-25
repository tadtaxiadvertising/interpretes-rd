'use client';

import React, { useState } from 'react';
import { Target, Loader2, Check } from 'lucide-react';
import { Modal } from './Modal';
import { updateSystemConfig } from '@/app/actions/settings';

interface Props {
  initialGoal: number;
}

export function GlobalGoalsButton({ initialGoal }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [goal, setGoal] = useState(initialGoal.toString());
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleSave() {
    const val = parseFloat(goal);
    if (isNaN(val) || val <= 0) return;

    setIsPending(true);
    const result = await updateSystemConfig('standard_monthly_goal_hours', val.toString());
    setIsPending(false);

    if (result.success) {
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setIsOpen(false);
      }, 1500);
    }
  }

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="theme-action-primary px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
      >
        <Target size={16} />
        Configurar metas
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Configurar metas globales">
        <div className="space-y-6">
          <div>
            <label htmlFor="global-monthly-goal" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Meta mensual estándar (horas)
            </label>
            <div className="relative">
              <input
                type="number"
                id="global-monthly-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl pl-4 pr-20 py-3 text-[var(--theme-control-text)] focus:outline-none focus:border-[var(--theme-focus)] transition-all"
                placeholder="Ej. 120"
                autoFocus
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] text-sm">
                h/mes
              </div>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-2">
              Se utilizará como meta predeterminada para los intérpretes sin una meta específica.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border)]">
            <button
              onClick={() => setIsOpen(false)}
              className="theme-action-secondary rounded-xl px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={isPending || isSuccess}
              className="theme-action-primary px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2"
            >
              {isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isSuccess ? (
                <Check size={16} />
              ) : (
                'Guardar cambios'
              )}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
