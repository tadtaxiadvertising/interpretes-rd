'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Clock, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
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
        className="flex items-center gap-2 text-white font-bold transition-all group px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-500 rounded-2xl shadow-lg shadow-blue-600/20 hover:from-blue-500 hover:to-blue-400 hover:shadow-blue-500/30 hover:-translate-y-0.5"
      >
        <Plus size={20} className="group-hover:rotate-90 transition-transform duration-300" />
        <span>Registro Rápido</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-md transition-opacity animate-in fade-in duration-300"
            onClick={() => { if (!submitInFlight.current) setIsOpen(false); }}
          />

          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 overflow-hidden animate-in fade-in zoom-in-95 duration-300">
            <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none" />

            <button
              onClick={() => { if (!submitInFlight.current) setIsOpen(false); }}
              disabled={isSubmitting}
              type="button"
              aria-label="Cerrar registro rápido"
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-800 rounded-full transition-colors"
            >
              <X size={20} />
            </button>

            <h3 className="text-xl font-bold text-white mb-1">Registrar Llamada Manual</h3>
            <p className="text-sm text-slate-400 mb-6">Ingresa la duración exacta de la llamada.</p>

            <form onSubmit={handleSubmit} aria-label="Formulario de registro rápido" className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="minutes" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Minutos
                  </label>
                  <div className="relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
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
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-3 pl-12 pr-4 text-white placeholder:text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="seconds" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Segundos
                  </label>
                  <div className="relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input
                      id="seconds"
                      type="number"
                      min="0"
                      disabled={isSubmitting}
                      max="59"
                      value={seconds}
                      onChange={(e) => { setSeconds(e.target.value); if (!needsReview) setSubmissionError(null); }}
                      placeholder="00"
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-3 pl-12 pr-4 text-white placeholder:text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
                    />
                  </div>
                </div>
              </div>

              {submissionError && (
                <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
                  {submissionError}
                </p>
              )}
              {needsReview && (
                <div className="space-y-3 rounded-xl border border-amber-500/30 p-3">
                  <a
                    href="/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm font-semibold text-blue-300 underline underline-offset-2"
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
                    className="w-full rounded-xl border border-amber-400/50 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-950/40"
                  >
                    Confirmo que la llamada no aparece; habilitar registro
                  </button>
                  <p className="text-xs text-slate-400">
                    Si aparece en el historial, cierra este formulario sin reenviarlo.
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || needsReview || !validDuration}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-lg transition-all",
                  isSubmitting || needsReview || !validDuration
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 active:scale-95"
                )}
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
          </div>
        </div>
      )}
    </>
  );
}
