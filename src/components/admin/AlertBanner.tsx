'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAlerts, dismissAlert, dismissAllAlerts, detectAnomalies } from '@/app/actions/alerts';
import type { Alert } from '@/app/actions/alerts';
import {
  AlertTriangle, AlertCircle, Info, X, RefreshCw,
  Bell, BellOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ALERT_ICONS: Record<string, React.ReactNode> = {
  critical: <AlertTriangle size={16} />,
  warning: <AlertCircle size={16} />,
  info: <Info size={16} />,
};

const ALERT_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  critical: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    text: 'text-[var(--theme-danger)]',
    icon: 'text-[var(--theme-danger)]',
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    text: 'text-[var(--theme-warning)]',
    icon: 'text-[var(--theme-warning)]',
  },
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    text: 'text-[var(--theme-link)]',
    icon: 'text-[var(--theme-link)]',
  },
};

function formatTime(iso: Date | string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin}min`;
  if (diffMin < 1440) return `hace ${Math.floor(diffMin / 60)}h`;
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface AlertBannerProps {
  /** If true, runs anomaly detection on mount */
  autoDetect?: boolean;
  /** If true, collapsed by default (just shows bell with count) */
  collapsed?: boolean;
}

export default function AlertBanner({ autoDetect = true, collapsed: initialCollapsed = true }: AlertBannerProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [isScanning, setIsScanning] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const result = await getAlerts(false, 50);
      if (result.success && result.data) {
        setAlerts(result.data);
      }
    } catch {
      // Silent fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runAnomalyDetection = useCallback(async () => {
    setIsScanning(true);
    try {
      await detectAnomalies();
      await fetchAlerts(); // Refresh alerts after detection
    } catch {
      // Silent fail
    } finally {
      setIsScanning(false);
    }
  }, [fetchAlerts]);

  // Initial fetch + optional anomaly detection
  useEffect(() => {
    fetchAlerts();
    if (autoDetect) {
      const timer = setTimeout(() => runAnomalyDetection(), 2000);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh alerts every 60s
  useEffect(() => {
    const interval = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const criticalCount = alerts.filter((a) => a.type === 'critical').length;
  const totalCount = alerts.length;

  const handleDismiss = async (id: string) => {
    await dismissAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleDismissAll = async () => {
    await dismissAllAlerts();
    setAlerts([]);
  };

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full px-4 py-3 shadow-2xl border transition-all hover:scale-105',
          criticalCount > 0
            ? 'bg-red-500/20 border-red-500/30 text-[var(--theme-danger)]'
            : totalCount > 0
              ? 'bg-amber-500/20 border-amber-500/30 text-[var(--theme-warning)]'
              : 'bg-[var(--theme-surface-muted)] border-[var(--border)] text-[var(--text-secondary)]'
        )}
      >
        {totalCount > 0 ? (
          <>
            <Bell size={18} className={cn(criticalCount > 0 && 'animate-pulse')} />
            <span className="font-bold text-sm">
              {criticalCount > 0 ? `${criticalCount} críticas` : `${totalCount} alertas`}
            </span>
          </>
        ) : (
          <>
            <BellOff size={18} />
            <span className="text-xs font-medium">Sin alertas</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className={cn(
      'fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-2xl border shadow-2xl backdrop-blur-xl overflow-hidden transition-all',
      'bg-[var(--theme-panel)] border-[var(--border)]'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Bell size={16} className={cn(criticalCount > 0 ? 'text-[var(--theme-danger)]' : 'text-[var(--text-secondary)]')} />
          <span className="text-sm font-bold text-[var(--foreground)]">
            Alertas {totalCount > 0 && `(${totalCount})`}
          </span>
          {criticalCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-[var(--theme-danger)] text-[10px] font-bold">
              {criticalCount} crítica{criticalCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={runAnomalyDetection}
            disabled={isScanning}
            className="p-1.5 rounded-lg hover:bg-[var(--theme-hover)] text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
            title="Escanear anomalías"
          >
            <RefreshCw size={14} className={cn(isScanning && 'animate-spin')} />
          </button>
          {totalCount > 0 && (
            <button
              onClick={handleDismissAll}
              className="p-1.5 rounded-lg hover:bg-[var(--theme-hover)] text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors text-xs"
              title="Descartar todas"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 rounded-lg hover:bg-[var(--theme-hover)] text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors"
          >
            <BellOff size={14} />
          </button>
        </div>
      </div>

      {/* Alerts list */}
      <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border)]">
        {isLoading ? (
          <div className="p-6 text-center">
            <div className="animate-pulse space-y-3">
              <div className="h-4 w-3/4 rounded bg-[var(--theme-surface-muted)] mx-auto" />
              <div className="h-3 w-1/2 rounded bg-[var(--theme-surface-muted)] mx-auto" />
            </div>
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center">
            <BellOff size={24} className="mx-auto text-[var(--text-tertiary)] mb-2" />
            <p className="text-sm text-[var(--text-tertiary)]">No hay alertas activas</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">El sistema monitorea automáticamente</p>
          </div>
        ) : (
          alerts.map((alert) => {
            const style = ALERT_STYLES[alert.type] || ALERT_STYLES.info;
            return (
              <div key={alert.id} className={cn('px-4 py-3 hover:bg-[var(--theme-hover)] transition-colors group relative', style.bg)}>
                <div className="flex items-start gap-3">
                  <div className={cn('mt-0.5 flex-shrink-0', style.icon)}>
                    {ALERT_ICONS[alert.type] || <Info size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-semibold', style.text)}>{alert.title}</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">{alert.message}</p>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{formatTime(alert.createdAt)}</p>
                  </div>
                  <button
                    onClick={() => handleDismiss(alert.id)}
                    className="p-1 rounded hover:bg-[var(--theme-hover)] text-[var(--text-tertiary)] hover:text-[var(--foreground)] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-all flex-shrink-0"
                    title="Descartar"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}