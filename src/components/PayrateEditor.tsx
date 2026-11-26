'use client';

import React, { useRef, useState, useTransition } from 'react';
import { Check, X, Pencil, Loader2, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { updatePayrate } from '@/app/actions/payrates';
import { cn } from '@/lib/utils';
import { AccountRateManager } from './AccountRateManager';

interface Props {
  interpreter: {
    id: number;
    name: string;
    externalId: string;
    campaign: string | null;
    status: string;
    tariffPerMinute: number;
    accountRates: Array<{
      accountId: number;
      tariffPerHour: number;
    }>;
  };
}

export function PayrateEditor({ interpreter }: Props) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rate, setRate] = useState(interpreter.tariffPerMinute);
  const [inputValue, setInputValue] = useState((interpreter.tariffPerMinute * 60).toFixed(2));
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const busy = useRef(false);
  const hourly = Number(inputValue);
  const valid = /^\d+(?:\.\d{1,2})?$/.test(inputValue) && Number.isFinite(hourly) && hourly >= 0.60 && hourly <= 999.60;
  // Convert integer hourly cents to the nearest whole cent per minute.
  const minuteCents = valid ? Math.round(Math.round(hourly * 100) / 60) : 0;
  const effectiveHourly = minuteCents * 60 / 100;

  function handleSave() {
    if (busy.current || needsReview) return;
    if (!valid) {
      setFeedback({ kind: 'error', message: 'Introduce una tarifa de RD$0.60 a RD$999.60 por hora, con hasta dos decimales.' });
      return;
    }
    busy.current = true;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await updatePayrate(interpreter.id, minuteCents / 100);
        if (result.success && result.data) {
          setRate(result.data.newRate);
          setInputValue((result.data.newRate * 60).toFixed(2));
          setEditing(false);
          setFeedback({ kind: 'success', message: result.data.oldRate === result.data.newRate ? 'La tarifa ya tenía ese valor. No se registró otro cambio.' : 'Tarifa actualizada correctamente.' });
        } else {
          setFeedback({ kind: 'error', message: result.error || 'No se pudo confirmar la tarifa.' });
          if (result.code === 'CONFLICT' || result.code === 'SERVICE_UNAVAILABLE' || result.success) setNeedsReview(true);
        }
      } catch {
        setFeedback({ kind: 'error', message: 'No se pudo confirmar la actualización. Revisa el valor registrado antes de repetir.' });
        setNeedsReview(true);
      } finally { busy.current = false; }
    });
  }

  function handleCancel() {
    if (busy.current) return;
    if (!needsReview) setFeedback(null);
    setInputValue((rate * 60).toFixed(2));
    setEditing(false);
  }

  return (
    <>
      <tr className={cn(
        'hover:bg-[var(--theme-hover)] transition-all group',
        feedback?.kind === 'success' && 'bg-green-500/5',
        feedback?.kind === 'error' && 'bg-red-500/5',
        expanded && 'bg-[var(--theme-surface-muted)]'
      )}>
        <td className="py-4 px-2">
          <div className="flex items-center gap-3">
            <button 
              aria-label="Tarifas especiales por cuenta"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className={cn(
                "p-1 rounded-lg hover:bg-[var(--theme-hover)] transition-colors",
                expanded ? "text-[var(--theme-link)]" : "text-[var(--text-tertiary)]"
              )}
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            <span className="text-[var(--foreground)] font-medium">{interpreter.name}</span>
          </div>
        </td>
        <td className="py-4 px-2 text-[var(--text-tertiary)] text-xs font-mono">{interpreter.externalId}</td>
        <td className="py-4 px-2 text-[var(--text-secondary)] text-sm">{interpreter.campaign || '—'}</td>
        <td className="py-4 px-2">
          <span className={cn(
            'px-2 py-1 rounded-lg text-xs font-medium',
            interpreter.status === 'Activo' ? 'bg-green-500/10 text-[var(--theme-success)]' : 'bg-gray-500/10 text-[var(--text-secondary)]'
          )}>
            {interpreter.status}
          </span>
        </td>
        <td className="py-4 px-2">
          {editing ? (
            <div className="space-y-1"><div className="flex items-center gap-1">
              <span className="text-[var(--text-tertiary)]">RD$</span>
              <input
                type="number"
                step="0.01"
                min="0.60"
                max="999.60"
                disabled={isPending || needsReview}
                aria-label="Tarifa por hora en pesos dominicanos"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setFeedback(null); }}
                className="w-28 px-2 py-1 bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-lg text-[var(--theme-control-text)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--theme-focus)]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
                  if (e.key === 'Escape') handleCancel();
                }}
              />
            </div>
            {valid && <p className="text-xs text-[var(--text-secondary)]">Se guardará RD${effectiveHourly.toFixed(2)}/hora (RD${(minuteCents / 100).toFixed(2)}/minuto).</p>}
            {valid && Math.round(hourly * 100) !== minuteCents * 60 && <p className="text-xs text-[var(--theme-warning)]">El importe se ajusta a la precisión de la tarifa por minuto.</p>}
            </div>
          ) : (
            <div className="flex flex-col">
              <span className={cn(
                'text-[var(--theme-link)] font-bold transition-all',
                feedback?.kind === 'success' && 'text-[var(--theme-success)]'
              )}>
                RD${(rate * 60).toFixed(2)}/hr
              </span>
              {interpreter.accountRates.length > 0 && (
                <span className="text-[10px] text-[var(--theme-purple)] flex items-center gap-1 mt-1">
                  <Layers size={10} />
                  {interpreter.accountRates.length} tarifas especiales
                </span>
              )}
            </div>
          )}
        </td>
        <td className="py-4 px-2 text-right">
          <div className="flex items-center justify-end gap-2">
            {editing ? (
              <>
                <button
                  aria-label="Guardar tarifa"
                  onClick={handleSave}
                  disabled={isPending || needsReview}
                  className="p-1.5 rounded-lg bg-green-500/10 text-[var(--theme-success)] hover:bg-green-500/20 transition-colors"
                >
                  {isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
                <button
                  aria-label="Cancelar edición de tarifa"
                  onClick={handleCancel}
                  disabled={isPending}
                  className="p-1.5 rounded-lg bg-red-500/10 text-[var(--theme-danger)] hover:bg-red-500/20 transition-colors"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <button
                aria-label="Editar tarifa"
                disabled={needsReview}
                onClick={() => { setFeedback(null); setEditing(true); }}
                className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--foreground)] hover:bg-[var(--theme-hover)] transition-all"
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
          {feedback && <p role={feedback.kind === "error" ? "alert" : "status"} className={cn("mt-2 max-w-64 break-words text-left text-xs", feedback.kind === "error" ? "text-[var(--theme-danger)]" : "text-[var(--theme-success)]")}>{feedback.message}</p>}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[var(--theme-surface-muted)] border-b border-[var(--border)] animate-in slide-in-from-top-2 duration-300">
          <td colSpan={6} className="py-6 px-3 sm:px-12">
            <div className="max-w-2xl">
              <AccountRateManager 
                interpreterId={interpreter.id} 
                initialRates={interpreter.accountRates} 
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
