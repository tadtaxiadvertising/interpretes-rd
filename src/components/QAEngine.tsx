'use client';

import React, { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ShieldAlert, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { submitQAEvaluation } from '@/app/actions/qa.actions';
import { cn } from '@/lib/utils';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
        pending
          ? "bg-[var(--theme-surface-muted)] text-[var(--text-tertiary)] cursor-not-allowed" 
          : "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
      )}
    >
      {pending ? <><Loader2 className="animate-spin" size={20} /> Evaluando...</> : 'Registrar Auditoría Segura'}
    </button>
  );
}

type QaInterpreterOption = { id: number; name: string; externalId: string | null };
type QaProductionSuggestion = {
  id: number;
  interpreterId: number;
  date: string;
  status: string;
};

export function QAEngine({
  interpreters,
  productionLogSuggestions = [],
}: {
  interpreters: QaInterpreterOption[];
  productionLogSuggestions?: QaProductionSuggestion[];
}) {
  const [state, formAction] = useActionState(submitQAEvaluation, null);
  const [criticalError, setCriticalError] = useState(false);
  const [selectedInterpreterId, setSelectedInterpreterId] = useState('');
  const [productionLogId, setProductionLogId] = useState('');
  // Suggestions are not proof that all historical records are covered.
  // The server independently verifies ownership and the unique QA link.
  const matchingLogs = productionLogSuggestions.filter(log =>
    String(log.interpreterId) === selectedInterpreterId,
  );

  return (
    <div className="glass p-8 rounded-3xl border border-[var(--border)] bg-[var(--theme-panel)]">
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-[var(--foreground)] flex items-center gap-3">
          <ShieldAlert className="text-[var(--theme-danger)]" />
          Engine de Calidad y Auditoría
        </h3>
        <p className="text-[var(--text-secondary)] mt-2">Completa el formulario de evaluación. Seleccionar <strong className="text-[var(--theme-danger)]">Error Crítico</strong> forzará automáticamente el score a 0.00% a nivel de backend.</p>
      </div>

      <form action={formAction} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label htmlFor="qa-interpreter" className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider">Intérprete Auditado</label>
            <select 
              id="qa-interpreter"
              name="interpreterId"
              required
              value={selectedInterpreterId}
              onChange={(event) => {
                setSelectedInterpreterId(event.target.value);
                // An old suggested ID cannot be submitted for a new person.
                setProductionLogId('');
              }}
              className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors"
            >
              <option value="">Seleccione un intérprete...</option>
              {interpreters.map(i => (
                <option key={i.id} value={i.id}>{i.name} ({i.externalId})</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="qa-production-log" className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider">Production Log ID (Opcional)</label>
            <input
              type="number"
              id="qa-production-log"
              name="productionLogId"
              min="1" step="1"
              value={productionLogId}
              onChange={(event) => setProductionLogId(event.target.value)}
              list={matchingLogs.length ? 'qa-unreviewed-production-logs' : undefined}
              placeholder="Sin registro o ID anterior"
              className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors font-mono"
            />
            {matchingLogs.length > 0 && (
              <datalist id="qa-unreviewed-production-logs">
                {matchingLogs.map(log => (
                  <option key={log.id} value={log.id}
                    label={`${log.date} · ${log.status}`} />
                ))}
              </datalist>
            )}
            <p className="text-xs text-[var(--text-secondary)]">
              {selectedInterpreterId
                ? `${matchingLogs.length} registro(s) de producción reciente(s) sin QA sugeridos. También puedes introducir un ID histórico válido.`
                : 'Selecciona primero un intérprete para ver registros sin QA disponibles.'}
              El registro vinculado se valida antes de guardar.
            </p>
          </div>
        </div>

        {/* Interruptor de Error Crítico */}
        <div className={cn(
          "p-6 rounded-2xl border transition-all flex items-start gap-4",
          criticalError ? "bg-red-500/10 border-red-500/50" : "bg-[var(--theme-surface-muted)] border-[var(--border)] hover:border-red-500/30"
        )}>
          <div className="pt-1">
             <input 
               type="checkbox" 
               name="criticalError" 
               id="criticalError"
               checked={criticalError}
               onChange={(e) => setCriticalError(e.target.checked)}
               className="w-5 h-5 accent-red-500 cursor-pointer rounded bg-[var(--theme-control-bg)] border-[var(--border)]" 
             />
          </div>
          <div>
            <label htmlFor="criticalError" className="text-lg font-bold text-[var(--foreground)] cursor-pointer block">
              Flag: Error Crítico Detectado
            </label>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Al marcar esta opción, las métricas estándar serán ignoradas y la acción requerida cambiará a "Advertencia / Coaching".</p>
          </div>
        </div>

        {/* Puntuaciones */}
        <div className={cn("grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 transition-opacity duration-300", criticalError && "opacity-30 pointer-events-none grayscale")}>
           {[
             { name: 'protocolScore', label: 'Protocolo (20%)' },
             { name: 'interpretationScore', label: 'Interpretación (40%)' },
             { name: 'languageScore', label: 'Idioma (20%)' },
             { name: 'serviceScore', label: 'Servicio (10%)' },
             { name: 'technicalScore', label: 'Técnico (10%)' }
           ].map(field => (
             <div key={field.name} className="space-y-2">
               <label htmlFor={`qa-${field.name}`} className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">{field.label}</label>
               <input 
                 type="number" 
                 id={`qa-${field.name}`}
                 name={field.name} 
                 min="0" max="100" step="0.01" inputMode="decimal"
                 readOnly={criticalError} 
                 defaultValue="100"
                 required={!criticalError}
                 className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors font-mono" 
               />
             </div>
           ))}
        </div>

        <div className="space-y-2">
          <label htmlFor="qa-comments" className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider">Comentarios del Auditor</label>
          <textarea 
            id="qa-comments"
            name="comments" 
            rows={4}
            maxLength={2000}
            className="w-full bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-xl py-3 px-4 text-[var(--theme-control-text)] focus:border-[var(--theme-focus)] transition-colors resize-none"
            placeholder="Describe la falta de protocolo, problema técnico o excelente desempeño..."
          ></textarea>
        </div>

        {/* Feedback Messages */}
        {state?.error && (
          <div role="alert" className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-[var(--theme-danger)] flex items-center gap-3 animate-in fade-in">
             <AlertTriangle />
             <span className="font-bold">{state.error}</span>
          </div>
        )}

        {state?.success && (
          <div role="status" className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-[var(--theme-success)] flex items-center gap-3 animate-in fade-in">
             <CheckCircle2 />
             <span className="font-bold">{state.message}</span>
          </div>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
