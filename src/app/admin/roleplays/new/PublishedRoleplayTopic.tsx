'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { StudioTopicSelection } from '@/lib/roleplay-studio/assignment-handoff';

export default function PublishedRoleplayTopic({ sessionId, selection }: {
  sessionId: string;
  selection: StudioTopicSelection;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'saving' | 'saved' | 'conflict' | 'retry'>('saving');
  const { topic, subtopic } = selection;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setStatus('saving');
    const timeout = setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try {
        const response = await fetch('/api/admin/roleplays/library/topics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, topic, subtopic }),
          signal: controller.signal,
        });
        if (response.status === 409) {
          if (active) setStatus('conflict');
          return;
        }
        const result: unknown = await response.json();
        if (!response.ok || !result || typeof result !== 'object' ||
            !('success' in result) || result.success !== true) throw new Error('Topic not confirmed');
        if (active) setStatus('saved');
      } catch {
        if (active) setStatus('retry');
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [sessionId, topic, subtopic, attempt]);

  return (
    <section aria-label="Clasificación del roleplay publicado" className="mb-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3 text-left">
      <p role="status" className="text-sm text-[var(--foreground)]">
        {status === 'saving' ? 'Guardando tema en la biblioteca…' :
          status === 'saved' ? 'Tema y subtema guardados en la biblioteca.' :
          status === 'conflict' ? 'No se cambió la clasificación existente o la plantilla aún no está disponible. Revísala en la biblioteca.' :
          'El roleplay está creado. No se pudo confirmar la clasificación.'}
      </p>
      {status === 'retry' && <button type="button" onClick={() => { setStatus('saving'); setAttempt(value => value + 1); }}
        className="theme-action-secondary min-h-11 rounded-lg px-3 py-2 text-sm font-semibold">Reintentar solo clasificación</button>}
      <Link href="/admin/roleplays/library" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--theme-link)] underline">Abrir biblioteca</Link>
    </section>
  );
}
