'use client';
import { useRef, useState } from 'react';
import { runCorporateEmailPilot } from '@/app/actions/email-pilot';

export default function CorporateEmailPilot({ configured }: { configured: boolean }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState('');
  async function run() {
    if (!configured || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const report = await runCorporateEmailPilot();
      if (report.status === 'unauthorized') setResult('Se requiere acceso administrativo.');
      else if (report.status === 'completed') setResult('Lote piloto completado. Eventos revisados: ' + report.examined + '. Aceptados por SMTP: ' + report.accepted + '. Confirma la recepción en el buzón de prueba.');
      else if (report.status === 'review_required' || report.status === 'unavailable') setResult('Requiere revisión. No repitas el envío sin comprobar el historial y el buzón.');
      else if (report.status === 'busy') setResult('Ya hay una ejecución en curso o reciente.');
      else setResult('Piloto desactivado. Revisa los controles de configuración.');
    } catch { setResult('No se pudo confirmar el resultado. Revisa el historial antes de repetir.'); }
    finally { busy.current = false; setPending(false); }
  }
  return (
    <section className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--foreground)]">
      <h3 className="font-semibold">Prueba piloto de reclutamiento</h3>
      <p>Procesa como máximo un evento real de la cuenta de prueba autorizada en el servidor. No permite introducir destinatarios ni ejecutar el piloto con el programador habilitado.</p>
      <button type="button" disabled={!configured || pending} onClick={run} className="rounded-xl border border-[var(--border)] px-4 py-2 font-semibold text-[var(--theme-link)] disabled:opacity-50">{pending ? 'Procesando…' : 'Ejecutar piloto controlado'}</button>
      <p role="status">{result || (configured ? 'Listo para solicitar una ejecución controlada.' : 'Configura una cuenta de prueba y los controles de despacho; mantén desactivado el programador.')}</p>
    </section>
  );
}
