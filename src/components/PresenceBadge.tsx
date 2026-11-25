'use client';

import { cn } from '@/lib/utils';
import { usePresenceContext } from '@/contexts/PresenceContext';

export function PresenceBadge() {
  const presence = usePresenceContext();

  if (presence === 'loading') {
    return (
      <div className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium',
        'bg-[var(--theme-surface-muted)] border-[var(--border)] text-[var(--text-secondary)]',
        'transition-colors'
      )}>
        <span aria-hidden="true" className="w-2 h-2 shrink-0 rounded-full bg-current" />
        Detectando…
      </div>
    );
  }

  if (presence === 'online') {
    return (
      <div className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium',
        'bg-[var(--theme-surface-muted)] border-[var(--border)] text-[var(--theme-success)]',
        'transition-all'
      )}>
        <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
        Online
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium',
      'bg-[var(--theme-surface-muted)] border-[var(--border)] text-[var(--text-secondary)]',
      'transition-all'
    )}>
      <span aria-hidden="true" className="w-2 h-2 shrink-0 rounded-full bg-current" />
      Offline
    </div>
  );
}
