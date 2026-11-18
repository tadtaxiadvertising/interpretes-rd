'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, X, Loader2, Calendar, Clock, User, FileText } from 'lucide-react';
import { addManualCall } from '@/app/actions/calls';
import { useRouter } from 'next/navigation';

function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

interface ManualCallFormProps {
  interpreters: { id: number; name: string }[];
}

export default function ManualCallForm({ interpreters }: ManualCallFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [startTime, setStartTime] = useState('');
  const submitting = useRef(false);
  const router = useRouter();

  // Initialize only on the client: datetime-local is in browser time.
  useEffect(() => { setStartTime(localDateTimeValue(new Date())); }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting.current || needsReview) return;
    const form = e.currentTarget;
    const formData = new FormData(form);
    const rawTime = String(formData.get('startedAt') ?? '');
    const parsedTime = new Date(rawTime);
    if (!rawTime || !Number.isFinite(parsedTime.getTime())) {
      setError('Introduce una fecha y hora válidas.');
      return;
    }
    // Send an unambiguous timestamp instead of a datetime-local without a zone.
    formData.set('startedAt', parsedTime.toISOString());

    submitting.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const result = await addManualCall(formData);
      if (result.success) {
        setIsOpen(false);
        form.reset();
        setStartTime(localDateTimeValue(new Date()));
        setNeedsReview(false);
        setError(null);
        // Committed row must not be reported as failed due to UI refresh.
        try {
          router.refresh();
        } catch {
          // Next navigation or a new page load will refresh the call list.
        }
      } else if (result.code === 'VALIDATION_ERROR' || result.code === 'NOT_FOUND' ||
                 result.code === 'UNAUTHORIZED') {
        setError('No se guardó la llamada. Revisa los campos y permisos.');
      } else {
        // A response can be lost after DB commit. Do not retry automatically.
        setNeedsReview(true);
        setError('No se pudo confirmar el guardado. Revisa el historial de llamadas antes de volver a registrar.');
      }
    } catch {
      setNeedsReview(true);
      setError('No se pudo confirmar el guardado. Revisa el historial de llamadas antes de volver a registrar.');
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-green-900/20"
      >
        <Plus size={18} />
        Add Manual Call
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!submitting.current) setIsOpen(false); }} />
          
          <div className="relative w-full max-w-lg glass rounded-3xl p-8 border border-white/10 shadow-2xl animate-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Plus size={20} className="text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-white">Manual Call Entry</h3>
              </div>
              <button
                type="button"
                disabled={isLoading}
                aria-label="Cerrar registro manual"
                onClick={() => { if (!submitting.current) setIsOpen(false); }}
                className="text-gray-500 hover:text-white p-1"
              >
                <X size={20} />
              </button>
            </div>

            {error && (
              <div role="alert" className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-sm">
                <AlertCircle size={18} />
                <div>{error}</div>
                {needsReview && (
                  <a
                    href="/admin/calls"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold"
                  >
                    Revisar historial
                  </a>
                )}
              </div>
            )}

            {needsReview && (
              <div className="mb-5 rounded-xl border border-amber-500/40 p-4 text-sm text-amber-100">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    if (submitting.current) return;
                    setNeedsReview(false);
                    setError(null);
                  }}
                  className="rounded-lg border border-amber-400/50 px-3 py-2 font-semibold hover:bg-amber-950/30"
                >
                  Confirmo que la llamada no aparece; habilitar registro
                </button>
                <p className="mt-2 text-xs">
                  Si la llamada aparece en el historial, cierra este formulario sin reenviarla.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                  <User size={14} /> Interpreter
                </label>
                <select
                  name="interpreterId"
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-green-500/50 appearance-none"
                >
                  <option value="" className="bg-[#1a1a1f]">Select Interpreter...</option>
                  {interpreters.map((i) => (
                    <option key={i.id} value={i.id} className="bg-[#1a1a1f]">
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="manual-call-start" className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                    <Calendar size={14} /> Start Time
                  </label>
                  <input
                    id="manual-call-start"
                    type="datetime-local"
                    name="startedAt"
                    required
                    value={startTime}
                    disabled={isLoading}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-green-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                    <Clock size={14} /> Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    name="durationMinutes"
                    step="0.1"
                    min="0.1"
                    max="35791394"
                    disabled={isLoading}
                    required
                    placeholder="e.g. 15.5"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-green-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                  <FileText size={14} /> Notes
                </label>
                <textarea
                  name="notes"
                  maxLength={2000}
                  disabled={isLoading}
                  placeholder="Reason for manual entry..."
                  rows={3}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-green-500/50 resize-none"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => { if (!submitting.current) setIsOpen(false); }}
                  disabled={isLoading}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || needsReview}
                  className="flex-[2] py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-900/20"
                >
                  {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                  Save Call Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function AlertCircle({ size }: { size: number }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
