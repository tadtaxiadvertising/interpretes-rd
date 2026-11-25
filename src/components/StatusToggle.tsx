'use client';

import React from 'react';
import { Wifi, WifiOff, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';

const statusConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  Online:  { label: 'Online',  color: 'text-[var(--theme-success)]',  bgColor: 'bg-[var(--theme-surface-muted)] border-[var(--border)]', icon: Wifi },
  Offline: { label: 'Offline', color: 'text-[var(--text-secondary)]',   bgColor: 'bg-[var(--theme-surface-muted)] border-[var(--border)]',  icon: WifiOff },
  Busy:    { label: 'Busy',    color: 'text-[var(--theme-warning)]', bgColor: 'bg-[var(--theme-surface-muted)] border-[var(--border)]', icon: Phone },
};

interface StatusToggleProps {
  currentStatus: string;
}

export function StatusToggle({ currentStatus }: StatusToggleProps) {
  // Validamos el estado para evitar fallos si viene algo inesperado
  const statusKey = Object.keys(statusConfig).includes(currentStatus) ? currentStatus : 'Offline';
  const current = statusConfig[statusKey];
  const CurrentIcon = current.icon;

  return (
    <div className="flex items-center gap-3">
      {/* Indicador de estado automático (solo lectura) */}
      <div className={cn('flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all', current.bgColor, current.color)}>
        <span aria-hidden="true" className={cn('w-2 h-2 shrink-0 rounded-full bg-current', statusKey !== 'Offline' && 'motion-safe:animate-pulse')} />
        <CurrentIcon size={14} aria-hidden="true" />
        {current.label}
      </div>
    </div>
  );
}
