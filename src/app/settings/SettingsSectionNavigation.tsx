import { Activity, Bell, Mail, Send, ShieldCheck, HardDrive } from 'lucide-react';

const sections = [
  { id: 'settings-system', title: 'Estado del sistema', description: 'Diagnóstico general e importación', Icon: Activity },
  { id: 'settings-notifications', title: 'Notificaciones y presupuesto', description: 'Consultar y reparar avisos', Icon: Bell },
  { id: 'settings-providers', title: 'Proveedores de correo', description: 'Perfiles, pruebas y alternativas', Icon: Mail },
  { id: 'settings-delivery', title: 'Envíos e historial', description: 'Plantillas y automatización', Icon: Send },
  { id: 'settings-auth-email', title: 'Correo de autenticación', description: 'Configuración de Supabase', Icon: ShieldCheck },
  { id: 'settings-maintenance', title: 'Mantenimiento', description: 'Procedimientos autorizados', Icon: HardDrive },
] as const;

/** Native links preserve mounted controls and work without client-side scripting. */
export default function SettingsSectionNavigation() {
  return (
    <nav id="settings-navigation" aria-label="Secciones de configuración" className="space-y-3 scroll-mt-24">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">Acceso rápido</h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map(({ id, title, description, Icon }) => (
          <li key={id} className="min-w-0">
            <a href={'#' + id} className="glass flex h-full min-h-11 items-start gap-3 rounded-xl border border-[var(--border)] p-3 text-[var(--foreground)] hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-link)]">
              <Icon size={20} className="mt-0.5 shrink-0 text-[var(--theme-link)]" aria-hidden="true" />
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-semibold break-words">{title}</span>
                <span className="block text-xs text-[var(--text-secondary)] break-words">{description}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
