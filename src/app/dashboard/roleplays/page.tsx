'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, LoaderCircle, Mic2, RefreshCw } from 'lucide-react';

type RoleplaySession = {
  id: string;
  status: string;
  createdAt: string;
  submittedAt?: string | null;
  evaluatedAt?: string | null;
  qaScore?: {
    totalScore?: number | string | null;
    criticalError?: boolean | null;
    accionRequerida?: string | null;
  } | null;
};

type RoleplaysResponse = {
  success?: boolean;
  data?: RoleplaySession[];
  error?: string;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING: 'Pendiente',
  INVITED: 'Invitado',
  STARTED: 'Iniciado',
  IN_PROGRESS: 'En progreso',
  SUBMITTED: 'Enviado',
  UNDER_REVIEW: 'En revisión',
  EVALUATED: 'Evaluado',
  PASSED: 'Aprobado',
  FAILED: 'No aprobado',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function DashboardRoleplaysPage() {
  const [sessions, setSessions] = useState<RoleplaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/dashboard/roleplays', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as RoleplaysResponse | null;

      if (!response.ok || payload?.success !== true) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('No se pudo validar tu sesión. Inicia sesión nuevamente e inténtalo otra vez.');
        }
        throw new Error('No fue posible cargar tus roleplays en este momento.');
      }

      setSessions(Array.isArray(payload.data) ? payload.data : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ocurrió un error inesperado.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">Entrenamiento</p>
          <h1 className="mt-2 text-3xl font-black text-white">Mis Roleplays</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Consulta tus sesiones asignadas, continúa una sesión disponible y revisa las evaluaciones publicadas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSessions()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p>{error}</p>
            {(error.includes('sesión') || error.includes('sesion')) && (
              <Link className="font-bold underline underline-offset-4" href="/login">
                Ir al inicio de sesión
              </Link>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] text-slate-400">
          <LoaderCircle size={20} className="animate-spin" />
          Cargando tus roleplays…
        </div>
      ) : !error && sessions.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-12 text-center">
          <Mic2 size={32} className="mx-auto text-slate-500" />
          <h2 className="mt-4 text-lg font-bold text-white">No tienes roleplays asignados</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
            Cuando se te asigne una sesión de práctica, aparecerá aquí.
          </p>
        </div>
      ) : !error ? (
        <div className="grid gap-4">
          {sessions.map((session) => (
            <article key={session.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-white">Sesión de práctica</h2>
                    <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-semibold text-blue-200">
                      {STATUS_LABELS[session.status] || session.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">Creada: {formatDate(session.createdAt)}</p>
                  {session.submittedAt && (
                    <p className="mt-1 text-sm text-slate-400">Enviada: {formatDate(session.submittedAt)}</p>
                  )}
                  {session.evaluatedAt && (
                    <p className="mt-1 text-sm text-slate-400">Evaluada: {formatDate(session.evaluatedAt)}</p>
                  )}
                  {session.qaScore?.totalScore != null && (
                    <p className="mt-2 text-sm font-semibold text-slate-200">
                      Resultado QA: {String(session.qaScore.totalScore)}
                      {session.qaScore.criticalError ? ' · Error crítico registrado' : ''}
                    </p>
                  )}
                </div>
                <Link
                  href={`/roleplays/${encodeURIComponent(session.id)}`}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-500"
                >
                  Ver sesión <ArrowRight size={16} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
