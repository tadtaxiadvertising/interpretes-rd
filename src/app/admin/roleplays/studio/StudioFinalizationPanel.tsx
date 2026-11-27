'use client';

import type { MouseEvent } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { formatStudioTime as formatTime } from '@/lib/roleplay-studio/format-time';
import type { StudioPublicationPart } from '@/lib/roleplay-studio/publication-parts';
import type { LocalWavPart } from '@/lib/roleplay-studio/local-wav-assignment';
import StudioProductionPanel from './StudioProductionPanel';

type Part = Pick<StudioPublicationPart<unknown>, 'key' | 'number' | 'first' | 'last' | 'seconds'>;
type WavPart = Pick<LocalWavPart<unknown>, 'key' | 'bytes'>;
type Props = {
  segmentCount: number;
  expandedEditor: boolean;
  publicationPlan: { parts: Part[]; issue: string | null };
  currentWavPlan: { parts: WavPart[]; issue: string | null } | null;
  selectedPublicationPart?: Part;
  hasAudio: boolean;
  duration: number;
  sourceRequiresLocal: boolean;
  hasCompound: boolean;
  allowServerZipExport: boolean;
  localOnly: boolean;
  wavSource: boolean;
  localMp3Eligible: boolean;
  convertedMp3Bytes: number | null;
  busy: boolean;
  draftBusy: boolean;
  analyzingSilences: boolean;
  activeProductionKeys: ReadonlyMap<string, string> | null;
  readyAssignment: { token: string; partKey?: string } | null;
  onSelectPart: (key: string) => void;
  onSaveDraft: () => void;
  onDownloadPart: () => void;
  onChangeMode: (mode: 'local' | 'server') => void;
  onReleaseMp3: () => void;
  onEnableMp3: () => void;
  onPrepareLocal: () => void;
  onPrepareServer: () => void;
  onDownload: () => void;
  onConfirmNavigation: () => boolean;
  onContinue: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/** Presentation only: no audio files, provider calls, or editorial mutation. */
export default function StudioFinalizationPanel({
  segmentCount, expandedEditor, publicationPlan, currentWavPlan, selectedPublicationPart,
  hasAudio, duration, sourceRequiresLocal, hasCompound, allowServerZipExport, localOnly, wavSource,
  localMp3Eligible, convertedMp3Bytes, busy, draftBusy, analyzingSilences, activeProductionKeys, readyAssignment,
  onSelectPart, onSaveDraft, onDownloadPart, onChangeMode, onReleaseMp3, onEnableMp3,
  onPrepareLocal, onPrepareServer, onDownload, onConfirmNavigation, onContinue,
}: Props) {
  const operationPending = busy || draftBusy || analyzingSilences;
  const nextStep = !hasAudio || duration <= 0
    ? 'Selecciona una grabación válida para empezar.'
    : busy ? 'Hay una preparación en curso. Espera a que termine antes de continuar.'
      : draftBusy ? 'Se está verificando el proyecto.'
        : analyzingSilences ? 'Finaliza el análisis de pausas antes de preparar el paquete.'
          : !segmentCount ? 'Añade al menos una intervención y revisa sus cortes.'
            : readyAssignment ? 'El paquete está preparado. Continúa a asignación para elegir el destinatario.'
              : publicationPlan.issue && segmentCount > ROLEPLAY_MAX_SCENARIOS
                ? 'Guarda el borrador ampliado y revisa la incidencia del plan de publicación antes de preparar las partes.'
                : !localOnly ? (segmentCount > ROLEPLAY_MAX_SCENARIOS
                ? 'El proyecto supera el límite de publicación. Guarda el plan local de una parte para exportarla por separado.'
                : 'Revisa los cortes y pulsa «Preparar para asignación». El original se enviará al servidor.')
                : wavSource ? (!currentWavPlan
                  ? 'Calculando la compatibilidad y el tamaño de los cortes WAV.'
                  : currentWavPlan.issue || !currentWavPlan.parts.length
                    ? 'Guarda el plan JSON y utiliza el exportador de escritorio para preparar los cortes.'
                    : currentWavPlan.parts.length > 1 && !selectedPublicationPart
                      ? 'Selecciona una parte del roleplay antes de preparar sus cortes WAV.'
                      : 'Prepara los cortes WAV locales para continuar a asignación sin descargar un ZIP.')
                  : localMp3Eligible
                    ? 'Habilita el procesamiento local MP3 para preparar los cortes sin subir el original.'
                    : segmentCount > ROLEPLAY_MAX_SCENARIOS
                      ? 'Selecciona una parte y descarga su plan JSON para utilizar el exportador de escritorio.'
                      : 'Descarga el plan local JSON y utiliza el exportador de escritorio junto con la grabación original.';
  return (
    <>
    <h3 id="studio-export" className="scroll-mt-6 border-t border-[var(--border)] pt-4 text-base font-semibold text-[var(--foreground)]">Preparar paquete del roleplay</h3>
    <div role="status" aria-label="Siguiente paso de preparación" className="rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-surface-muted)] p-3 text-sm text-[var(--foreground)]">
      <p className="font-semibold">Siguiente paso</p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{nextStep}</p>
    </div>
    {segmentCount > ROLEPLAY_MAX_SCENARIOS && <div role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--theme-warning)]">
      Este proyecto supera el máximo publicable de {ROLEPLAY_MAX_SCENARIOS} intervenciones. Puedes preparar partes independientes sin borrar intervenciones.
      <button type="button" disabled={busy || draftBusy} onClick={onSaveDraft} className="ml-2 rounded-lg theme-action-secondary px-3 py-2">Guardar borrador ampliado</button>
    </div>}
    {segmentCount > 0 && (expandedEditor || publicationPlan.parts.length > 1) && (
      <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3">
        <h4 className="text-sm font-semibold text-[var(--foreground)]">Preparar roleplays por partes</h4>
        <p className="text-xs text-[var(--text-secondary)]">Se proponen partes cronológicas de hasta {ROLEPLAY_MAX_SCENARIOS} intervenciones y 15 minutos de audio cada una. {currentWavPlan && !currentWavPlan.issue ? 'Para WAV también se aplica el máximo de 16 MiB por transferencia, incluido el manifiesto.' : 'Descarga solo la parte elegida, en formato local compatible.'} El proyecto completo no se modifica.</p>
        {publicationPlan.issue ? <p role="alert" className="text-xs text-[var(--theme-warning)]">{publicationPlan.issue}</p> : <>
          <label className="block text-sm text-[var(--foreground)]">Parte del roleplay
            <select value={selectedPublicationPart?.key ?? ''} disabled={operationPending}
              onChange={event => onSelectPart(event.currentTarget.value)}
              className="mt-1 min-h-11 w-full min-w-0 rounded-lg border sm:min-h-0 border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]">
              <option value="">Selecciona una parte ({publicationPlan.parts.length} disponibles)</option>
              {publicationPlan.parts.map(part => {
                const wavPart = currentWavPlan?.parts.find(item => item.key === part.key);
                return <option key={part.key} value={part.key}>Parte {part.number} · intervenciones {part.first}–{part.last} · {formatTime(part.seconds)}{wavPart ? ' · ' + (wavPart.bytes/(1024*1024)).toFixed(2) + ' MiB' : ''}</option>;
              })}
            </select>
          </label>
          <button type="button" disabled={!selectedPublicationPart || operationPending}
            onClick={onDownloadPart}
            className="rounded-lg theme-action-primary px-3 py-2 text-sm font-semibold disabled:opacity-50">Descargar parte seleccionada (JSON local)</button>
        </>}
      </div>
    )}
    <p className="text-sm text-[var(--text-secondary)]">Escucha los turnos y revisa los avisos. Prepara los cortes y continúa a asignación, o guarda un paquete para utilizarlo después.</p>
      {hasAudio && duration > 0 && !sourceRequiresLocal && !hasCompound && (
        <fieldset aria-label="Modo de exportación del MP3" className="rounded-lg border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3">
          <legend className="px-1 text-sm font-semibold text-[var(--foreground)]">Dónde preparar los cortes</legend>
          <label className="flex items-start gap-2 text-sm text-[var(--theme-info)]">
            <input type="radio" name="studio-export-location"
              checked={!allowServerZipExport}
              onChange={() => onChangeMode('local')}
              className="mt-1 accent-cyan-400"/>
            Local (predeterminado): no subir el MP3. Prepara cortes compatibles en el navegador o usa el exportador de escritorio.
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm text-[var(--foreground)]">
            <input type="radio" name="studio-export-location"
              checked={allowServerZipExport}
              onChange={() => onChangeMode('server')}
              className="mt-1 accent-blue-400"/>
            Servidor (opcional): el MP3 se subirá al exportar y consumirá recursos de la plataforma.
          </label>
        </fieldset>
      )}
      {localOnly && duration > 0 && (
        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs leading-5 text-[var(--theme-info)]">
          {hasCompound && (
            <p className="mb-2 font-semibold text-[var(--theme-warning)]">
              Proyecto compuesto v2: la exportación local se ha activado automáticamente.
              Usa un exportador actualizado para que el MP3 omita las pausas; la grabación no se envía al servidor.
            </p>
          )}
          <strong>Preparación local:</strong> la grabación no se sube al servidor.
          Puedes revisar, marcar y guardar los cortes sin decodificar el archivo completo.
          {wavSource || localMp3Eligible ? ' Puedes preparar cortes compatibles directamente en este navegador y continuar a asignación sin ZIP.' : ' Para este formato o duración, utiliza el exportador de escritorio.'}
          <details className="mt-2 rounded border border-cyan-300/15 px-2 py-1">
            <summary className="cursor-pointer font-semibold">Alternativa: guardar JSON y usar el exportador de escritorio</summary>
            <p className="mt-2">El JSON no contiene audio ni video. Paso 1: guarda el proyecto JSON. Paso 2: genera el ZIP junto a la grabación original. Paso 3: importa el ZIP desde «Crear roleplay».</p>
          <a
            href="https://github.com/tadtaxiadvertising/interpretes-rd/blob/main/tools/roleplay-studio-desktop/README.md"
            target="_blank" rel="noopener noreferrer"
            className="mt-1 inline-block font-semibold text-[var(--theme-info)] underline underline-offset-2">
            Cómo obtener el exportador local actualizado
          </a>
          <details className="mt-2 rounded border border-cyan-300/15 px-2 py-1">
            <summary className="cursor-pointer font-semibold">Cómo generar el ZIP sin subir el original</summary>
            <p className="mt-2">
              Opción con interfaz gráfica: cuando el mantenedor haya generado y verificado
              la aplicación de escritorio, ábrela y pulsa «Elegir grabación + JSON».
              Selecciona ambos archivos una vez: se propondrá un nombre ZIP disponible.
              Pulsa «Generar ZIP local»; no requiere comandos ni subir la grabación.
            </p>
            <details className="mt-2 rounded border border-cyan-300/15 px-2 py-1">
              <summary className="cursor-pointer">Alternativa técnica con Node.js</summary>
              <p className="mt-1">En un equipo con el repositorio instalado, ejecuta:</p>
              <code className="mt-1 block break-all rounded bg-[var(--theme-surface-muted)] p-2 text-[11px] text-[var(--foreground)]">
                node scripts/export-studio-long-local.mjs --source llamada.mp4 --project roleplay-studio-proyecto-largo.json --output roleplay-studio.zip
              </code>
            </details>
          </details>
          </details>
        </div>
      )}
    {(!localOnly || wavSource || localMp3Eligible) && (
      <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
        <h3 className="font-semibold text-[var(--foreground)]">Continuar a la asignación sin descargar ZIP</h3>
        <p className="text-xs text-[var(--text-secondary)]">{localOnly ? 'WAV PCM de 16 bits compatible o MP3 corto convertido localmente: se preparan los cortes sin subir el original, hasta 16 MiB por transferencia. Los cortes se subirán únicamente al crear el roleplay.' : 'Se procesará el MP3 en el servidor según la opción autorizada.'} El paquete pasará temporalmente al formulario de esta pestaña; guarda el proyecto original antes de salir. No se creará ninguna sesión hasta confirmar el destinatario.</p>
        {convertedMp3Bytes !== null && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span>Copia WAV temporal: {(convertedMp3Bytes/(1024*1024)).toFixed(2)} MiB. Se conserva para preparar otras partes sin reconvertir.</span>
            <button type="button" onClick={onReleaseMp3} disabled={operationPending}
              className="rounded-lg theme-action-secondary px-3 py-2 font-semibold disabled:opacity-50">Liberar copia WAV temporal</button>
          </div>
        )}
        {wavSource && segmentCount > 0 && !currentWavPlan && <p role="status" className="text-xs text-[var(--text-secondary)]">Calculando tamaño de los cortes WAV…</p>}
        {currentWavPlan && !currentWavPlan.issue && <p className="text-xs text-[var(--text-secondary)]">{currentWavPlan.parts.length} {currentWavPlan.parts.length === 1 ? 'paquete compatible' : 'paquetes compatibles'} · {((currentWavPlan.parts.reduce((sum,part) => sum + part.bytes,0))/(1024*1024)).toFixed(2)} MiB en total. Se prepara solo el paquete elegido.</p>}
        {currentWavPlan?.issue && <p role="alert" className="text-xs text-[var(--theme-warning)]">{currentWavPlan.issue} Puedes conservar el plan JSON y usar el exportador local.</p>}
        {activeProductionKeys && activeProductionKeys.size > 0 && (
          <StudioProductionPanel parts={publicationPlan.parts} activeProductionKeys={activeProductionKeys}
            preparedPartKey={readyAssignment ? readyAssignment.partKey ?? (publicationPlan.parts.length === 1 ? publicationPlan.parts[0].key : null) : null}
            localOnly={localOnly} disabled={operationPending}
            onSelectPart={onSelectPart} onConfirmNavigation={onConfirmNavigation}/>
        )}
        {readyAssignment && (!activeProductionKeys || !activeProductionKeys.has(readyAssignment.partKey ?? publicationPlan.parts[0]?.key ?? '')) && <p className="text-xs text-[var(--theme-warning)]">Seguimiento no disponible para este paquete. Puedes continuar, pero verifica las sesiones existentes para evitar duplicados.</p>}
        {readyAssignment ? (
          <Link href={'/admin/roleplays/new?studioTransfer=' + encodeURIComponent(readyAssignment.token)}
            prefetch={false}
            onClick={onContinue}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl theme-action-primary px-4 py-2 font-semibold sm:min-h-0 sm:w-auto">Continuar a asignación</Link>
        ) : localOnly ? (
          <div className="flex flex-wrap gap-2">
            {localMp3Eligible && !wavSource && <button type="button" disabled={operationPending} onClick={onEnableMp3}
              className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 sm:min-h-0 sm:w-auto font-semibold disabled:opacity-50">Habilitar procesamiento local MP3 (WAV 24 kHz)</button>}
            {wavSource && <button type="button" onClick={onPrepareLocal}
              disabled={operationPending || !currentWavPlan || Boolean(currentWavPlan.issue) || !currentWavPlan.parts.length || (currentWavPlan.parts.length > 1 && !selectedPublicationPart)}
              className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 sm:min-h-0 sm:w-auto font-semibold disabled:opacity-50">{currentWavPlan && currentWavPlan.parts.length > 1 && selectedPublicationPart ? `Preparar parte ${selectedPublicationPart.number} en WAV local` : 'Preparar WAV local para asignación'}</button>}
          </div>
        ) : <button type="button" onClick={onPrepareServer}
            disabled={operationPending || !segmentCount || segmentCount > ROLEPLAY_MAX_SCENARIOS}
            className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 sm:min-h-0 sm:w-auto font-semibold disabled:opacity-50">Preparar para asignación</button>}
      </div>
    )}
    <button type="button" onClick={onDownload} disabled={operationPending || !segmentCount || segmentCount > ROLEPLAY_MAX_SCENARIOS}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl theme-action-success px-5 py-3 font-bold sm:w-auto">
      <Download size={18} /> {busy
        ? 'Procesando segmentos…'
        : draftBusy ? 'Verificando proyecto…'
          : localOnly ? 'Descargar plan local de cortes (JSON)' : 'Exportar MP3 + manifiesto ZIP (envía MP3 al servidor)'}
    </button>
    </>
  );
}
