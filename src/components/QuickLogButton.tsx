'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Clock, Send, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { quickLog } from '@/app/actions/quick-log';

export function QuickLogButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const submitInFlight = useRef(false);

  const router = useRouter();

  const enteredMinutes = Number(minutes || '0');
  const enteredSeconds = Number(seconds || '0');
  const validDuration = Boolean(minutes || seconds) &&
    Number.isInteger(enteredMinutes) && enteredMinutes >= 0 && enteredMinutes <= 100_000 &&
    Number.isInteger(enteredSeconds) && enteredSeconds >= 0 && enteredSeconds <= 59 &&
    (enteredMinutes > 0 || enteredSeconds > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A ref is synchronous even when React has not committed disabled=true.
    // This protects two submissions arriving in the same event batch.
    if (submitInFlight.current || needsReview || !validDuration) return;
    submitInFlight.current = true;
    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const formData = new FormData();
      formData.append('durationMinutes', minutes || '0');
      formData.append('seconds', seconds || '0');

      const result = await quickLog(formData);
      if (!result.success) {
        if (result.code === 'CONFLICT') {
          setSubmissionError('No se guardó: el período de producción cambió o está bloqueado. Revisa tus registros antes de continuar.');
        } else if (result.code === 'VALIDATION_ERROR') {
          setSubmissionError('Revisa la duración ingresada. No se guardó la llamada.');
        } else {
          // A backend failure can happen after a DB commit. Without an
          // idempotency key, retrying blindly risks a second paid call.
          setNeedsReview(true);
          setSubmissionError('No se pudo confirmar el guardado. Revisa tu historial antes de intentar registrar de nuevo esta llamada.');
        }
        return;
      }

      setIsOpen(false);
      setMinutes('');
      setSeconds('');
      setNeedsReview(false);
      // Database commit succeeded. A UI refresh failure is not a failed call.
      try {
        router.refresh();
      } catch {
        // The next page load will pick up the stored record.
      }
    } catch {
      // A network drop cannot establish whether the database committed.
      // Keep the draft and block retries until the operator reviews history.
      setNeedsReview(true);
      setSubmissionError('No se pudo confirmar el guardado. Revisa tu historial antes de intentar registrar de nuevo esta llamada.');
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        id="btn-quick-log"
        className="theme-action-primary flex items-center gap-2 font-bold transition-colors px-5 sm:px-8 py-4 rounded-2xl"
      >
        <Plus size={20} aria-hidden="true" />
        <span>Registro Rápido</span>
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => { if (!submitInFlight.current) setIsOpen(false); }}
        closeDisabled={isSubmitting}
        closeLabel="Cerrar registro rápido"
        title="Registrar Llamada Manual"
        maxWidth="max-w-md"
      >
        <p className="text-sm text-[var(--text-secondary)] mb-6">Ingresa la duración exacta de la llamada.</p>
        <form onSubmit={handleSubmit} aria-label="Formulario de registro rápido" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="minutes" className="block text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                Minutos
              </label>
              <div className="relative">
                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                <input
                  id="minutes"
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  disabled={isSubmitting}
                  value={minutes}
                  onChange={(e) => { setMinutes(e.target.value); if (!needsReview) setSubmissionError(null); }}
                  placeholder="0"
                  className="w-full min-w-0 bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-2xl py-3 pl-12 pr-4 text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--theme-focus)] focus:ring-1 focus:ring-[var(--theme-focus)] transition-all font-mono"
                />
              </div>
            </div>

            <div>
              <label htmlFor="seconds" className="block text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                Segundos
              </label>
              <div className="relative">
                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
                <input
                  id="seconds"
                  type="number"
                  min="0"
                  disabled={isSubmitting}
                  max="59"
                  value={seconds}
                  onChange={(e) => { setSeconds(e.target.value); if (!needsReview) setSubmissionError(null); }}
                  placeholder="00"
                  className="w-full min-w-0 bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-2xl py-3 pl-12 pr-4 text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--theme-focus)] focus:ring-1 focus:ring-[var(--theme-focus)] transition-all font-mono"
                />
              </div>
            </div>
          </div>

          {submissionError && (
            <p role="alert" className="rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3 text-sm text-[var(--theme-warning)]">
              {submissionError}
            </p>
          )}
          {needsReview && (
            <div className="space-y-3 rounded-xl border border-amber-500/30 p-3">
              <a
                href="/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm font-semibold text-[var(--theme-link)] underline underline-offset-2"
              >
                Abrir historial de llamadas en otra pestaña
              </a>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  if (submitInFlight.current) return;
                  setNeedsReview(false);
                  setSubmissionError(null);
                }}
                className="theme-action-secondary w-full rounded-xl px-3 py-2 text-sm font-semibold"
              >
                Confirmo que la llamada no aparece; habilitar registro
              </button>
              <p className="text-xs text-[var(--text-secondary)]">
                Si aparece en el historial, cierra este formulario sin reenviarlo.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || needsReview || !validDuration}
            className="theme-action-primary w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-lg transition-colors"
          >
            {isSubmitting ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <Send size={20} />
                Guardar Registro
              </>
            )}
          </button>
        </form>
      </Modal>
    </>
  );
}
