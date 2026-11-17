'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldAlert } from 'lucide-react';

const SCHEMA_CHECKS = [
  ['accountHolderName', 'Titular de cuenta operativa'],
  ['roleplayBaseAudioPath', 'Audio base de Roleplay'],
  ['responseSourceAudioPath', 'Audio de respuestas'],
  ['audioJobSourcePath', 'Trabajos de conversión de audio'],
  ['libraryArchiveTable', 'Archivo de biblioteca'],
  ['roleplayStudioColumns', 'Metadatos de Audio Studio'],
  ['roleplayStudioConstraints', 'Restricciones de Audio Studio'],
] as const;

type ReadinessStatus = 'idle' | 'checking' | 'ready' | 'schema_mismatch' | 'unauthorized' | 'rate_limited' | 'unavailable';
type SchemaKey = (typeof SCHEMA_CHECKS)[number][0];
type SchemaState = Partial<Record<SchemaKey, boolean>>;
type ReadinessReport = { status: ReadinessStatus; schema: SchemaState | null };

function parseSchema(value: unknown): SchemaState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const schema: SchemaState = {};
  for (const [key] of SCHEMA_CHECKS) {
    if (typeof record[key] === 'boolean') schema[key] = record[key];
  }
  return Object.keys(schema).length ? schema : null;
}

function interpretReadiness(statusCode: number, ok: boolean, value: unknown): ReadinessReport {
  if (statusCode === 401 || statusCode === 403) return { status: 'unauthorized', schema: null };
  if (statusCode === 429) return { status: 'rate_limited', schema: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'unavailable', schema: null };
  }
  const response = value as Record<string, unknown>;
  if (ok && response.status === 'ready') {
    return { status: 'ready', schema: parseSchema(response.schema) };
  }
  if (response.status === 'schema_mismatch') {
    return { status: 'schema_mismatch', schema: parseSchema(response.schema) };
  }
  return { status: 'unavailable', schema: null };
}

/** Explicit, read-only probe. Never claims TLS, runtime health or migration history. */
export default function SystemReadinessCheck() {
  const [report, setReport] = useState<ReadinessReport>({ status: 'idle', schema: null });
  const [showDetails, setShowDetails] = useState(false);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  async function check() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setReport({ status: 'checking', schema: null });
    setShowDetails(false);

    try {
      const response = await fetch('/api/admin/system-readiness', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!controller.signal.aborted) {
        setReport(interpretReadiness(response.status, response.ok, payload));
      }
    } catch {
      if (!controller.signal.aborted) {
        setReport({ status: 'unavailable', schema: null });
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }

  const { status, schema } = report;
  const messages: Record<ReadinessStatus, string> = {
    idle: 'Sin comprobar. No se ha consultado la base de datos desde esta pantalla.',
    checking: 'Comprobando conexión y esquema...',
    ready: 'La base de datos respondió y las comprobaciones de esquema fueron satisfactorias.',
    schema_mismatch: 'La base de datos respondió, pero faltan elementos del esquema esperado.',
    unauthorized: 'No se pudo autorizar la consulta. Vuelve a iniciar sesión como administrador.',
    rate_limited: 'Demasiadas solicitudes. Vuelve a intentarlo más adelante.',
    unavailable: 'No se pudo confirmar el estado de la base de datos. Consulta los registros del servidor.',
  };
  const healthy = status === 'ready';
  const failed = status === 'schema_mismatch' || status === 'unavailable' || status === 'unauthorized';
  const checking = status === 'checking';

  return (
    <section aria-label="Estado real de la base de datos" className="glass rounded-3xl border border-white/10 p-6 md:p-8 space-y-5">
      <div className="flex items-center gap-3">
        <Database className="text-blue-400 shrink-0" size={23} aria-hidden="true" />
        <div>
          <h2 className="text-xl font-bold text-white">Conexión y esquema</h2>
          <p className="text-sm text-gray-400">Diagnóstico de lectura disponible solo para administradores.</p>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-start gap-3">
        {healthy ? <CheckCircle2 className="text-green-400 shrink-0" aria-hidden="true" /> :
          failed ? <AlertTriangle className="text-amber-400 shrink-0" aria-hidden="true" /> :
            <ShieldAlert className="text-gray-400 shrink-0" aria-hidden="true" />}
        <p role="status" aria-live="polite" className="text-sm text-gray-200">{messages[status]}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={checking}
          onClick={check}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 disabled:cursor-wait"
        >
          <RefreshCw size={16} className={checking ? 'animate-spin' : ''} aria-hidden="true" />
          {checking ? 'Verificando...' : 'Verificar conexión y esquema'}
        </button>
        {schema && (
          <button
            type="button"
            aria-expanded={showDetails}
            onClick={() => setShowDetails(value => !value)}
            className="rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-gray-200 hover:bg-white/10"
          >
            {showDetails ? 'Ocultar detalles' : 'Ver detalles del esquema'}
          </button>
        )}
      </div>
      {schema && showDetails && (
        <ul className="space-y-2" aria-label="Comprobaciones de esquema">
          {SCHEMA_CHECKS.map(([key, label]) => (
            <li key={key} className="flex justify-between gap-3 border-b border-white/5 py-2 text-sm">
              <span className="text-gray-300">{label}</span>
              <span className={schema[key] === true ? 'text-green-400' : schema[key] === false ? 'text-amber-400' : 'text-gray-400'}>
                {schema[key] === true ? 'Correcto' : schema[key] === false ? 'Pendiente' : 'No informado'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-relaxed text-gray-400">
        Esta consulta solo comprueba la disponibilidad de la base de datos y elementos del esquema.
        No verifica certificados TLS, historial completo de migraciones, estado del contenedor ni despliegue de Easypanel.
        No modifica registros ni permite gestionar secretos.
      </p>
    </section>
  );
}
