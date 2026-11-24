import Link from 'next/link';
import { ArrowLeft, ClipboardList, HardDrive, LockKeyhole, Mail } from 'lucide-react';
import SystemReadinessCheck from './SystemReadinessCheck';
import RecruitmentEmailPreview from './RecruitmentEmailPreview';
import CorporateSmtpTest from './CorporateSmtpTest';
import CorporateEmailHistory from './CorporateEmailHistory';
import EmailDatabaseReadiness from './EmailDatabaseReadiness';
import { operationalMailStatus } from '@/lib/email/operational-config';
import { emailAutomationStatus } from '@/lib/email/automation-status';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const operationalStatus = operationalMailStatus(process.env);
  const automation = emailAutomationStatus(process.env);
  const automationChecks: [string, boolean][] = [
    ['SMTP configurado', automation.smtpConfigured],
    ['Vinculación habilitada', automation.bindingEnabled],
    ['Despacho habilitado', automation.dispatchEnabled],
    ['Lotes habilitados', automation.batchEnabled],
    ['Entrada programable habilitada', automation.schedulerEnabled],
    ['Credencial del programador válida', automation.schedulerCredentialConfigured],
    ['Fecha de inicio válida', automation.cutoverValid],
  ];
  const operationalMessages = {
    disabled: 'Desactivado. No se realizan envíos operativos.',
    incomplete: 'Configuración incompleta. Revisa las variables privadas del servidor.',
    invalid: 'Configuración no válida. Revisa el remitente, servidor y puerto TLS.',
    configured: 'Variables válidas. Conexión y entrega aún no verificadas.',
  } as const;
  return (
    <main className="max-w-6xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="space-y-3">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-[var(--theme-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
          <ArrowLeft size={16} aria-hidden="true" /> Volver al administrador
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">Configuración y diagnóstico</h1>
        <p className="text-gray-400">
          Consulta el estado conocido de la plataforma sin exponer credenciales ni ejecutar cambios de infraestructura.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <aside className="space-y-4">
          <section className="glass rounded-3xl border border-white/10 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <LockKeyhole className="text-blue-400" aria-hidden="true" />
              <h2 className="font-semibold text-[var(--foreground)]">Acceso administrativo</h2>
            </div>
            <p className="text-sm text-gray-400">
              El diagnóstico requiere una sesión administradora y no devuelve credenciales ni datos de pacientes.
            </p>
          </section>
          <Link
            href="/settings/import"
            className="glass flex items-center gap-3 rounded-2xl border border-[var(--border)] p-5 text-[var(--foreground)] hover:bg-[var(--theme-hover)]"
          >
            <ClipboardList className="text-blue-400 shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold">Importar datos CSV</span>
          </Link>
        </aside>

        <div className="lg:col-span-2 space-y-5">
          <SystemReadinessCheck />
          <section aria-labelledby="email-settings-heading" className="glass rounded-3xl border border-[var(--border)] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="text-[var(--theme-link)] shrink-0" aria-hidden="true" />
              <h2 id="email-settings-heading" className="font-semibold text-[var(--foreground)]">Correos corporativos</h2>
            </div>
            <p className="text-sm text-[var(--foreground)]">
              Usa el nombre Intérpretes RD y una dirección autorizada por el proveedor de correo para los mensajes de autenticación.
            </p>
            <div className="rounded-xl border border-[var(--border)] p-4 space-y-2 text-sm text-[var(--foreground)]">
              <p><strong>Estado SMTP:</strong> no verificado desde esta pantalla.</p>
              <p>Configura el remitente y las plantillas en el panel de Supabase del proyecto correspondiente. Las credenciales permanecen en ese servicio.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--theme-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
                Abrir Supabase (nueva pestaña)
              </a>
              <a href="https://github.com/tadtaxiadvertising/interpretes-rd/blob/main/docs/AUTH_CORPORATE_EMAIL_TEMPLATES.md" target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--theme-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
                Plantillas y guía (nueva pestaña)
              </a>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--foreground)]">
              <li>Selecciona el proyecto correcto y abre Authentication → Emails.</li>
              <li>Comprueba el SMTP personalizado, el remitente y las plantillas en español.</li>
              <li>Prueba el registro y la recuperación de contraseña con una cuenta controlada.</li>
              <li>Revisa la bandeja de entrada, el remitente y los registros de entrega.</li>
            </ol>
            <p className="text-xs text-[var(--foreground)]">
              El SMTP de autenticación se comprueba en Supabase. La prueba operativa de abajo es independiente y no activa notificaciones automáticas.
            </p>
            <div className="rounded-xl border border-[var(--border)] p-4 space-y-2 text-sm text-[var(--foreground)]">
              <h3 className="font-semibold">Configuración de correos operativos</h3>
              <p>{operationalMessages[operationalStatus]}</p>
              <p className="text-xs">Diagnóstico de variables privadas de Next.js. No se muestran credenciales ni se prueba la red automáticamente.</p>
            </div>
            <CorporateSmtpTest configured={operationalStatus === 'configured'} />
            <RecruitmentEmailPreview />
            <CorporateEmailHistory />
            <EmailDatabaseReadiness />
            <section aria-labelledby="email-automation" className="space-y-3 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--foreground)]">
              <h3 id="email-automation" className="font-semibold">Automatización de comunicaciones</h3>
              <p>{automationChecks.every(([, ready]) => ready) ? 'Configuración completa. Ejecución externa y entrega todavía no verificadas.' : 'Automatización no lista: revisa los controles pendientes.'}</p>
              <dl className="space-y-2">
                {automationChecks.map(([label, ready]) => (
                  <div key={label} className="flex flex-wrap justify-between gap-2">
                    <dt>{label}</dt><dd className="font-medium">{ready ? 'Correcto' : 'Pendiente'}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs">Diagnóstico de configuración solamente. No confirma permisos de base de datos, recepción real ni la existencia de una tarea programada. No muestra secretos ni inicia envíos.</p>
            </section>
          </section>
          <section className="glass rounded-3xl border border-white/10 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <HardDrive className="text-amber-400" aria-hidden="true" />
              <h2 className="font-semibold text-[var(--foreground)]">Mantenimiento</h2>
            </div>
            <p className="text-sm text-gray-400">
              Las migraciones, la rotación de secretos y el reinicio de caché requieren procedimientos operativos
              autorizados. Esta pantalla no ejecuta esas operaciones.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
