'use client';

import { useState } from 'react';
import { addEmailProviderProfile, listEmailProviderProfiles, testSavedEmailProvider } from '@/app/actions/email-provider-vault';
import type { ProfileMetadata } from '@/lib/email/provider-vault';

import type { ProviderQuota } from '@/lib/email/provider-quota';

const statusText: Record<string, string> = {
  local_quota_reached: 'Presupuesto local agotado. No se inició el envío.',
  ready: 'Almacén disponible.', disabled: 'Almacén desactivado o controles de prueba no habilitados.',
  key_missing: 'Configura la clave de cifrado privada del almacén.',
  unauthorized: 'Se requiere una sesión administrativa.', unavailable: 'Almacén no disponible. Revisa instalación y permisos.',
  saved: 'Perfil guardado. No se activó para envíos.', invalid: 'Revisa los campos o la clave de cifrado.',
  accepted: 'Proveedor aceptó la prueba. Comprueba el buzón.', rate_limited: 'Espera antes de realizar otra prueba.',
  brevo_auth: 'Brevo rechazó la autenticación.', resend_auth: 'Resend rechazó la autenticación.',
  brevo_forbidden: 'Brevo denegó el acceso.', resend_forbidden: 'Resend denegó el acceso.',
  brevo_rate_limited: 'Brevo limitó las solicitudes.', resend_quota: 'Resend limitó las solicitudes.',
};
const messageFor = (status: string) => statusText[status] ?? 'Aceptación no confirmada. Revisa el proveedor y el buzón antes de repetir.';

export default function EmailProviderVault() {
  const [profiles, setProfiles] = useState<ProfileMetadata[]>([]);
  const [quotas, setQuotas] = useState<ProviderQuota[]>([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function load() {
    const result = await listEmailProviderProfiles();
    setProfiles(result.profiles);
    setQuotas(result.quotas ?? []);
    setReady(result.status === 'ready');
    setMessage(messageFor(result.status));
  }
  async function run(task: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    try { await task(); } catch { setMessage(messageFor('unavailable')); } finally { setPending(false); }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3 text-sm text-[var(--foreground)]" aria-labelledby="provider-vault-title">
      <h3 id="provider-vault-title" className="font-semibold">Perfiles de proveedores guardados</h3>
      <p>Guarda claves de Brevo y Resend cifradas. Los perfiles no modifican el proveedor activo. No se muestran claves guardadas.</p>
      <button type="button" disabled={pending} onClick={() => run(load)} className="rounded-lg border border-[var(--border)] px-3 py-2">Consultar perfiles</button>
      {ready && (
        <form className="space-y-2" autoComplete="off" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const input = { name: data.get('name'), provider: data.get('provider'), from: data.get('from'), replyTo: data.get('replyTo'), apiKey: data.get('apiKey') };
          form.reset();
          void run(async () => {
            const status = await addEmailProviderProfile(input);
            if (status === 'saved') await load();
            setMessage(messageFor(status));
          });
        }}>
          <fieldset disabled={pending} className="space-y-2">
            <label className="block">Nombre<input name="name" required maxLength={80} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
            <label className="block">Proveedor<select name="provider" className="block w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-2"><option value="brevo">Brevo</option><option value="resend">Resend</option></select></label>
            <label className="block">Remitente autorizado<input name="from" type="email" required maxLength={254} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
            <label className="block">Responder a (opcional)<input name="replyTo" type="email" maxLength={254} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
            <label className="block">Clave API<input name="apiKey" type="password" autoComplete="new-password" required maxLength={512} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
            <button type="submit" className="rounded-lg bg-blue-700 text-white px-3 py-2 font-semibold">Guardar perfil</button>
          </fieldset>
        </form>
      )}
      {quotas.map(quota => (
        <div key={quota.provider} className="rounded-lg border border-[var(--border)] p-3 space-y-1">
          <p className="font-semibold">{quota.provider === 'brevo' ? 'Brevo' : 'Resend'} · presupuesto local (UTC)</p>
          <p>Hoy: {quota.dailyUsed} de {quota.dailyLimit} intentos</p>
          <progress aria-label={'Consumo diario ' + quota.provider} value={Math.min(quota.dailyUsed, quota.dailyLimit)} max={quota.dailyLimit} className="w-full" />
          <p>Mes: {quota.monthlyUsed} de {quota.monthlyLimit} intentos</p>
          <progress aria-label={'Consumo mensual ' + quota.provider} value={Math.min(quota.monthlyUsed, quota.monthlyLimit)} max={quota.monthlyLimit} className="w-full" />
          <p className="text-xs">No incluye envíos externos ni los del proveedor configurado en variables de entorno. Consulta su saldo real.</p>
        </div>
      ))}
      {profiles.map(profile => (
        <div key={profile.id} className="rounded-lg border border-[var(--border)] p-3 space-y-1 break-words">
          <p className="font-semibold">{profile.name} · {profile.provider}</p>
          <p>{profile.from}</p>
          <button type="button" disabled={pending} onClick={() => run(async () => { const status = await testSavedEmailProvider(profile.id); await load(); setMessage(messageFor(status)); })} className="rounded-lg border border-[var(--border)] px-3 py-2">Enviar prueba a este remitente</button>
        </div>
      ))}
      <p role="status" aria-live="polite">{message}</p>
      <p>La prueba requiere desactivar todos los controles de despacho. La frecuencia de prueba se limita por proceso; el presupuesto es persistente y compartido. No reintentes envíos inciertos.</p>
    </section>
  );
}
