'use client';

import { useState } from 'react';
import { importConfiguredEmailProvider, addEmailProviderProfile, listEmailProviderProfiles, testSavedEmailProvider, confirmSavedProviderReceipt, setPreferredEmailProvider, saveEmailProviderBudget, retireSavedEmailProvider, replaceSavedEmailProvider } from '@/app/actions/email-provider-vault';
import { providerCatalog, type ProviderId } from '@/lib/email/provider-catalog';
import type { ProfileMetadata } from '@/lib/email/provider-vault';

import type { ProviderQuota } from '@/lib/email/provider-quota';

const statusText: Record<string, string> = {
  imported: 'Configuración existente copiada al almacén. Falta probar y confirmar recepción. No se cambió el transporte activo.',
  already_saved: 'Ya existe un perfil activo de este proveedor y remitente. No se sobrescribieron credenciales.',
  blocked: 'Importación no permitida: comprueba la pausa y la configuración privada.',
  profile_test_blocked: 'No se inició la prueba: perfil desactivado o presupuesto agotado.',
  profile_retired: 'Perfil desactivado. El consumo y el historial se conservan.',
  profile_replaced: 'Nueva configuración guardada. Repite la prueba y confirma la recepción antes de seleccionarla.',
  budget_saved: 'Presupuesto guardado. El consumo acumulado no ha cambiado.',
  budget_invalid: 'Introduce límites enteros dentro de los máximos permitidos.',
  accepted_evidence_missing: 'El proveedor aceptó la prueba, pero no se pudo guardar la evidencia. Revisa el buzón y el almacén; no repitas automáticamente.',
  receipt_confirmed: 'Recepción confirmada por el administrador.',
  preferred_saved: 'Proveedor preferido guardado. No se activaron envíos automáticos.',
  preference_cleared: 'Preferencia eliminada.',
  selection_blocked: 'No se puede guardar: requiere aceptación, recepción confirmada y presupuesto disponible para seleccionar.',
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
  const [environmentImport, setEnvironmentImport] = useState<{ provider: 'brevo' | 'resend'; from: string } | undefined>();
  const [confirmImport, setConfirmImport] = useState(false);
  const [choice, setChoice] = useState<ProviderId>('brevo');
  const [profiles, setProfiles] = useState<(ProfileMetadata & { testAcceptedAt: string | null; receiptConfirmedAt: string | null; retiredAt: string | null })[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [selectionPaused, setSelectionPaused] = useState(false);
  const [preferenceEditable, setPreferenceEditable] = useState(false);
  const [quotas, setQuotas] = useState<ProviderQuota[]>([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function load() {
    const result = await listEmailProviderProfiles();
    setProfiles(result.profiles);
    setEnvironmentImport(result.environmentImport);
    setConfirmImport(false);
    setPreferredId(result.preferredId ?? null);
    setSelectionPaused(result.selectionPaused === true);
    setPreferenceEditable(result.preferenceEditable === true);
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
      <p>Guarda las credenciales cifradas de tus proveedores. Puedes guardar una preferencia verificada. Con el origen vault, la preferencia se utiliza en el piloto controlado. No se muestran claves guardadas.</p>
      <button type="button" disabled={pending} onClick={() => run(load)} className="rounded-lg border border-[var(--border)] px-3 py-2">Consultar perfiles</button>
      {ready && environmentImport && (
        <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
          <p className="font-semibold">Aprovechar configuración existente</p>
          <p>{providerCatalog[environmentImport.provider].label} · {environmentImport.from}</p>
          <p>Copia la configuración del servidor de forma cifrada sin volver a introducir la clave. No cambia el proveedor activo ni envía mensajes.</p>
          {!confirmImport ? <button type="button" disabled={pending} onClick={() => setConfirmImport(true)} className="rounded-lg border border-[var(--border)] px-3 py-2">Importar configuración existente</button> : <div className="flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => run(async () => { const status = await importConfiguredEmailProvider(); await load(); setMessage(messageFor(status)); })} className="rounded-lg bg-blue-700 text-white px-3 py-2">Confirmar copia cifrada</button><button type="button" disabled={pending} onClick={() => setConfirmImport(false)} className="underline">Cancelar</button></div>}
        </div>
      )}
      {ready && (
        <form className="space-y-2" autoComplete="off" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const input = { name: data.get('name'), provider: data.get('provider'), from: data.get('from'), replyTo: data.get('replyTo'), apiKey: data.get('apiKey'), secretKey: data.get('secretKey') };
          form.reset();
          void run(async () => {
            const status = await addEmailProviderProfile(input);
            if (status === 'saved') await load();
            setMessage(messageFor(status));
          });
        }}>
          <fieldset disabled={pending} className="space-y-2">
            <label className="block">Nombre<input name="name" required maxLength={80} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
            <label className="block">Proveedor<select name="provider" value={choice} onChange={event => setChoice(event.target.value as ProviderId)} className="block w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">{quotas.map(q => <option key={q.provider} value={q.provider}>{providerCatalog[q.provider].label}</option>)}</select></label>
            <label className="block">Remitente autorizado<input name="from" type="email" required maxLength={254} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
            <label className="block">Responder a (opcional)<input name="replyTo" type="email" maxLength={254} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
            <div className="flex flex-wrap gap-3"><a href={providerCatalog[choice].registration} target="_blank" rel="noopener noreferrer" className="underline">Abrir cuenta</a><a href={providerCatalog[choice].credentials} target="_blank" rel="noopener noreferrer" className="underline">Obtener credenciales</a><a href={providerCatalog[choice].sender} target="_blank" rel="noopener noreferrer" className="underline">Autorizar remitente</a></div>
            <label className="block">{providerCatalog[choice].primaryLabel}<input key={choice + '-primary'} name="apiKey" type="password" autoComplete="new-password" required maxLength={providerCatalog[choice].mode === 'smtp' ? 200 : 512} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
            {providerCatalog[choice].mode === 'smtp' && <label className="block">{providerCatalog[choice].secondaryLabel}<input key={choice + '-secondary'} name="secretKey" type="password" autoComplete="new-password" required maxLength={200} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>}
            <button type="submit" className="rounded-lg bg-blue-700 text-white px-3 py-2 font-semibold">Guardar perfil</button>
          </fieldset>
        </form>
      )}
      {quotas.map(quota => (
        <div key={quota.provider} className="rounded-lg border border-[var(--border)] p-3 space-y-1">
          <p className="font-semibold">{providerCatalog[quota.provider].label} · presupuesto local (UTC)</p>
          <p>Hoy: {quota.dailyUsed} de {quota.dailyLimit} intentos</p>
          <progress aria-label={'Consumo diario ' + quota.provider} value={Math.min(quota.dailyUsed, quota.dailyLimit)} max={quota.dailyLimit} className="w-full" />
          <p>Mes: {quota.monthlyUsed} de {quota.monthlyLimit} intentos</p>
          <progress aria-label={'Consumo mensual ' + quota.provider} value={Math.min(quota.monthlyUsed, quota.monthlyLimit)} max={quota.monthlyLimit} className="w-full" />
          <p className="text-xs">No incluye envíos externos ni los del proveedor configurado en variables de entorno. Consulta su saldo real.</p>
          <form key={quota.provider + ':' + quota.dailyLimit + ':' + quota.monthlyLimit} className="space-y-2" onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void run(async () => {
              const status = await saveEmailProviderBudget({ provider: quota.provider, dailyLimit: Number(data.get('daily')), monthlyLimit: Number(data.get('monthly')) });
              await load();
              setMessage(messageFor(status));
            });
          }}>
            <fieldset disabled={pending || !selectionPaused} className="space-y-2">
              <legend className="font-medium">Ajustar presupuesto local</legend>
              <label className="block">Máximo diario<input name="daily" type="number" min={1} max={providerCatalog[quota.provider].daily} step={1} required defaultValue={quota.dailyLimit} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
              <label className="block">Máximo mensual<input name="monthly" type="number" min={1} max={providerCatalog[quota.provider].monthly} step={1} required defaultValue={quota.monthlyLimit} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
              <button type="submit" className="rounded-lg border border-[var(--border)] px-3 py-2">Guardar presupuesto</button>
            </fieldset>
            <p className="text-xs">Pausa el despacho para editar. El cambio no reinicia el consumo, no cambia tu plan ni garantiza envíos gratuitos. Configura un límite inferior al saldo de tu cuenta real.</p>
          </form>
        </div>
      ))}
      {ready && <p>Proveedor preferido: {profiles.find(profile => profile.id === preferredId)?.name ?? (preferredId ? 'Perfil seleccionado' : 'Ninguno')}. No activa por sí sola los envíos automáticos.</p>}
      {ready && <p className="text-xs">{preferenceEditable ? 'Puedes elegir un perfil con recepción confirmada. La pausa se conserva.' : 'Para cambiar de proveedor, pausa el despacho del almacén y vuelve a consultar perfiles. Las pruebas y otras modificaciones mantienen sus requisitos de seguridad.'}</p>}
      {preferredId && <button type="button" disabled={pending || !preferenceEditable} onClick={() => run(async () => { const status = await setPreferredEmailProvider(null); await load(); setMessage(messageFor(status)); })} className="rounded-lg border border-[var(--border)] px-3 py-2">Quitar preferencia</button>}
      {profiles.map(profile => (
        <div key={profile.id} className="rounded-lg border border-[var(--border)] p-3 space-y-1 break-words">
          <p className="font-semibold">{profile.name} · {profile.provider}</p>
          <p>{profile.from}</p>
          <p>{profile.retiredAt ? 'Desactivado (histórico)' : profile.receiptConfirmedAt ? 'Recepción confirmada' : profile.testAcceptedAt ? 'Aceptado; falta verificar el buzón' : 'Sin prueba aceptada'}</p>
          {!profile.retiredAt && preferredId === profile.id && <p className="font-semibold">Proveedor preferido</p>}
          {!profile.retiredAt && <>
          <button type="button" disabled={pending || !selectionPaused} onClick={() => run(async () => { const status = await testSavedEmailProvider(profile.id); await load(); setMessage(messageFor(status)); })} className="rounded-lg border border-[var(--border)] px-3 py-2">Enviar prueba a este remitente</button>
          {profile.testAcceptedAt && !profile.receiptConfirmedAt && (
            <button type="button" disabled={pending || !selectionPaused} onClick={() => run(async () => { const status = await confirmSavedProviderReceipt(profile.id); await load(); setMessage(messageFor(status)); })} className="block rounded-lg border border-[var(--border)] px-3 py-2">Confirmo que recibí el correo de prueba</button>
          )}
          {profile.receiptConfirmedAt && preferredId !== profile.id && (
            <button type="button" disabled={pending || !selectionPaused} onClick={() => run(async () => { const status = await setPreferredEmailProvider(profile.id); await load(); setMessage(messageFor(status)); })} className="block rounded-lg border border-[var(--border)] px-3 py-2">Elegir como proveedor preferido</button>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || !selectionPaused} onClick={() => { setEditingId(profile.id); setRetiringId(null); }} className="rounded-lg border border-[var(--border)] px-3 py-2">Editar configuración / clave</button>
            <button type="button" disabled={pending || !selectionPaused} onClick={() => { setRetiringId(profile.id); setEditingId(null); }} className="rounded-lg border border-[var(--border)] px-3 py-2">Desactivar perfil</button>
          </div>
          {editingId === profile.id && (
            <form className="space-y-2 border-t border-[var(--border)] pt-3" autoComplete="off" onSubmit={event => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              const input = { id: profile.id, profile: { name: data.get('name'), provider: profile.provider, from: data.get('from'), replyTo: data.get('replyTo'), apiKey: data.get('apiKey'), secretKey: data.get('secretKey') } };
              const secret = form.elements.namedItem('apiKey') as HTMLInputElement;
              secret.value = '';
              const second = form.elements.namedItem('secretKey') as HTMLInputElement | null;
              if (second) second.value = '';
              void run(async () => {
                const status = await replaceSavedEmailProvider(input);
                if (status === 'profile_replaced') { setEditingId(null); await load(); }
                setMessage(messageFor(status));
              });
            }}>
              <fieldset disabled={pending || !selectionPaused} className="space-y-2">
                <legend className="font-medium">Reemplazar configuración</legend>
                <p>Se conserva el perfil anterior como histórico. La nueva configuración requiere una prueba nueva y no queda seleccionada automáticamente.</p>
                <label className="block">Nombre<input name="name" defaultValue={profile.name} required maxLength={80} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
                <label className="block">Remitente autorizado<input name="from" defaultValue={profile.from} type="email" required maxLength={254} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
                <label className="block">Responder a<input name="replyTo" defaultValue={profile.replyTo} type="email" maxLength={254} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
                <label className="block">{providerCatalog[profile.provider].primaryLabel} (nueva o vigente)<input name="apiKey" type="password" autoComplete="new-password" required maxLength={providerCatalog[profile.provider].mode === 'smtp' ? 200 : 512} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>
                {providerCatalog[profile.provider].mode === 'smtp' && <label className="block">{providerCatalog[profile.provider].secondaryLabel}<input name="secretKey" type="password" autoComplete="new-password" required maxLength={200} className="block w-full rounded-lg border border-[var(--border)] bg-transparent p-2" /></label>}
                <button type="submit" className="rounded-lg bg-blue-700 text-white px-3 py-2">Guardar reemplazo</button>
                <button type="button" onClick={() => setEditingId(null)} className="ml-2 rounded-lg border border-[var(--border)] px-3 py-2">Cancelar</button>
              </fieldset>
            </form>
          )}
          {retiringId === profile.id && (
            <div className="space-y-2 border-t border-[var(--border)] pt-3">
              <p>¿Desactivar este perfil? Si era el preferido, se quitará la selección. No se borrará el historial ni se revocará la clave en el proveedor externo.</p>
              <button type="button" disabled={pending || !selectionPaused} onClick={() => run(async () => {
                const status = await retireSavedEmailProvider(profile.id);
                if (status === 'profile_retired') { setRetiringId(null); await load(); }
                setMessage(messageFor(status));
              })} className="rounded-lg border border-[var(--border)] px-3 py-2">Confirmar desactivación</button>
              <button type="button" disabled={pending} onClick={() => setRetiringId(null)} className="ml-2 rounded-lg border border-[var(--border)] px-3 py-2">Cancelar</button>
            </div>
          )}
          </>}
        </div>
      ))}
      <p role="status" aria-live="polite">{message}</p>
      <p>La prueba requiere desactivar todos los controles de despacho. La frecuencia de prueba se limita por proceso; el presupuesto es persistente y compartido. No reintentes envíos inciertos.</p>
    </section>
  );
}
