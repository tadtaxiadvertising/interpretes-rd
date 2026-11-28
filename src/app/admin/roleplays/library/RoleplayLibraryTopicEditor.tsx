'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLEPLAY_TOPICS, parseEditorialRoleplayTopic } from '@/lib/roleplay-library-topics';

export function RoleplayLibraryTopicEditor({ fingerprint, sourceSessionId, selection }: {
  fingerprint: string;
  sourceSessionId: string;
  selection: { topic: string; subtopic: string } | null;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState(selection?.topic ?? '');
  const [subtopic, setSubtopic] = useState(selection?.subtopic ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(selection);
  const parent = ROLEPLAY_TOPICS.find(item => item.id === topic);
  const valid = parseEditorialRoleplayTopic(topic, subtopic);
  const changed = topic !== (saved?.topic ?? '') || subtopic !== (saved?.subtopic ?? '');

  async function save() {
    if (saving || !changed || (!valid && topic !== '')) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/roleplays/library/' + encodeURIComponent(fingerprint), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceSessionId, topic, subtopic }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error('No se pudo guardar el tema.');
      setSaved(valid);
      setMessage(valid ? 'Clasificación guardada.' : 'Se restauraron las sugerencias automáticas.');
      router.refresh();
    } catch {
      setMessage('No se pudo guardar el tema. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="mt-3 w-full rounded-xl border border-[var(--border)] p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold text-[var(--theme-link)]">Clasificar tema</summary>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-[var(--text-secondary)]">Tema
          <select value={topic} disabled={saving} onChange={event => { setTopic(event.target.value); setSubtopic(''); setMessage(''); }}
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 text-sm text-[var(--theme-control-text)]">
            <option value="">Sugerencias automáticas</option>
            {ROLEPLAY_TOPICS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--text-secondary)]">Subtema
          <select value={subtopic} disabled={!parent || saving} onChange={event => { setSubtopic(event.target.value); setMessage(''); }}
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 text-sm text-[var(--theme-control-text)]">
            <option value="">Selecciona un subtema</option>
            {parent?.subtopics.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <button type="button" disabled={saving || !changed || Boolean(topic && !valid)} onClick={() => void save()}
        className="theme-action-primary mt-2 min-h-11 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">
        {saving ? 'Guardando…' : 'Guardar clasificación'}
      </button>
      <p role="status" className="mt-1 text-xs text-[var(--text-secondary)]">{message}</p>
    </details>
  );
}
