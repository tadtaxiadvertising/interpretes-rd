'use client';
import { useRef, useState } from 'react';
import { getEmailVaultPause, changeEmailVaultPause } from '@/app/actions/email-vault-pause';

type Report = Awaited<ReturnType<typeof getEmailVaultPause>>;
export default function EmailVaultPause() {
  const [report, setReport] = useState<Report | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  async function run(task: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try { await task(); } catch { setMessage('No se pudo verificar la operación. Consulta el estado nuevamente.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function refresh() {
    setReport(await getEmailVaultPause());
    setConfirmResume(false);
  }
  async function change(paused: boolean) {
    const result = await changeEmailVaultPause(paused);
    await refresh();
    setMessage(result === 'paused' ? 'Pausa guardada.' : result === 'unpaused' ? 'Pausa levantada. No se inició ningún envío.' : result === 'blocked' ? 'No permitido: revisa piloto, perfil confirmado y presupuesto.' : 'No se pudo confirmar el cambio.');
  }
  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3 text-sm text-[var(--foreground)]" aria-labelledby="vault-pause-heading">
      <h3 id="vault-pause-heading" className="font-semibold">Pausa de emergencia del almacén</h3>
      <p>Detiene nuevas reservas del piloto y códigos de verificación mediante perfiles guardados. Los envíos ya reservados pueden finalizar. No controla el transporte de entorno, las pruebas administrativas ni Supabase Auth.</p>
      <p role="status" aria-live="polite">{report ? report.state === 'paused' ? 'Despacho del almacén pausado.' : report.state === 'unpaused' ? 'Pausa levantada; siguen vigentes los controles del servidor.' : 'Estado no disponible o acceso denegado.' : 'Estado aún no comprobado.'}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run(refresh)} className="rounded-lg border border-[var(--border)] px-3 py-2">Consultar estado</button>
        <button type="button" disabled={pending || report?.state === 'paused'} onClick={() => run(() => change(true))} className="rounded-lg bg-red-700 text-white px-3 py-2 font-semibold">Pausar despacho</button>
        <button type="button" disabled={pending || report?.state !== 'paused' || !report.canResume} onClick={() => setConfirmResume(true)} className="rounded-lg border border-[var(--border)] px-3 py-2">Preparar reanudación del piloto</button>
      </div>
      {confirmResume && <div className="space-y-2"><p>Confirma que revisaste los envíos inciertos, el perfil elegido y el saldo real. Levantar la pausa no inicia un envío por sí solo.</p><button type="button" disabled={pending} onClick={() => run(() => change(false))} className="rounded-lg border border-[var(--border)] px-3 py-2">Confirmar reanudación</button><button type="button" onClick={() => setConfirmResume(false)} className="ml-2 underline">Cancelar</button></div>}
      <p role="status" aria-live="polite">{message}</p>
    </section>
  );
}
