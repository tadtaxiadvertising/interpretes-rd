'use client';

import Link from 'next/link';
import { usePresenceFeed } from '@/lib/hooks/usePresenceFeed';
import StatusBadge from '@/components/StatusBadge';
import { Users, ArrowRight, Wifi, Phone, Coffee, WifiOff } from 'lucide-react';

export default function LiveRosterPanel() {
  const { byId } = usePresenceFeed();
  const interpreters = Array.from(byId.values());

  const online = interpreters.filter(i => i.realtimeStatus === 'Online').length;
  const busy = interpreters.filter(i => i.realtimeStatus === 'Busy').length;
  const away = interpreters.filter(i => i.realtimeStatus === 'Away').length;

  // Show top 5 online/busy first, then away
  const priority = ['Online', 'Busy', 'Away', 'Offline'];
  const sorted = [...interpreters].sort((a, b) => {
    const pa = priority.indexOf(a.realtimeStatus || 'Offline');
    const pb = priority.indexOf(b.realtimeStatus || 'Offline');
    return pa - pb;
  }).slice(0, 5);

  return (
    <div className="glass p-5 rounded-3xl border border-[var(--border)] bg-[var(--theme-panel)]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
          <Users className="text-[var(--theme-link)]" size={20} />
          Intérpretes en Vivo
        </h3>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1 text-[var(--theme-success)]">
            <Wifi size={10} /> {online}
          </span>
          <span className="flex items-center gap-1 text-[var(--theme-warning)]">
            <Phone size={10} /> {busy}
          </span>
          <span className="flex items-center gap-1 text-[var(--theme-away)]">
            <Coffee size={10} className="inline" /> {away}
          </span>
        </div>
      </div>

      <div className="space-y-1.5 mb-4">
        {sorted.length === 0 && (
          <p className="text-xs text-[var(--text-tertiary)] text-center py-4">Cargando...</p>
        )}
        {sorted.map((i) => (
          <div
            key={i.id}
            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--theme-surface-muted)] hover:bg-[var(--theme-hover)] transition-colors"
          >
            <span className="text-sm text-[var(--foreground)] truncate max-w-[140px]">
              {i.name}
            </span>
            <StatusBadge status={i.realtimeStatus} size="sm" showTime={false} />
          </div>
        ))}
      </div>

      <Link
        href="/admin/monitoring"
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl theme-action-secondary text-sm font-medium transition-all"
      >
        Ver todos los intérpretes
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}