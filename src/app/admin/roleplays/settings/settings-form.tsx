'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { inspectAudioStudioSettings, saveAudioStudioSettings } from '@/app/actions/audio-studio-settings';
import { formatAudioStudioSafeDiagnostic } from '@/lib/roleplay/audio-studio-safe-diagnostic';
type Initial = {
  revision: string;
  integrationEnabled: boolean;
  hasToken: boolean; credentialUsable: boolean; environmentFallbackAvailable: boolean; tokenSource: string; organizationId: string;
  mediaImportEnabled: boolean; proxyAvailable: boolean; encryptionReady: boolean;
  excludeInterpreterByDefault: boolean; compactViewDefault: 'auto' | 'compact' | 'expanded';
  protocolLanguageDefault: 'en' | 'es';
};
export default function AudioStudioSettingsForm({ initial }: { initial: Initial }) {
  const [org, setOrg] = useState(initial.organizationId);
  const [enabled, setEnabled] = useState(initial.integrationEnabled);
  const [token, setToken] = useState('');
  const [remove, setRemove] = useState(false);
  const [media, setMedia] = useState(initial.mediaImportEnabled);
  const [excludeDefault, setExcludeDefault] = useState(initial.excludeInterpreterByDefault);
  const [compactDefault, setCompactDefault] = useState(initial.compactViewDefault);
  const [protocolDefault, setProtocolDefault] = useState(initial.protocolLanguageDefault);
  const [status, setStatus] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();
  const hasToken = status.hasToken;
  const editingDisabled = pending || checking || refreshing;
  const hasUnsavedChanges = enabled !== status.integrationEnabled || org !== status.organizationId || token.length > 0 || remove ||
    media !== status.mediaImportEnabled || excludeDefault !== status.excludeInterpreterByDefault ||
    compactDefault !== status.compactViewDefault || protocolDefault !== status.protocolLanguageDefault;
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  // A warning paragraph alone cannot stop an accidental tab close or reload.
  // Register the native browser warning only while there is an unsaved draft.
  useEffect(() => {
    if (!hasUnsavedChanges && !pending) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges, pending]);
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A stale form is not allowed to retry until the admin explicitly reloads.
    if (conflict || editingDisabled || !hasUnsavedChanges) return;
    if ((token.trim() || remove) &&
        status.tokenSource === 'panel' && !status.credentialUsable) {
      // Keep the only possibly recoverable ciphertext until the ORIGINAL
      // key is restored. The server also enforces this against stale tabs.
      setNotice({ ok: false, message:
        'No se borró ni se reemplazó la credencial: restaura primero la clave de cifrado ORIGINAL en el servicio Next.js de Easypanel. Se conservaron tus cambios locales.' });
      return;
    }
    if (token.trim() && !status.encryptionReady) {
      // Avoid submitting a secret when the server already reports that it
      // cannot encrypt it. Do not erase the admin's unsaved input.
      setNotice({ ok: false, message:
        status.tokenSource === 'panel'
          ? 'No se guardó la clave API. Restaura primero la clave de cifrado original en el servicio Next.js de Easypanel.'
          : 'No se guardó la clave API. Configura primero AUDIO_STUDIO_ENCRYPTION_KEY en el servicio Next.js de Easypanel.' });
      return;
    }
    const data = new FormData();
    // The server rejects concurrent edits rather than silently overwriting
    // a newer administrator's provider or editor settings.
    data.set('expectedRevision', status.revision);
    data.set('token', token);
    if (org !== status.organizationId) data.set('organizationId', org);
    // Do not reactivate an integration disabled in another admin tab just
    // because this form saved unrelated editor defaults.
    if (enabled !== status.integrationEnabled)
      data.set('integrationEnabled', String(enabled));
    if (excludeDefault !== status.excludeInterpreterByDefault)
      data.set('excludeInterpreterByDefault', String(excludeDefault));
    if (compactDefault !== status.compactViewDefault)
      data.set('compactViewDefault', compactDefault);
    if (protocolDefault !== status.protocolLanguageDefault)
      data.set('protocolLanguageDefault', protocolDefault);
    if (remove) data.set('removeToken', 'on');
    if (media !== status.mediaImportEnabled)
      data.set('mediaImportEnabled', String(media));
    start(async () => {
      let result: Awaited<ReturnType<typeof saveAudioStudioSettings>>;
      try {
        result = await saveAudioStudioSettings(data);
      } catch {
        // A rejected Server Action is an ambiguous outcome: the database may
        // already have committed before the transport failed. Do not permit
        // an automatic second submission of a provider credential.
        setConflict(true);
        setNotice({
          ok: false,
          message: 'No se pudo confirmar el guardado. No vuelvas a enviar la clave API: carga primero los ajustes actuales para comprobar el resultado.',
        });
        return;
      }
      setNotice({ ok: result.success, message: result.message });
      setConflict(result.conflict === true);
      if (result.success) {
        setToken(''); setRemove(false);
        try {
          const latest = await inspectAudioStudioSettings();
          setStatus(latest);
          // The server trims the organization ID. Mirror its canonical value
          // so "Probar conexión" becomes available immediately after saving.
          setOrg(latest.organizationId);
          setEnabled(latest.integrationEnabled);
          setExcludeDefault(latest.excludeInterpreterByDefault);
          setCompactDefault(latest.compactViewDefault);
          setProtocolDefault(latest.protocolLanguageDefault);
          setMedia(latest.mediaImportEnabled);
        } catch {
          // The save committed, but the next revision could not be loaded.
          // Disable another save to avoid a stale retry or duplicate secret update.
          setConflict(true);
          setNotice({
            ok: true,
            message: 'Configuración guardada. No se pudo actualizar la pantalla; vuelve a cargar los ajustes antes de guardar otra vez.',
          });
        }
      }
    });
  }
  async function loadLatestSettings() {
    setRefreshing(true);
    try {
      const latest = await inspectAudioStudioSettings();
      // Discard unsaved changes and any pending secret only after the
      // administrator deliberately requests the fresh configuration.
      setStatus(latest);
      setOrg(latest.organizationId);
      setEnabled(latest.integrationEnabled);
      setToken('');
      setRemove(false);
      setMedia(latest.mediaImportEnabled);
      setExcludeDefault(latest.excludeInterpreterByDefault);
      setCompactDefault(latest.compactViewDefault);
      setProtocolDefault(latest.protocolLanguageDefault);
      setConflict(false);
      setNotice({ ok: true, message: 'Ajustes actuales cargados. Se descartaron tus cambios locales; revisa los valores antes de guardar.' });
    } catch {
      setNotice({ ok: false, message: 'No se pudo recuperar la configuración actual. Ningún cambio local se ha descartado.' });
    } finally {
      setRefreshing(false);
    }
  }
  async function copySafeDiagnostic() {
    // Build the report from the LAST server-provided status, never from
    // entered API tokens, pending form fields, or arbitrary exception text.
    const report = formatAudioStudioSafeDiagnostic(status);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(report);
      setNotice({
        ok: true,
        message: 'Diagnóstico seguro copiado. Solo incluye estados; no contiene claves API, secretos ni identificadores.',
      });
    } catch {
      setNotice({
        ok: false,
        message: 'No se pudo copiar el diagnóstico. Comprueba los permisos del portapapeles del navegador.',
      });
    }
  }

  async function checkConnection() {
    setChecking(true);
    setNotice(null);
    try {
      // Reuse the authenticated, rate-limited read-only endpoint; do not
      // transmit the token or expose transcription titles in this panel.
      const response = await fetch('/api/admin/happyscribe/transcriptions?check=1', { credentials: 'same-origin', cache: 'no-store' });
      const result = await response.json().catch(() => null);
      setNotice(response.ok && result?.success === true && result?.ready === true
        ? { ok: true, message: 'Conexión verificada: HappyScribe responde para la organización configurada.' }
        : { ok: false, message: typeof result?.error === 'string' ? result.error : 'No se pudo comprobar la conexión.' });
    } catch {
      setNotice({ ok: false, message: 'No se pudo contactar con HappyScribe.' });
    } finally { setChecking(false); }
  }
  return <form onSubmit={submit} className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
    <div><h2 className="text-xl font-semibold text-white">HappyScribe</h2>
      <p className="mt-1 text-sm text-slate-400">Solo los administradores pueden cambiar estos valores. Las claves nunca se devuelven al navegador.</p>
      <button type="button" disabled={editingDisabled} onClick={() => void copySafeDiagnostic()}
        className="mt-3 rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-blue-200 hover:bg-white/5 disabled:opacity-50">
        Copiar diagnóstico seguro
      </button>
      <p className="mt-1 text-xs text-slate-400">Solo copia indicadores de configuración ya cargados; nunca claves, tokens, ID de organización ni cambios sin guardar.</p>
    </div>
    {!status.encryptionReady && (
      <div role="alert" className="rounded-xl border border-amber-400/35 bg-amber-400/5 p-4 text-sm text-amber-100">
        <p className="font-semibold">AUDIO_STUDIO_ENCRYPTION_KEY no está configurada correctamente en el servicio Next.js.</p>
        {status.tokenSource === 'panel' ? (
          <p className="mt-2">Ya existe una credencial cifrada en el panel. Restaura la clave ORIGINAL de 64 caracteres hexadecimales desde el gestor de secretos de Easypanel. No generes otra clave, no borres el registro ni reemplaces la credencial antes de recuperar el secreto original.</p>
        ) : (
          <p className="mt-2">Para guardar una nueva clave API desde este panel, configura primero una clave de cifrado de 64 caracteres hexadecimales en el servicio Next.js de Easypanel. Si se trata de una instalación nueva sin credenciales cifradas, puedes generar una clave segura; una clave nueva no recupera datos cifrados anteriormente.</p>
        )}
        <p className="mt-2 text-amber-200">No introduzcas esta clave de cifrado en el campo «Clave API de HappyScribe» ni la compartas por chat o registros. El token de entorno, si existe, se administra por separado.</p>
      </div>
    )}
    {status.encryptionReady && status.tokenSource === 'panel' && !status.credentialUsable && (
      <div role="alert" className="rounded-xl border border-amber-400/35 bg-amber-400/5 p-4 text-sm text-amber-100">
        <p className="font-semibold">La clave de cifrado tiene formato válido, pero la credencial guardada no se puede descifrar.</p>
        <p className="mt-2">Comprueba que la variable de Easypanel contiene la clave ORIGINAL utilizada al guardar el token. No borres ni reemplaces automáticamente la credencial: si la clave se perdió, hace falta una rotación controlada.</p>
      </div>
    )}
    <div className="rounded-xl border border-white/10 p-4">
      <label className="flex items-start gap-3 text-sm text-slate-200">
        <input type="checkbox" checked={enabled} disabled={editingDisabled} onChange={e => setEnabled(e.target.checked)} />
        <span><strong className="block text-white">Habilitar conexión con HappyScribe</strong>
          <span className="mt-1 block text-slate-400">Al desactivar, se bloquean nuevas importaciones SRT y MP3, incluso si Easypanel conserva una clave. El permiso MP3 queda apagado y requerirá activación manual. Las credenciales cifradas no se borran.</span>
        </span>
      </label>
      {!enabled && <p role="status" className="mt-3 text-sm text-amber-200">HappyScribe está desactivado {status.integrationEnabled ? '(sin guardar)' : 'para este sistema'}.</p>}
    </div>
    <div><label htmlFor="happy-org" className="mb-2 block text-sm font-semibold text-slate-200">ID de organización</label>
      <input id="happy-org" disabled={editingDisabled} value={org} onChange={e => setOrg(e.target.value)} inputMode="numeric" pattern="[0-9]*" maxLength={30}
        placeholder="ID numérico" autoComplete="off" className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white" /></div>
    <div><label htmlFor="happy-token" className="mb-2 block text-sm font-semibold text-slate-200">Clave API de HappyScribe</label>
      <input id="happy-token" type="password" value={token} onChange={e => setToken(e.target.value)}
        autoComplete="new-password" maxLength={2048} disabled={remove || editingDisabled} placeholder={hasToken ? 'Configurada · escribir para reemplazar' : 'Pegar nueva clave API'}
        className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white" />
      <p className="mt-2 text-sm text-slate-400">Estado: {hasToken ? 'Configurada' : 'Sin configurar'} · {status.credentialUsable ? 'Clave accesible' : 'No disponible'}. Origen: {status.tokenSource}. Nunca se muestra la clave.</p>
      {!status.credentialUsable && status.tokenSource !== 'panel' && <p role="status" className="mt-2 text-sm text-amber-200">
        No hay un token API utilizable en el servidor o en el panel. Configura una credencial válida y un ID de organización numérico antes de probar la conexión.
      </p>}
      {status.tokenSource === 'panel' && <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" disabled={editingDisabled || !status.credentialUsable} checked={remove} onChange={e => {
          setRemove(e.target.checked);
          if (e.target.checked) setToken('');
        }} /> Borrar la clave guardada en el panel
      </label>}
      {remove && status.tokenSource === 'panel' && status.environmentFallbackAvailable && <p role="alert" className="mt-2 text-sm text-amber-300">
        Atención: al borrar la clave del panel volverá a utilizarse la clave configurada en Easypanel. Para revocarla por completo debes eliminarla también del servidor.
      </p>}
      {status.tokenSource === 'servidor' && <p className="mt-2 text-xs text-slate-400">
        La clave actual proviene de Easypanel. Puedes sustituirla desde aquí, pero para revocarla debes eliminarla del servidor.
      </p>}</div>
    <div className="rounded-xl border border-white/10 p-4">
      <label className="flex items-start gap-3 text-sm text-white">
        <input type="checkbox" checked={media} disabled={editingDisabled || !status.proxyAvailable} onChange={e => setMedia(e.target.checked)} />
        <span><strong>Permitir importar MP3 por el servidor</strong><span className="mt-1 block text-slate-400">Consume ancho de banda del VPS. Desactivado de forma predeterminada; solo disponible si el operador habilita el proxy en el despliegue.</span></span>
      </label></div>
    <p className="text-xs text-slate-400">La prueba utiliza la configuración ya guardada. Guarda primero cualquier cambio de clave u organización.</p>
    <fieldset className="space-y-4 rounded-2xl border border-white/10 p-4">
      <legend className="px-1 text-lg font-semibold text-white">Preferencias del editor</legend>
      <p className="text-sm text-slate-400">Valores iniciales para nuevas sesiones. El administrador puede ajustarlos durante la edición; no cambian proyectos existentes.</p>
      <label className="flex items-center gap-3 text-sm text-slate-200">
        <input type="checkbox" disabled={editingDisabled} checked={excludeDefault} onChange={e => setExcludeDefault(e.target.checked)} />
        Excluir de forma predeterminada al intérprete original al importar subtítulos
      </label>
      <label htmlFor="compact-default" className="block text-sm text-slate-200">Vista inicial de intervenciones</label>
      <select id="compact-default" disabled={editingDisabled} value={compactDefault} onChange={e => setCompactDefault(e.target.value as typeof compactDefault)}
        className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white">
        <option value="auto">Automática — compacta cuando el proyecto crece</option>
        <option value="compact">Compacta</option>
        <option value="expanded">Detallada</option>
      </select>
      <label htmlFor="protocol-default" className="block text-sm text-slate-200">Idioma inicial de los protocolos</label>
      <select id="protocol-default" disabled={editingDisabled} value={protocolDefault} onChange={e => setProtocolDefault(e.target.value as 'en' | 'es')}
        className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white">
        <option value="en">Inglés</option>
        <option value="es">Español</option>
      </select>
    </fieldset>
    {hasUnsavedChanges && !pending && <p role="status" className="text-sm text-amber-200">
      Tienes cambios sin guardar. Guárdalos antes de probar la conexión o salir de esta pantalla.
    </p>}
    {notice && <p role={conflict ? 'alert' : 'status'} className={notice.ok ? 'text-green-300' : 'text-red-300'}>{notice.message}</p>}
    {conflict && <div className="space-y-2 rounded-xl border border-amber-500/30 p-4">
      <p className="text-sm text-amber-200">El guardado está bloqueado hasta cargar la configuración actual. La acción siguiente descartará tus cambios sin guardar, incluida cualquier clave API escrita.</p>
      <button type="button" disabled={editingDisabled} onClick={() => void loadLatestSettings()}
        className="rounded-xl border border-amber-400/40 px-4 py-3 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50">
        {refreshing ? 'Cargando ajustes…' : 'Descartar mis cambios y cargar ajustes actuales'}
      </button>
    </div>}
    <div className="flex flex-wrap items-center gap-3"><button disabled={editingDisabled || conflict || !hasUnsavedChanges} type="submit" className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{pending ? 'Guardando…' : 'Guardar configuración'}</button>
      <button type="button" onClick={() => void checkConnection()} disabled={editingDisabled || conflict || hasUnsavedChanges || !enabled || !hasToken || !status.credentialUsable || !org.trim() || Boolean(token.trim()) || org !== status.organizationId || remove} className="rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50">{checking ? 'Comprobando…' : 'Probar conexión'}</button>
      <Link href="/admin/roleplays/studio" onClick={event => {
        if (editingDisabled) {
          event.preventDefault();
          return;
        }
        if (hasUnsavedChanges &&
          !window.confirm('Hay cambios sin guardar, incluida cualquier clave nueva. ¿Quieres salir y descartarlos?')) {
          event.preventDefault();
        }
      }} className="text-sm text-blue-300 hover:underline">Abrir Audio Studio</Link></div>
  </form>;
}
