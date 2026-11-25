'use client';

import { Recorder } from './Recorder';
import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';

interface RoleplayOpeningProps {
  /** Parent must resolve only after independent server confirmation. */
  onSave: (audioUrl: string, durationSec: number, blob: Blob) => Promise<void>;
  isLoading?: boolean;
}

/** Prepared for the dedicated opening step; not mounted until server gates exist. */
export function RoleplayOpening({ onSave, isLoading }: RoleplayOpeningProps) {
  return (
    <section aria-labelledby="roleplay-opening-title" className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-4 sm:p-6">
        <p className="text-xs font-semibold text-[var(--text-secondary)]">Antes de la conversación</p>
        <h2 id="roleplay-opening-title" className="mt-1 text-xl font-bold text-[var(--foreground)]">
          Protocolo de apertura bilingüe
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Graba tu presentación profesional para ambas partes, primero en inglés y después en español,
          en una sola grabación. Luego comenzará la conversación.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--foreground)]">
            <strong>1. English</strong><p className="mt-1 text-[var(--text-secondary)]">Address the healthcare professional.</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--foreground)]">
            <strong>2. Español</strong><p className="mt-1 text-[var(--text-secondary)]">Dirígete al paciente.</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--text-secondary)]">Esta grabación es independiente de tus interpretaciones posteriores.</p>
      </div>
      <Recorder durationLimitSec={ROLEPLAY_RESPONSE_MAX_DURATION_SEC} onSave={onSave} isLoading={isLoading} />
    </section>
  );
}
