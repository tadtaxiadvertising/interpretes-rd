'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Clock, Wifi, WifiOff, Phone, Coffee } from 'lucide-react';

interface StatusBadgeProps {
  status: string | null | undefined;
  statusReason?: string | null;
  lastHeartbeat?: string | Date | null;
  statusChangedAt?: string | Date | null;
  showIcon?: boolean;
  showTime?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  bg: string;
  dot: string;
  icon: React.ReactNode;
}> = {
  Online: {
    label: 'Online',
    color: 'text-[var(--theme-success)]',
    bg: 'bg-[var(--theme-surface-muted)] border-[var(--border)]',
    dot: 'bg-current',
    icon: <Wifi size={14} />,
  },
  Busy: {
    label: 'Busy',
    color: 'text-[var(--theme-warning)]',
    bg: 'bg-[var(--theme-surface-muted)] border-[var(--border)]',
    dot: 'bg-current',
    icon: <Phone size={14} />,
  },
  Away: {
    label: 'Ausente',
    color: 'text-[var(--theme-away)]',
    bg: 'bg-[var(--theme-surface-muted)] border-[var(--border)]',
    dot: 'bg-current',
    icon: <Coffee size={14} />,
  },
  Offline: {
    label: 'Offline',
    color: 'text-[var(--text-secondary)]',
    bg: 'bg-[var(--theme-surface-muted)] border-[var(--border)]',
    dot: 'bg-current',
    icon: <WifiOff size={14} />,
  },
};

const SIZE_CLASSES = {
  sm: { badge: 'px-2 py-0.5 text-[10px] gap-1', dot: 'w-1.5 h-1.5', icon: 'hidden' },
  md: { badge: 'px-2.5 py-1 text-xs gap-1.5', dot: 'w-2 h-2', icon: '' },
  lg: { badge: 'px-3 py-1.5 text-sm gap-2', dot: 'w-2.5 h-2.5', icon: '' },
};

function formatTimeAgo(date: string | Date | null | undefined): string {
  if (!date) return '';
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}min`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

function getTimeDescription(date: string | Date | null | undefined, status: string): string {
  if (!date) return '';
  const label = status === 'Offline' ? 'desconectado' : 'activo';
  return `${label} hace ${formatTimeAgo(date)}`;
}

export default function StatusBadge({
  status,
  statusReason,
  lastHeartbeat,
  statusChangedAt,
  showIcon = true,
  showTime = true,
  size = 'md',
  className,
}: StatusBadgeProps) {
  const normalizedStatus = status && Object.prototype.hasOwnProperty.call(STATUS_CONFIG, status) ? status : 'Offline';
  const config = STATUS_CONFIG[normalizedStatus];
  const sizes = SIZE_CLASSES[size];

  const timeToShow = normalizedStatus === 'Offline' ? statusChangedAt : lastHeartbeat;
  const timeLabel = showTime ? getTimeDescription(timeToShow, normalizedStatus) : '';
  const reasonLabel = statusReason && statusReason !== 'initial'
    ? statusReason.replace(/_/g, ' ')
    : '';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium transition-all backdrop-blur-sm',
        config.bg,
        config.color,
        sizes.badge,
        size === 'lg' && 'shadow-sm',
        className
      )}
      title={`${config.label}${reasonLabel ? ` — ${reasonLabel}` : ''}${timeLabel ? ` — ${timeLabel}` : ''}`}
    >
      {/* Animated dot */}
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 rounded-full',
          normalizedStatus !== 'Offline' && 'motion-safe:animate-pulse',
          config.dot,
          sizes.dot
        )}
      />

      {/* Icon */}
      {showIcon && size !== 'sm' && (
        <span aria-hidden="true" className={cn('shrink-0', sizes.icon)}>
          {config.icon}
        </span>
      )}

      {/* Label */}
      <span className="font-semibold">
        {config.label}
      </span>

      {/* Time */}
      {showTime && timeToShow && size !== 'sm' && (
        <span className="text-[var(--text-secondary)] flex items-center gap-0.5 ml-0.5 font-normal">
          <Clock size={10} aria-hidden="true" />
          {formatTimeAgo(timeToShow)}
        </span>
      )}
    </span>
  );
}