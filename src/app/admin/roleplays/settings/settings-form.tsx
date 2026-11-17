'use client';
import { useState, useTransition } from 'react';
import { inspectAudioStudioSettings, saveAudioStudioSettings } from '@/app/actions/audio-studio-settings';
type Initial = {
  hasToken: boolean; tokenSource: string; organizationId: string;
  mediaImportEnabled: boolean; proxyAvailable: boolean; encryptionReady: boolean;
};
export default function AudioStudioSettingsForm({ initial }: { initial: Initial }) {
  const [org, setOrg] = useState(initial.organizationId);
  const [token, setToken] = useState('');
  const [remove, setRemove] = useState(false);
  const [media, setMedia] = useState(initial.mediaImportEnabled);
  const [status, setStatus] = useState(initial);
  const [checking, setChecking] = useState(false);
  const hasToken = status.hasToken;
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData();
    data.set('organizationId', org); data.set('token', token);
    if (remove) data.set('removeToken', 'on');
    if (media) data.set('mediaImportEnabled', 'on');
    start(async () => {
      const result = await saveAudioStudioSettings(data);
      setNotice({ ok: result.success, message: result.message });
      if (result.success) {
        setToken(''); setRemove(false);
        try { setStatus(await inspectAudioStudioSettings()); }
        catch { /* The save already succeeded; avoid misleading retry prompts. */ }
      }
    });
  }
  async function checkConnection() {
    setChecking(true);
    setNotice(null);
    try {
      // Reuse the authenticated, rate-limited read-only endpoint; do not
      // transmit the token or expose transcription titles in this panel.
      const response = await fetch('/api/admin/happyscribe/transcriptions?page=0', { credentials: 'same-origin', cache: 'no-store' });
      const result = await response.json().catch(() => null);
      setNotice(response.ok && result?.success === true
        ? { ok: true, message: 'Conexión verificada: HappyScribe responde para la organización configurada.' }
        : { ok: false, message: typeof result?.error === 'string' ? result.error : 'No se pudo comprobar la conexión.' });
    } catch {
      setNotice({ ok: false, message: 'No se pudo contactar con HappyScribe.' });
    } finally { setChecking(false); }
  }
  return <form onSubmit={submit} className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
    <div><h2 className="text-xl font-semibold text-white">HappyScribe</h2>
      <p className="mt-1 text-sm text-slate-400">Solo los administradores pueden cambiar estos valores. Las claves nunca se devuelven al navegador.</p></div>
    <div><label htmlFor="happy-org" className="mb-2 block text-sm font-semibold text-slate-200">ID de organización</label>
      <input id="happy-org" value={org} onChange={e => setOrg(e.target.value)} inputMode="numeric" pattern="[0-9]*" maxLength={30}
        placeholder="ID numérico" autoComplete="off" className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white" /></div>
    <div><label htmlFor="happy-token" className="mb-2 block text-sm font-semibold text-slate-200">Clave API de HappyScribe</label>
      <input id="happy-token" type="password" value={token} onChange={e => setToken(e.target.value)}
        autoComplete="new-password" maxLength={2048} placeholder={hasToken ? 'Configurada · escribir para reemplazar' : 'Pegar nueva clave API'}
        className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white" />
      <p className="mt-2 text-sm text-slate-400">Estado: {hasToken ? 'Configurada' : 'Sin configurar'}. Origen: {status.tokenSource}. Se muestra únicamente el estado, nunca la clave.</p>
      {!status.encryptionReady && <p role="alert" className="mt-2 text-sm text-amber-300">Para guardar claves nuevas, configura AUDIO_STUDIO_ENCRYPTION_KEY en el servidor.</p>}
      {hasToken && <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={remove} onChange={e => setRemove(e.target.checked)} /> Borrar la clave guardada en el panel
      </label>}</div>
    <div className="rounded-xl border border-white/10 p-4">
      <label className="flex items-start gap-3 text-sm text-white">
        <input type="checkbox" checked={media} disabled={!status.proxyAvailable} onChange={e => setMedia(e.target.checked)} />
        <span><strong>Permitir importar MP3 por el servidor</strong><span className="mt-1 block text-slate-400">Consume ancho de banda del VPS. Desactivado de forma predeterminada; solo disponible si el operador habilita el proxy en el despliegue.</span></span>
      </label></div>
    {notice && <p role="status" className={notice.ok ? 'text-green-300' : 'text-red-300'}>{notice.message}</p>}
    <div className="flex flex-wrap items-center gap-3"><button disabled={pending || checking} type="submit" className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{pending ? 'Guardando…' : 'Guardar configuración'}</button>
      <button type="button" onClick={() => void checkConnection()} disabled={pending || checking || !hasToken || !org.trim()} className="rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50">{checking ? 'Comprobando…' : 'Probar conexión'}</button>
      <a href="/admin/roleplays/studio" className="text-sm text-blue-300 hover:underline">Abrir Audio Studio</a></div>
  </form>;
}
