import type { OpeningReview } from '@/lib/roleplay/bilingual-opening-review';

const criteria = [
  'Identificación profesional y presentación ante el médico en inglés.',
  'Presentación equivalente ante el paciente en español.',
  'Explicación del papel del intérprete, imparcialidad y confidencialidad.',
  'Indicación de cómo comunicarse durante la interpretación consecutiva.',
  'Claridad, registro profesional y coherencia entre ambas presentaciones.',
];

export function RoleplayOpeningReview({ opening }: { opening: OpeningReview }) {
  if (opening.state === 'not-required') return null;
  return (
    <section aria-labelledby="opening-review-heading" className="mb-6 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-4 sm:p-6">
      <div>
        <p className="text-xs font-semibold text-[var(--text-secondary)]">Antes de las intervenciones clínicas</p>
        <h2 id="opening-review-heading" className="mt-1 text-xl font-bold text-[var(--foreground)]">Protocolo de apertura bilingüe</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Revisa la presentación independiente del participante en inglés y español.</p>
      </div>
      {opening.state === 'unavailable' ? (
        <p role="alert" className="text-sm text-[var(--foreground)]">No se pudo consultar la apertura. Actualiza la página antes de evaluar.</p>
      ) : opening.state === 'pending' ? (
        <p role="status" className="text-sm text-[var(--foreground)]">Apertura requerida, pendiente de confirmación.</p>
      ) : opening.state === 'confirmed' ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--text-secondary)]">Grabación confirmada · {Math.floor(opening.durationSec / 60)}:{String(opening.durationSec % 60).padStart(2, '0')}</p>
          {opening.audioUrl ? <audio aria-label="Grabación de apertura bilingüe" className="w-full" controls preload="none" src={opening.audioUrl} /> :
            <p role="alert" className="text-sm text-[var(--foreground)]">La grabación está confirmada, pero la reproducción no está disponible. Actualiza la página para reintentar.</p>}
        </div>
      ) : null}
      <div className="space-y-2 rounded-xl border border-[var(--border)] p-4">
        <h3 className="font-semibold text-[var(--foreground)]">Criterios de revisión</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
          {criteria.map(criterion => <li key={criterion}>{criterion}</li>)}
        </ul>
        <p className="text-xs text-[var(--text-secondary)]">Guía para QA. No guarda una calificación independiente ni modifica los pesos de la evaluación actual.</p>
      </div>
    </section>
  );
}
