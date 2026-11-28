'use client';

import { ROLEPLAY_TOPICS } from '@/lib/roleplay-library-topics';
import type { StudioTopicSelection } from '@/lib/roleplay-studio/assignment-handoff';

export default function StudioTopicPicker({ value, onChange, disabled }: {
  value: StudioTopicSelection;
  onChange: (selection: StudioTopicSelection) => void;
  disabled?: boolean;
}) {
  const parent = ROLEPLAY_TOPICS.find(topic => topic.id === value.topic);
  return (
    <fieldset disabled={disabled} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3">
      <legend className="px-1 text-sm font-semibold text-[var(--foreground)]">Tema del roleplay (opcional)</legend>
      <p className="text-xs text-[var(--text-secondary)]">La selección acompaña al paquete al continuar en esta pestaña. Todavía no se guarda en la biblioteca ni en archivos descargados.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm text-[var(--foreground)]">Tema principal
          <select value={value.topic} onChange={event => onChange({ topic: event.target.value, subtopic: '' })}
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 text-sm text-[var(--theme-control-text)]">
            <option value="">Sin seleccionar</option>
            {ROLEPLAY_TOPICS.map(topic => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
          </select>
        </label>
        <label className="text-sm text-[var(--foreground)]">Subtema
          <select value={value.subtopic} disabled={!parent || disabled} onChange={event => onChange({ topic: value.topic, subtopic: event.target.value })}
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 text-sm text-[var(--theme-control-text)]">
            <option value="">Selecciona un subtema</option>
            {parent?.subtopics.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      {parent && !value.subtopic && <p className="text-xs text-[var(--theme-warning)]">Elige un subtema para transferir esta clasificación.</p>}
    </fieldset>
  );
}
