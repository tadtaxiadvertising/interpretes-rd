'use client';

import { useRef, useState } from 'react';

const checks = [
  ['tableExists', 'Tabla de categorías'],
  ['columnsMatch', 'Estructura de columnas'],
  ['fingerprintPrimaryKey', 'Identificador único'],
  ['rlsEnabled', 'Seguridad por filas'],
  ['externalRolesPresent', 'Roles externos identificados'],
  ['externalAccessDenied', 'Acceso externo restringido'],
  ['serverDmlGranted', 'Permisos del servidor'],
] as const;
type Report = Record<(typeof checks)[number][0], boolean> & {
  metadataReady: boolean; featureFlagEnabled: boolean; rlsActiveForServer: boolean;
};

export default function RoleplayTopicsReadiness() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  async function check() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setReport(null);
    setError('');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/admin/roleplays/library/topics/readiness', {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok || body?.success !== true || !body.data ||
          !checks.every(([key]) => typeof body.data[key] === 'boolean') ||
          typeof body.data.metadataReady !== 'boolean' ||
          typeof body.data.featureFlagEnabled !== 'boolean' ||
          typeof body.data.rlsActiveForServer !== 'boolean') throw new Error();
      setReport(body.data);
    } catch {
      setError('No se pudo comprobar la configuración. Vuelve a intentarlo.');
    } finally {
      clearTimeout(timer);
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] p-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[var(--foreground)]">Diagnóstico de categorías permanentes</summary>
      <div className="space-y-3">
        <p className="text-xs text-[var(--text-secondary)]">Comprueba los permisos de la conexión actual del servidor, sin modificar la base de datos ni activar categorías.</p>
        <button type="button" disabled={busy} onClick={() => void check()}
          className="theme-action-secondary min-h-11 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy ? 'Comprobando…' : 'Comprobar configuración'}</button>
        {error && <p role="alert" className="text-sm text-[var(--theme-danger)]">{error}</p>}
        {report && <section aria-label="Resultado del diagnóstico" role="status" className="space-y-2 text-sm">
          <p className="font-semibold text-[var(--foreground)]">{report.metadataReady ? 'Metadatos compatibles' : 'Configuración pendiente'}</p>
          <p className="text-xs text-[var(--text-secondary)]">Funcionalidad {report.featureFlagEnabled ? 'habilitada' : 'deshabilitada'}.</p>
          <ul className="space-y-1">
            {checks.map(([key, label]) => <li key={key} className="flex flex-wrap justify-between gap-2">
              <span>{label}</span>
              <span className={report[key] ? 'text-[var(--theme-success)]' : 'text-[var(--theme-warning)]'}>{report[key] ? 'Correcto' : 'Pendiente'}</span>
            </li>)}
          </ul>
          {report.rlsActiveForServer && <p className="text-xs text-[var(--theme-warning)]">La seguridad por filas está activa para la conexión del servidor. Verifica las políticas en pruebas.</p>}
          <p className="text-xs text-[var(--text-secondary)]">Este diagnóstico no autoriza la activación. Aún se requiere comprobar el guardado y la seguridad en un entorno de pruebas.</p>
        </section>}
      </div>
    </details>
  );
}
