'use client';

import { useRef, useState } from 'react';
import { checkProviderVaultReadiness } from '@/app/actions/email-provider-readiness';
import type { VaultReadiness } from '@/lib/email/provider-readiness';

const dbMessages = {
  ready: 'Instalación, aislamiento y permisos del servidor comprobados.',
  not_installed: 'Falta la instalación completa del centro de proveedores.',
  permission_mismatch: 'Revisa RLS, permisos y rol de conexión del servidor. No otorgues acceso a los roles de la API.',
  unavailable: 'No se pudo comprobar la base de datos.',
  unauthorized: 'Se requiere una sesión administrativa.',
} as const;
const encryptionMessages = {
  missing: 'Falta EMAIL_PROVIDER_ENCRYPTION_KEY en el frontend.',
  invalid: 'EMAIL_PROVIDER_ENCRYPTION_KEY debe tener 64 caracteres hexadecimales, sin comillas ni espacios.',
  valid_format: 'Formato válido. No demuestra que pueda descifrar perfiles existentes.',
} as const;

export default function EmailProviderReadiness() {
  const [report, setReport] = useState<VaultReadiness | { database: 'unauthorized' | 'unavailable' } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function check() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try { setReport(await checkProviderVaultReadiness()); }
    catch { setReport({ database: 'unavailable' }); }
    finally { busy.current = false; setPending(false); }
  }
  return (
    <section aria-labelledby="provider-readiness" className="space-y-3 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--foreground)]">
      <h3 id="provider-readiness" className="font-semibold">Preparación del centro de proveedores</h3>
      <p>Comprueba la instalación y configuración del frontend sin enviar correos ni leer credenciales guardadas. Disponible incluso si el almacén está desactivado.</p>
      <button type="button" disabled={pending} onClick={check} className="rounded-lg border border-[var(--border)] px-3 py-2 font-semibold text-[var(--theme-link)] disabled:opacity-50">{pending ? 'Comprobando…' : 'Comprobar preparación del almacén'}</button>
      <div role="status" aria-live="polite" className="space-y-2">
        {report && <p>{dbMessages[report.database]}</p>}
        {report && 'enabled' in report && (
          <dl className="space-y-2">
            <div><dt className="font-medium">Almacén</dt><dd>{report.enabled ? 'Habilitado' : 'Desactivado: configura EMAIL_PROVIDER_VAULT_ENABLED=true.'}</dd></div>
            <div><dt className="font-medium">Cifrado</dt><dd>{encryptionMessages[report.encryption]}</dd></div>
            <div><dt className="font-medium">Origen del transporte</dt><dd>{report.source === 'vault' ? 'Perfil preferido (solo piloto)' : report.source === 'environment' ? 'Variables de entorno' : 'Valor no reconocido: revisa EMAIL_PROVIDER_SOURCE.'}</dd></div>
            <div><dt className="font-medium">Pruebas y cambios de perfiles</dt><dd>{report.paused ? 'Controles de despacho pausados.' : 'Requiere correo habilitado y los cinco controles de despacho explícitamente desactivados.'}</dd></div>
          </dl>
        )}
      </div>
      <p>Conserva la clave de cifrado existente si ya hay perfiles. La preparación no confirma autenticación externa ni entrega. No cambies Supabase Auth para habilitar el almacén.</p>
    </section>
  );
}
