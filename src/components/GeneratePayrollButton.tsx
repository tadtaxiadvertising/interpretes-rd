'use client';

import React, { useRef, useState, useTransition } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { generatePayrollPeriod } from '@/app/actions/payroll';
import { toast } from 'react-hot-toast';
import { Modal } from './Modal';

export function GeneratePayrollButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const generating = useRef(false);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (generating.current) return;
    if (!startDate || !endDate) {
      setError('Selecciona las fechas de inicio y fin.');
      return;
    }
    if (startDate > endDate) {
      setError('La fecha inicial no puede ser posterior a la final.');
      return;
    }
    setError(null);
    generating.current = true;

    startTransition(async () => {
      try {
        const result = await generatePayrollPeriod(new Date(startDate), new Date(endDate));
        if (!result.success) {
          setError(result.error || 'No se pudo generar la nómina');
        } else {
          toast.success(result.data?.message || 'Nómina generada');
          setIsOpen(false);
        }
      } catch {
        setError('No se pudo confirmar la generación. Revisa los registros de nómina antes de reintentar.');
      } finally {
        generating.current = false;
      }
    });
  };

  return (
    <>
      <button 
        onClick={() => { setError(null); setIsOpen(true); }}
        className="flex items-center gap-2 theme-action-primary px-6 py-3 rounded-2xl font-bold transition-colors"
      >
        <Plus size={20} />
        Generar nómina
      </button>

      <Modal 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)} 
        title="Generar período de nómina"
        closeDisabled={isPending}
      >
        <form onSubmit={handleGenerate} className="space-y-6">
          {error && (
            <div role="alert" className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-[var(--theme-danger)] text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label htmlFor="payroll-period-start" className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest ml-1">Inicio del período</label>
              <input
                required
                disabled={isPending}
                type="date"
                id="payroll-period-start"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-2xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="payroll-period-end" className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest ml-1">Fin del período</label>
              <input
                required
                disabled={isPending}
                type="date"
                id="payroll-period-end"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-2xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors"
              />
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsOpen(false)}
              className="flex-1 py-4 theme-action-secondary rounded-2xl font-bold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              aria-busy={isPending}
              className="flex-1 py-4 theme-action-primary rounded-2xl font-bold transition-colors flex items-center justify-center gap-2"
            >
              {isPending ? <Loader2 className="animate-spin" size={20} /> : <Plus size={20} />}
              Generar
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
