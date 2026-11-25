'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoleplayOpening } from './RoleplayOpening';
import { createClient as createSupabaseBrowserClient } from '@/lib/supabase/client';
import { isCanonicalBilingualOpeningPath, type BilingualOpeningState } from '@/lib/roleplay/bilingual-opening';

type Recovery = { state: BilingualOpeningState; reservation?: { path: string; expiresAt: string; retryAt: string | null } };
type Attempt = { path: string; token: string; blob: Blob; uploaded: boolean };

export function RoleplayOpeningFlow({ sessionId, onContinue }: { sessionId: string; onContinue: () => void | Promise<void> }) {
  const endpoint = '/api/roleplay/session/' + encodeURIComponent(sessionId) + '/opening';
  const [snapshot, setSnapshot] = useState<Recovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);

  const request = useCallback(async (command?: object, signal?: AbortSignal) => {
    const response = await fetch(endpoint, {
      cache: 'no-store', signal,
      ...(command ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) } : {}),
    });
    const result = await response.json();
    if (!response.ok || result.success !== true || !result.data) {
      throw new Error(response.status === 409
        ? 'Hay una grabación pendiente de verificar. Consulta su estado antes de reintentar.'
        : 'No se pudo completar la apertura. Comprueba tu conexión e inténtalo nuevamente.');
    }
    return result.data;
  }, [endpoint]);

  const recover = useCallback(async (signal?: AbortSignal): Promise<Recovery> => {
    const data = await request(undefined, signal);
    if (!['pending', 'confirmed', 'not-required'].includes(data.state)) throw new Error('Estado de apertura inválido.');
    if (data.reservation && (data.state !== 'pending' ||
        !isCanonicalBilingualOpeningPath(data.reservation.path, sessionId) ||
        !Number.isFinite(Date.parse(data.reservation.expiresAt)))) throw new Error('Reserva de apertura inválida.');
    if (!signal?.aborted) {
      setSnapshot(data);
      if (attempt.current && data.reservation?.path !== attempt.current.path) attempt.current = null;
      if (data.state === 'confirmed' || data.state === 'not-required') await onContinue();
    }
    return data;
  }, [request, sessionId, onContinue]);

  useEffect(() => {
    const controller = new AbortController();
    void recover(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError('No se pudo consultar la apertura. Reintenta para continuar.');
    });
    return () => controller.abort();
  }, [recover]);

  const confirm = async (path: string) => {
    const data = await request({ action: 'confirm', path });
    if (data.state !== 'confirmed') throw new Error('La apertura aún no está confirmada.');
    attempt.current = null;
    await onContinue();
  };

  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) throw new Error('Ya se está procesando la grabación.');
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch {
      // A lost response may follow a successful server commit. Read the
      // authoritative state before asking the participant to repeat anything.
      try {
        const state = await recover();
        if (state.state === 'confirmed' || state.state === 'not-required') return;
      } catch { /* Keep the current recording available for retry. */ }
      const message = 'No se pudo confirmar la apertura. Conserva tu grabación y consulta el estado antes de reintentar.';
      setError(message);
      throw new Error(message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const save = async (_url: string, _duration: number, blob: Blob) => run(async () => {
    if (attempt.current && attempt.current.blob !== blob) {
      throw new Error('Primero recupera la grabación pendiente.');
    }
    if (!attempt.current) {
      const data = await request({ action: 'authorize', mimeType: blob.type || 'audio/webm', size: blob.size });
      if (typeof data.token !== 'string' || !data.token ||
          !isCanonicalBilingualOpeningPath(data.path, sessionId)) throw new Error('Autorización inválida.');
      attempt.current = { path: data.path, token: data.token, blob, uploaded: false };
    }
    const current = attempt.current;
    if (!current.uploaded) {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) throw new Error('Almacenamiento no disponible.');
      const { error: uploadError } = await supabase.storage.from('roleplay-audio')
        .uploadToSignedUrl(current.path, current.token, current.blob,
          { contentType: current.blob.type || 'audio/webm', upsert: false });
      if (uploadError) {
        // The upload may have succeeded despite an ambiguous response.
        // Confirm only the reserved immutable key, never a replacement.
        await confirm(current.path);
        return;
      }
      current.uploaded = true;
    }
    await confirm(current.path);
  });

  const refresh = () => { void run(async () => { await recover(); }).catch(() => {}); };
  const pendingPath = snapshot?.reservation?.path;
  const retry = () => {
    if (pendingPath) void run(() => confirm(pendingPath)).catch(() => {});
  };
  const buttonClass = 'rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50';

  return (
    <section className="space-y-4" aria-label="Apertura del roleplay">
      {!snapshot && !error && <p role="status" className="text-sm text-[var(--text-secondary)]">Consultando el protocolo de apertura…</p>}
      {busy && <p role="status" className="text-sm text-[var(--text-secondary)]">Procesando la apertura. No cierres esta pantalla.</p>}
      {error && <p role="alert" className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--theme-warning)]">{error}</p>}
      {snapshot?.state === 'pending' && (!pendingPath || attempt.current) && (
        <RoleplayOpening onSave={save} isLoading={busy} />
      )}
      {snapshot?.state === 'pending' && pendingPath && (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] p-4">
          <h3 className="font-semibold text-[var(--foreground)]">Grabación pendiente de confirmar</h3>
          <p className="text-sm text-[var(--text-secondary)]">Si ya subiste el audio, recupera la confirmación sin grabar otra vez. Si la subida quedó incompleta, podrás iniciar una nueva cuando caduque la reserva.</p>
          {snapshot.reservation?.retryAt && <p className="text-xs text-[var(--text-secondary)]">Hay una verificación reciente. Consulta el estado antes de reintentar.</p>}
          <button type="button" className={buttonClass} disabled={busy} onClick={retry}>Reintentar confirmación</button>
        </div>
      )}
      {(error || pendingPath || snapshot?.state === 'confirmed' || snapshot?.state === 'not-required') && <button type="button" className={buttonClass} disabled={busy} onClick={refresh}>Consultar estado</button>}
    </section>
  );
}
