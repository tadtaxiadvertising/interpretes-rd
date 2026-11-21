'use client';

import { useMemo, useState } from 'react';
import type { LocalVadSnapshot } from '@/lib/roleplay-studio/local-vad';
import type { StudioSuggestedClip } from '@/lib/roleplay-studio/silence-analysis';
import { proposeLocalVadCuts } from '@/lib/roleplay-studio/vad-suggestions';

type ExistingCut = { start: number; end: number };

const clipKey = (clip: StudioSuggestedClip) => `${clip.start}:${clip.end}`;

export default function LocalVadAssistant({
  snapshot, duration, existing, onApply, onPreview,
}: {
  snapshot: LocalVadSnapshot | null;
  duration: number;
  existing: readonly ExistingCut[];
  onApply: (segments: StudioSuggestedClip[]) => void;
  onPreview?: (region: StudioSuggestedClip) => void;
}) {
  // Keep review tied to the exact decoded snapshot. An effect that resets
  // `reviewed` after each snapshot update can race against a user's click
  // and unexpectedly hide the preview controls while they are reviewing.
  const [reviewedSnapshot, setReviewedSnapshot] = useState<LocalVadSnapshot | null>(null);
  const [excludedCuts, setExcludedCuts] = useState<Set<string>>(() => new Set());
  const proposal = useMemo(
    () => proposeLocalVadCuts(snapshot?.segments ?? [], duration, existing),
    [snapshot, duration, existing],
  );
  const selectedClips = proposal.clips.filter(clip => !excludedCuts.has(clipKey(clip)));

  const status = snapshot?.status ?? 'loading';
  const ready = status === 'ready';
  const reviewed = ready && reviewedSnapshot === snapshot;
  const availableSlots = Math.max(0, 25 - existing.length);

  return (
    <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
      <h2 className="text-sm font-bold text-cyan-100">Actividad de voz en este equipo (VAD)</h2>
      <p className="mt-2 text-xs leading-5 text-slate-300">
        Reutiliza el audio que el navegador ya decodificó para la forma de onda.
        No envía archivos ni vuelve a decodificar el MP3. Detecta energía acústica,
        no palabras, identidad del hablante ni idioma. Todos los cortes requieren revisión.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => {
          setExcludedCuts(new Set());
          setReviewedSnapshot(snapshot);
        }}
          disabled={!ready || availableSlots === 0}
          className="rounded-lg border border-cyan-300/30 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50">
          {status === 'loading' ? 'Preparando audio local…' : 'Revisar actividad local'}
        </button>
        {ready && <span className="text-xs text-slate-300">
          {snapshot?.segments.length ?? 0} regiones con actividad detectadas
        </span>}
      </div>
      {status === 'limited' && (
        <p role="status" className="mt-2 text-xs text-amber-200">
          Para cuidar la memoria, el análisis local requiere MP3 de hasta 4 minutos y 8 MiB.
          Marca los cortes manualmente o utiliza subtítulos temporizados.
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status" className="mt-2 text-xs text-amber-200">
          Este navegador no pudo decodificar el audio. Puedes marcar los cortes a mano,
          importar subtítulos o autorizar expresamente el respaldo del servidor.
        </p>
      )}
      {reviewed && ready && (
        <>
          {proposal.clips.length === 0 ? (
            <p role="status" className="mt-2 text-xs text-amber-200">
              No hay cortes adicionales compatibles con los límites o no se detectó
              suficiente actividad. Ajusta manualmente los cortes o usa subtítulos.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-amber-100">
                Escucha cada región y elige las que deseas añadir. Solo se incluirán
                cortes completos que no se solapen con intervenciones existentes; revisa
                hablantes e idioma antes de guardar.
              </p>
              <button type="button"
                onClick={() => { onApply(selectedClips); setReviewedSnapshot(null); }}
                disabled={selectedClips.length === 0}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                Añadir {selectedClips.length} {selectedClips.length === 1 ? 'corte revisable' : 'cortes revisables'}
              </button>
              <ol className="grid gap-1 text-xs text-slate-300 sm:grid-cols-2">
                {proposal.clips.map((cut, index) => (
                  <li key={clipKey(cut)} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2">
                    <label className="flex flex-1 items-center gap-2">
                      <input type="checkbox" aria-label={`Incluir región ${index + 1}`}
                        checked={!excludedCuts.has(clipKey(cut))}
                        onChange={event => {
                          const checked = event.currentTarget.checked;
                          setExcludedCuts(previous => {
                            const next = new Set(previous);
                            if (checked) next.delete(clipKey(cut));
                            else next.add(clipKey(cut));
                            return next;
                          });
                        }} />
                      Región {index + 1}: {cut.start.toFixed(2)}–{cut.end.toFixed(2)} s
                    </label>
                    {onPreview && (
                      <button type="button" onClick={() => onPreview(cut)}
                        aria-label={`Escuchar región ${index + 1}`}
                        className="rounded-md border border-cyan-300/30 px-3 py-1.5 text-cyan-100 hover:bg-cyan-500/15">
                        Escuchar
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {proposal.omittedCount > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              {proposal.omittedCount} regiones omitidas por duración, solapamientos o cuota.
            </p>
          )}
        </>
      )}
    </section>
  );
}
