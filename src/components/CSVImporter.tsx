'use client';

import React, { useRef, useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CSVImporterProps {
  type: 'interpreters' | 'production' | 'qa';
  title: string;
  description: string;
}

type ImportResult = { successCount: number; errorCount: number; errors: string[] };

function isImportResult(value: unknown): value is ImportResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ImportResult>;
  return Number.isSafeInteger(result.successCount) && (result.successCount ?? -1) >= 0 &&
    Number.isSafeInteger(result.errorCount) && (result.errorCount ?? -1) >= 0 &&
    Array.isArray(result.errors) && result.errors.every(error => typeof error === 'string');
}

export function CSVImporter({ type, title, description }: CSVImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'partial' | 'error'>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (inFlight.current) return;
    setFile(e.target.files?.[0] ?? null);
    setStatus('idle');
    setResult(null);
    setMessage('');
  };

  const handleUpload = async () => {
    if (!file || inFlight.current || status !== 'idle') return;
    inFlight.current = true;
    setStatus('uploading');
    setResult(null);
    setMessage('');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
      const response = await fetch('/api/import/csv', { method: 'POST', body: formData });
      const data: unknown = await response.json();
      if (!response.ok || !isImportResult(data)) {
        throw new Error('Import outcome not confirmed');
      }
      setResult(data);
      if (data.errorCount > 0) {
        setStatus(data.successCount > 0 ? 'partial' : 'error');
        setMessage(data.successCount > 0
          ? 'Importación parcial. Revisa las filas con errores antes de volver a importar.'
          : 'No se confirmaron filas importadas. Revisa el archivo y sus columnas.');
      } else if (data.successCount === 0) {
        setStatus('error');
        setMessage('No se confirmaron filas importadas. Comprueba que el archivo contiene datos válidos.');
      } else {
        setStatus('success');
        setMessage('Importación completada.');
      }
    } catch {
      setStatus('error');
      setMessage('No se pudo confirmar el resultado. Revisa los registros existentes antes de seleccionar otro archivo o volver a importar.');
    } finally {
      inFlight.current = false;
    }
  };

  const warning = status === 'error' || status === 'partial';
  const uploading = status === 'uploading';

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--theme-panel)] p-5 sm:p-8 space-y-6 min-w-0">
      <div>
        <h3 className="text-xl font-bold text-[var(--foreground)]">{title}</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{description}</p>
      </div>

      <div className={cn(
        "relative border-2 border-dashed rounded-2xl p-5 sm:p-10 flex flex-col items-center justify-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--theme-focus)]",
        status === 'success' ? "border-[var(--theme-success)]" :
        warning ? "border-[var(--theme-warning)]" :
        "border-[var(--theme-control-border)] hover:bg-[var(--theme-hover)]"
      )}>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label={`Archivo CSV: ${title}`}
          onClick={e => { if (!inFlight.current) e.currentTarget.value = ''; }}
          onChange={handleFileChange}
          disabled={uploading}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        {status === 'success' ? (
          <CheckCircle2 size={48} aria-hidden="true" className="text-[var(--theme-success)] mb-4" />
        ) : warning ? (
          <AlertCircle size={48} aria-hidden="true" className="text-[var(--theme-warning)] mb-4" />
        ) : (
          <Upload size={48} aria-hidden="true" className="text-[var(--theme-link)] mb-4" />
        )}
        <p className="text-[var(--foreground)] font-medium break-all text-center">
          {file ? file.name : "Selecciona o arrastra un archivo CSV"}
        </p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">Formato CSV</p>
      </div>

      {message && <p role={warning ? 'alert' : 'status'} className={cn("text-sm break-words", warning ? "text-[var(--theme-warning)]" : "text-[var(--theme-success)]")}>{message}</p>}
      {result && (
        <div className="p-4 bg-[var(--theme-surface-muted)] rounded-xl border border-[var(--border)] space-y-2">
          <div className="flex justify-between gap-2 text-sm">
            <span className="text-[var(--text-secondary)]">Filas importadas:</span>
            <span className="text-[var(--theme-success)] font-bold">{result.successCount}</span>
          </div>
          <div className="flex justify-between gap-2 text-sm">
            <span className="text-[var(--text-secondary)]">Filas con errores:</span>
            <span className="text-[var(--theme-danger)] font-bold">{result.errorCount}</span>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--text-secondary)] mb-1 font-bold">Filas que requieren revisión (vista previa):</p>
              {result.errors.slice(0, 10).map((err, i) => (
                <p key={i} className="text-xs text-[var(--theme-danger)] break-words">
                  {err.match(/^Row (\d+):/) ? `Fila de datos ${err.match(/^Row (\d+):/)?.[1]}: verifica los valores y las referencias.` : 'Verifica los valores y las referencias de esta fila.'}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleUpload}
        disabled={!file || status !== 'idle'}
        className="theme-action-primary w-full py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
      >
        {uploading ? <Loader2 aria-hidden="true" className="animate-spin" size={20} /> : <FileText aria-hidden="true" size={20} />}
        {uploading ? "Procesando…" : "Procesar importación"}
      </button>
      {status !== 'idle' && !uploading && <p className="text-xs text-[var(--text-secondary)]">Para iniciar otra importación, selecciona un archivo después de revisar el resultado.</p>}
    </div>
  );
}
