import RealTimeMonitor from '@/components/admin/RealTimeMonitor';
import AlertBanner from '@/components/admin/AlertBanner';

export const dynamic = 'force-dynamic';

export default function MonitoringPage() {
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Page Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] tracking-tight flex items-center gap-3">
            <span className="w-3 h-3 shrink-0 rounded-full bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/30" />
            Intérpretes en Vivo
          </h1>
          <p className="text-[var(--text-secondary)] mt-1.5 sm:ml-6">
            Monitoreo en tiempo real con estados inteligentes y sesiones activas
          </p>
        </div>
        <AlertBanner autoDetect={true} />
      </header>

      {/* Main Monitor */}
      <RealTimeMonitor />
    </div>
  );
}