import Link from 'next/link';
import { ArrowLeft, ClipboardList, HardDrive, LockKeyhole, Mail } from 'lucide-react';
import SystemReadinessCheck from './SystemReadinessCheck';
import NotificationDiagnostics from './NotificationDiagnostics';
import NotificationEmailBudget from './NotificationEmailBudget';
import RecruitmentEmailPreview from './RecruitmentEmailPreview';
import EmailProviderVault from './EmailProviderVault';
import EmailVaultPause from './EmailVaultPause';
import EmailProviderReadiness from './EmailProviderReadiness';
import EmailProviderSetup from './EmailProviderSetup';
import CorporateSmtpTest from './CorporateSmtpTest';
import CorporateEmailHistory from './CorporateEmailHistory';
import CorporateEmailPilot from './CorporateEmailPilot';
import EmailDatabaseReadiness from './EmailDatabaseReadiness';
import prisma from '@/lib/prisma';
import { resolveOperationalMailEnv, usesProviderVault } from '@/lib/email/preferred-provider-runtime';
import { operationalMailDiagnostic } from '@/lib/email/operational-config';
import { emailRolloutReadiness } from '@/lib/email/automation-status';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const vault = usesProviderVault(process.env);
  const effectiveEnv = await resolveOperationalMailEnv(prisma, process.env);
  const mailDiagnostic = operationalMailDiagnostic(effectiveEnv);
  const operationalStatus = mailDiagnostic.status;
  const automation = emailRolloutReadiness(effectiveEnv);
  const automationChecks = automation.checks;
  const operationalMessages = {
    disabled: 'Desactivado. No se realizan envíos operativos.',
    incomplete: 'Configuración incompleta. Revisa las variables privadas del servidor.',
    invalid: 'Configuración no válida. Revisa el remitente y las credenciales del proveedor.',
    configured: 'Variables válidas. Conexión y entrega aún no verificadas.',
  } as const;
  const issueMessages = {
    activation: 'OPERATIONAL_EMAIL_ENABLED: utiliza exactamente true o false.',
    provider: 'OPERATIONAL_EMAIL_PROVIDER: selecciona brevo, resend o smtp.',
    brevo_smtp_key: 'BREVO_API_KEY: se detectó una clave SMTP. Genera una clave API en Brevo.',
    brevo_mcp_token: 'BREVO_API_KEY: se detectó un token MCP codificado. Utiliza la clave API original, no el token de conexión MCP.',
    brevo_key_format: 'BREVO_API_KEY: revisa el formato. Copia únicamente la clave API original, sin espacios, comillas ni JSON.',
    resend_key_format: 'RESEND_API_KEY: introduce la clave API original de Resend, sin espacios ni comillas.',
    sender: 'OPERATIONAL_EMAIL_FROM: introduce solo una dirección de correo autorizada, sin nombre ni signos adicionales.',
    reply_to: 'OPERATIONAL_EMAIL_REPLY_TO: introduce una dirección de correo válida o deja el campo vacío.',
    smtp_host: 'OPERATIONAL_SMTP_HOST: introduce solo el nombre del servidor, sin protocolo ni ruta.',
    smtp_port: 'OPERATIONAL_SMTP_PORT: utiliza 465 o 587.',
    smtp_user: 'OPERATIONAL_SMTP_USER: revisa el formato del usuario SMTP.',
    smtp_password: 'OPERATIONAL_SMTP_PASSWORD: revisa si la contraseña contiene caracteres de control.',
  } as const;
  return (
    <main className="max-w-6xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="space-y-3">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-[var(--theme-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
          <ArrowLeft size={16} aria-hidden="true" /> Volver al administrador
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">Configuración y diagnóstico</h1>
        <p className="text-[var(--text-secondary)]">
          Consulta el estado conocido de la plataforma sin exponer credenciales ni ejecutar cambios de infraestructura.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <aside className="space-y-4">
          <section className="glass rounded-3xl border border-[var(--border)] p-6 space-y-3">
            <div className="flex items-center gap-3">
              <LockKeyhole className="text-[var(--theme-link)]" aria-hidden="true" />
              <h2 className="font-semibold text-[var(--foreground)]">Acceso administrativo</h2>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              El diagnóstico requiere una sesión administradora y no devuelve credenciales ni datos de pacientes.
            </p>
          </section>
          <Link
            href="/settings/import"
            className="glass flex items-center gap-3 rounded-2xl border border-[var(--border)] p-5 text-[var(--foreground)] hover:bg-[var(--theme-hover)]"
          >
            <ClipboardList className="text-[var(--theme-link)] shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold">Importar datos CSV</span>
          </Link>
        </aside>

        <div className="lg:col-span-2 space-y-5">
          <SystemReadinessCheck />
          <NotificationDiagnostics />
          <NotificationEmailBudget />
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
              {vault && <p><strong>Origen:</strong> perfil preferido del almacén. Solo piloto; sin alternativa automática. Si no está disponible, revisa la selección, el presupuesto y la clave de cifrado.</p>}
              <p><strong>Proveedor:</strong> {mailDiagnostic.provider === 'brevo' ? 'Brevo API (HTTPS)' : mailDiagnostic.provider === 'resend' ? 'Resend API (HTTPS)' : mailDiagnostic.provider === 'smtp' ? 'SMTP' : 'No válido'}</p>
              {mailDiagnostic.sender && (
                <dl className="space-y-1 break-all">
                  <div><dt className="font-medium">Remitente operativo y destino de prueba</dt><dd>Intérpretes RD &lt;{mailDiagnostic.sender}&gt;</dd></div>
                  <div><dt className="font-medium">Responder a</dt><dd>{mailDiagnostic.replyTo ?? mailDiagnostic.sender}</dd></div>
                  <div><dt className="font-medium">Cifrado de transporte</dt><dd>{mailDiagnostic.tls}</dd></div>
                </dl>
              )}
              {mailDiagnostic.missing.length > 0 && (
                <div>
                  <p className="font-medium">Variables pendientes en el servidor:</p>
                  <ul className="list-disc pl-5 break-all">{mailDiagnostic.missing.map(key => <li key={key}><code>{key}</code></li>)}</ul>
                </div>
              )}
              {mailDiagnostic.issues.length > 0 && (
                <div role="alert" className="rounded-xl border border-[var(--border)] p-3 space-y-2">
                  <p className="font-semibold">Parámetros que debes corregir</p>
                  <ul className="list-disc pl-5 space-y-1 break-words">
                    {mailDiagnostic.issues.map(issue => <li key={issue}>{issueMessages[issue]}</li>)}
                  </ul>
                  <p className="text-xs">El diagnóstico solo muestra nombres de variables y tipos de error; no lee ni muestra el valor de una clave en el navegador.</p>
                </div>
              )}
              {!vault && operationalStatus !== 'configured' && (
                <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
                  <h4 className="font-semibold">Configurar y probar el remitente</h4>
                  <p>El SMTP personalizado de Supabase no configura automáticamente Next.js. Puedes usar SMTP, Brevo API o Resend API con un remitente autorizado.</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>Abre las variables de entorno privadas del servicio frontend <strong>interpreters</strong> en Easypanel. Conserva las variables existentes.</li>
                    <li>Para Brevo API, configura <code>OPERATIONAL_EMAIL_PROVIDER=brevo</code>, <code>BREVO_API_KEY</code> y <code>OPERATIONAL_EMAIL_FROM</code>. La clave SMTP y el token MCP no son claves API. Para Resend, utiliza OPERATIONAL_EMAIL_PROVIDER=resend, RESEND_API_KEY y un remitente de dominio verificado. Para SMTP, conserva el proveedor predeterminado y completa host, puerto 465 o 587, usuario, contraseña y remitente.</li>
                    <li>Establece los siguientes controles para permitir solamente la prueba manual, sin activar el despacho de reclutamiento:</li>
                  </ol>
                  <pre className="overflow-x-auto rounded-lg border border-[var(--border)] p-3 text-xs">{'OPERATIONAL_EMAIL_ENABLED=true\nOPERATIONAL_EMAIL_DISPATCH_ENABLED=false\nOPERATIONAL_EMAIL_BATCH_ENABLED=false\nOPERATIONAL_EMAIL_BINDING_ENABLED=false\nOPERATIONAL_EMAIL_GENERAL_ENABLED=false\nOPERATIONAL_EMAIL_SCHEDULER_ENABLED=false'}</pre>
                  <p>Aplica los cambios en el servicio correcto según el procedimiento de despliegue. Vuelve a esta pantalla y envía la prueba al remitente configurado; comprueba su recepción antes de preparar el piloto.</p>
                  <a href="https://github.com/tadtaxiadvertising/interpretes-rd/blob/main/docs/operations/recruitment-email-ledger.md#procedimiento-de-puesta-en-servicio" target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl border border-[var(--border)] px-4 py-2 font-semibold text-[var(--theme-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">Guía de configuración operativa (nueva pestaña)</a>
                  <p className="text-xs">No introduzcas contraseñas en esta pantalla, en GitHub ni en el chat. No es necesario modificar Supabase, migrar la base de datos o cambiar AUTH_SECRET para esta prueba.</p>
                </div>
              )}
              <p className="text-xs">Este remitente pertenece a los correos operativos de Next.js, no certifica el remitente de autenticación configurado en Supabase.</p>
              <p className="text-xs">Diagnóstico local de Next.js. No se muestran credenciales ni se prueba la red automáticamente.</p>
            </div>
            <EmailProviderSetup activeProvider={mailDiagnostic.provider} />
            <EmailProviderReadiness />
            <EmailVaultPause />
            <EmailProviderVault />
            {vault ? <p className="text-sm">Usa la prueba de perfiles guardados con el despacho pausado. El transporte de entorno no se utiliza en este modo.</p> : <CorporateSmtpTest configured={operationalStatus === 'configured'} brevo={mailDiagnostic.provider === 'brevo'} />}
            <RecruitmentEmailPreview />
            <CorporateEmailHistory />
            <CorporateEmailPilot configured={automation.mode === 'pilot' && automation.ready} />
            <EmailDatabaseReadiness />
            <section aria-labelledby="email-automation" className="space-y-3 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--foreground)]">
              <h3 id="email-automation" className="font-semibold">Automatización de comunicaciones</h3>
              <p><strong>Modo:</strong> {automation.mode === 'pilot' ? 'Piloto controlado' : automation.mode === 'general' ? 'Despacho general' : 'Desactivado o configuración incompatible'}</p>
              <p>{automation.ready ? (automation.mode === 'pilot' ? 'Configuración del piloto lista. Aún debes vincular la cuenta de prueba y comprobar la recepción.' : 'Configuración general lista. Ejecución externa y entrega todavía no verificadas.') : 'Revisa los controles pendientes para el modo seleccionado.'}</p>
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
          <section className="glass rounded-3xl border border-[var(--border)] p-6 space-y-3">
            <div className="flex items-center gap-3">
              <HardDrive className="text-[var(--theme-warning)]" aria-hidden="true" />
              <h2 className="font-semibold text-[var(--foreground)]">Mantenimiento</h2>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Las migraciones, la rotación de secretos y el reinicio de caché requieren procedimientos operativos
              autorizados. Esta pantalla no ejecuta esas operaciones.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
