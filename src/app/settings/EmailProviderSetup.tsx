'use client';

import { useState } from 'react';

const presets = {
  brevo: { label: 'Brevo API', provider: 'brevo', guide: 'https://app.brevo.com/settings/keys/api', note: 'Usa la clave API original y un remitente autorizado.', fields: ['BREVO_API_KEY='] },
  resend: { label: 'Resend API', provider: 'resend', guide: 'https://resend.com/api-keys', note: 'Verifica un dominio propio antes de enviar a terceros. Usa una clave con permiso de envío.', fields: ['RESEND_API_KEY='] },
  mailersend: { label: 'MailerSend (SMTP)', provider: 'smtp', guide: 'https://www.mailersend.com/help/smtp-relay', note: 'Requiere cuenta aprobada, dominio autorizado y credenciales SMTP.', fields: ['OPERATIONAL_SMTP_HOST=smtp.mailersend.net', 'OPERATIONAL_SMTP_PORT=587', 'OPERATIONAL_SMTP_USER=', 'OPERATIONAL_SMTP_PASSWORD='] },
  smtp: { label: 'Otro proveedor SMTP', provider: 'smtp', guide: '', note: 'Consulta el servidor y puerto TLS 465 o STARTTLS 587 de tu proveedor.', fields: ['OPERATIONAL_SMTP_HOST=', 'OPERATIONAL_SMTP_PORT=587', 'OPERATIONAL_SMTP_USER=', 'OPERATIONAL_SMTP_PASSWORD='] },
} as const;

type Preset = keyof typeof presets;

export default function EmailProviderSetup({ activeProvider }: { activeProvider: string }) {
  const [choice, setChoice] = useState<Preset>(activeProvider === 'brevo' || activeProvider === 'resend' ? activeProvider : 'smtp');
  const [copyStatus, setCopyStatus] = useState('');
  const selected = presets[choice];
  const template = [
    'OPERATIONAL_EMAIL_ENABLED=true',
    'OPERATIONAL_EMAIL_PROVIDER=' + selected.provider,
    ...selected.fields,
    'OPERATIONAL_EMAIL_FROM=',
    'OPERATIONAL_EMAIL_REPLY_TO=',
    'OPERATIONAL_EMAIL_BINDING_ENABLED=false',
    'OPERATIONAL_EMAIL_DISPATCH_ENABLED=false',
    'OPERATIONAL_EMAIL_BATCH_ENABLED=false',
    'OPERATIONAL_EMAIL_GENERAL_ENABLED=false',
    'OPERATIONAL_EMAIL_SCHEDULER_ENABLED=false',
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(template);
      setCopyStatus('Plantilla copiada. Completa las credenciales únicamente en el servidor.');
    } catch {
      setCopyStatus('No se pudo copiar automáticamente. Selecciona y copia el bloque de texto.');
    }
  }

  return (
    <section aria-labelledby="provider-setup-heading" className="rounded-xl border border-[var(--border)] p-4 space-y-3 text-sm text-[var(--foreground)]">
      <h3 id="provider-setup-heading" className="font-semibold">Agregar o cambiar proveedor de correo</h3>
      <p>Proveedor en ejecución: {activeProvider}. El asistente genera una plantilla; no cambia la configuración activa ni guarda claves.</p>
      <label htmlFor="provider-preset" className="block font-medium">Proveedor que deseas preparar</label>
      <select id="provider-preset" value={choice} onChange={event => { setChoice(event.target.value as Preset); setCopyStatus(''); }} className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 text-[var(--foreground)]">
        {Object.entries(presets).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
      </select>
      <p>{selected.note}</p>
      {selected.guide && <a href={selected.guide} target="_blank" rel="noopener noreferrer" className="text-[var(--theme-link)] underline">Configuración del proveedor (nueva pestaña)</a>}
      <pre className="overflow-x-auto rounded-lg border border-[var(--border)] p-3 text-xs">{template}</pre>
      <button type="button" onClick={copy} className="rounded-xl border border-[var(--border)] px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">Copiar plantilla de prueba</button>
      <p role="status" aria-live="polite">{copyStatus}</p>
      <p>Actualiza solo las variables de la plantilla en el servicio frontend, sin duplicarlas. Completa el remitente y las claves en Easypanel; no borres las credenciales de otros proveedores. Aplica el despliegue y verifica el correo de prueba antes de reactivar el piloto.</p>
      <p>Consulta el cupo disponible en cada proveedor y conserva sus planes gratuitos. No se cambia automáticamente de proveedor cuando un envío queda sin confirmar; podría haber sido aceptado o retenido en cola. No reenvíes esos mensajes sin revisar los registros.</p>
    </section>
  );
}
