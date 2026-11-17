import Link from 'next/link';
import { ArrowLeft, ClipboardList, HardDrive, LockKeyhole } from 'lucide-react';
import SystemReadinessCheck from './SystemReadinessCheck';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <main className="max-w-6xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="space-y-3">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200">
          <ArrowLeft size={16} aria-hidden="true" /> Volver al administrador
        </Link>
        <h1 className="text-3xl font-bold text-white">Configuración y diagnóstico</h1>
        <p className="text-gray-400">
          Consulta el estado conocido de la plataforma sin exponer credenciales ni ejecutar cambios de infraestructura.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <aside className="space-y-4">
          <section className="glass rounded-3xl border border-white/10 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <LockKeyhole className="text-blue-400" aria-hidden="true" />
              <h2 className="font-semibold text-white">Acceso administrativo</h2>
            </div>
            <p className="text-sm text-gray-400">
              El diagnóstico requiere una sesión administradora y no devuelve credenciales ni datos de pacientes.
            </p>
          </section>
          <Link
            href="/settings/import"
            className="glass flex items-center gap-3 rounded-2xl border border-white/10 p-5 text-gray-200 hover:bg-white/10"
          >
            <ClipboardList className="text-blue-400 shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold">Importar datos CSV</span>
          </Link>
        </aside>

        <div className="lg:col-span-2 space-y-5">
          <SystemReadinessCheck />
          <section className="glass rounded-3xl border border-white/10 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <HardDrive className="text-amber-400" aria-hidden="true" />
              <h2 className="font-semibold text-white">Mantenimiento</h2>
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
