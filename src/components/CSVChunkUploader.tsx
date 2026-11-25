'use client';

import React, { useRef, useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uploadLogChunk } from '@/app/actions/production.actions';
import { prepareProductionCsv, ProductionCsvPreparationError } from '@/lib/production-csv-chunks';

type Summary = {
  inserted: number;
  skipped: number;
  rejected: number;
  confirmedBlocks: number;
  stoppedBlock: number | null;
  uncertain: boolean;
  remainingRecords: number;
  message: string;
};

export function CSVChunkUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const inFlight = useRef(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (inFlight.current) return;
    setFile(e.target.files?.[0] ?? null);
    setSummary(null);
    setProgress(0);
  };

  async function processFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || inFlight.current || summary) return;
    inFlight.current = true;
    setPending(true);
    setProgress(0);
    const result: Summary = { inserted: 0, skipped: 0, rejected: 0, confirmedBlocks: 0, stoppedBlock: null, uncertain: false, remainingRecords: 0, message: '' };
    try {
      const { headers, chunks, totalRows } = await prepareProductionCsv(await file.text());
      let confirmedRows = 0;
      for (const [index, chunk] of chunks.entries()) {
        result.stoppedBlock = index + 1;
        result.remainingRecords = totalRows - confirmedRows - chunk.length;
        // A rejected request can have committed before its response was lost.
        result.uncertain = true;
        const response = await uploadLogChunk(null, { headers, rows: chunk });
        if (!response.success) {
          result.uncertain = response.outcome !== 'not-written';
          result.message = result.uncertain
            ? 'No se pudo confirmar el bloque. Revisa los registros antes de volver a importar.'
            : 'El bloque no se guardó. Revisa el archivo y los permisos antes de continuar.';
          break;
        }
        if (![response.count, response.skipped, response.rejected].every(value => Number.isSafeInteger(value) && value >= 0) ||
            response.count + response.skipped !== response.accepted || response.accepted + response.rejected !== chunk.length) {
          result.message = 'No se pudo confirmar el recuento del bloque. Revisa los registros antes de volver a importar.';
          break;
        }
        result.inserted += response.count;
        result.skipped += response.skipped;
        result.rejected += response.rejected;
        result.confirmedBlocks++;
        result.stoppedBlock = null;
        result.uncertain = false;
        confirmedRows += chunk.length;
        setProgress(Math.round((confirmedRows / totalRows) * 100));
      }
      if (result.stoppedBlock === null) {
        result.message = result.rejected > 0
          ? 'Procesamiento terminado con filas rechazadas. Revisa el archivo antes de volver a importar.'
          : result.inserted > 0 ? 'Procesamiento completado.' : 'No se insertaron filas nuevas.';
      }
    } catch (error) {
      result.message = result.uncertain
        ? 'No se pudo confirmar el bloque. Revisa los registros antes de volver a importar.'
        : error instanceof ProductionCsvPreparationError ? error.message : 'No se pudo leer el archivo.';
    } finally {
      setSummary(result);
      inFlight.current = false;
      setPending(false);
    }
  }

  const warning = Boolean(summary && (summary.stoppedBlock !== null || summary.rejected > 0 || summary.inserted === 0));
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--theme-panel)] p-5 sm:p-8 space-y-6 min-w-0">
      <div>
        <h3 className="text-xl font-bold text-[var(--foreground)]">Telemetría (carga masiva)</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Procesa archivos CSV en bloques de hasta 500 registros completos, según el tamaño de cada bloque.</p>
      </div>
      <form onSubmit={processFile} aria-label="Importación masiva de producción" className="space-y-6">
        <div className={cn(
          "relative border-2 border-dashed rounded-2xl p-5 sm:p-10 flex flex-col items-center justify-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--theme-focus)]",
          warning ? "border-[var(--theme-warning)]" : summary ? "border-[var(--theme-success)]" : "border-[var(--theme-control-border)] hover:bg-[var(--theme-hover)]"
        )}>
          <input type="file" name="file" accept=".csv,text/csv" aria-label="Archivo CSV de producción masiva"
            onChange={handleFileChange} onClick={e => { if (!inFlight.current) e.currentTarget.value = ''; }}
            disabled={pending} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" />
          {warning ? <AlertCircle size={48} aria-hidden="true" className="text-[var(--theme-warning)] mb-4" />
            : summary ? <CheckCircle2 size={48} aria-hidden="true" className="text-[var(--theme-success)] mb-4" />
            : <Upload size={48} aria-hidden="true" className="text-[var(--theme-link)] mb-4" />}
          <p className="text-[var(--foreground)] font-medium text-center break-all">{file ? file.name : 'Selecciona o arrastra un CSV'}</p>
        </div>

        {pending && <p role="status" className="text-sm text-[var(--text-secondary)]">Procesado: {progress}%</p>}
        {summary && (
          <div className="p-4 bg-[var(--theme-surface-muted)] rounded-xl border border-[var(--border)] space-y-2 text-sm">
            <p role={warning ? 'alert' : 'status'} className={warning ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-success)]'}>{summary.message}</p>
            <dl className="space-y-1">
              <div className="flex justify-between gap-2"><dt>Filas insertadas</dt><dd className="font-bold text-[var(--theme-success)]">{summary.inserted}</dd></div>
              <div className="flex justify-between gap-2"><dt>Filas omitidas por la base de datos</dt><dd>{summary.skipped}</dd></div>
              <div className="flex justify-between gap-2"><dt>Filas rechazadas en bloques confirmados</dt><dd className="text-[var(--theme-danger)]">{summary.rejected}</dd></div>
              <div className="flex justify-between gap-2"><dt>Bloques confirmados</dt><dd>{summary.confirmedBlocks}</dd></div>
              {summary.stoppedBlock !== null && <>
                <div className="flex justify-between gap-2"><dt>{summary.uncertain ? 'Bloque sin confirmar' : 'Bloque no guardado'}</dt><dd>{summary.stoppedBlock}</dd></div>
                <div className="flex justify-between gap-2"><dt>Registros posteriores no enviados</dt><dd>{summary.remainingRecords}</dd></div>
              </>}
            </dl>
            <p className="text-xs text-[var(--text-secondary)]">Revisa el historial antes de seleccionar otro archivo. No reenvíes los bloques ya importados.</p>
          </div>
        )}

        <button type="submit" disabled={!file || pending || summary !== null}
          className="theme-action-primary w-full py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2">
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" size={20} /> : <FileText aria-hidden="true" size={20} />}
          {pending ? 'Procesando…' : 'Procesar CSV'}
        </button>
      </form>
    </div>
  );
}
