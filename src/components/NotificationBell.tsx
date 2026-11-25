'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, X, Check, Info, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { markNotificationAsRead } from '@/app/actions/notifications';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string | null;
  isRead: boolean | null;
  createdAt: Date | string | null;
}

function formatNotificationTime(value: Date | string | null): string {
  if (value === null) return 'Fecha no disponible';
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
    : 'Fecha no disponible';
}

export function NotificationBell({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [isOpen, setIsOpen] = useState(false);
  // Keep local read acknowledgments, not a frozen copy of server props.
  // New notifications supplied by a refreshed layout must appear immediately.
  const [locallyReadIds, setLocallyReadIds] = useState<string[]>([]);
  const notifications = initialNotifications.map(n =>
    locallyReadIds.includes(n.id) ? { ...n, isRead: true } : n
  );
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen]);

  const handleMarkAsRead = async (id: string) => {
    // A ref guards against rapid double clicks before React can re-render.
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    setPendingIds([...pendingRef.current]);
    setError(null);

    try {
      const result = await markNotificationAsRead(id);
      if (result.success) {
        // Functional state update survives requests finishing out of order
        // without hiding new notifications received from server props.
        setLocallyReadIds(current =>
          current.includes(id) ? current : [...current, id]
        );
      } else {
        setError('No se pudo marcar la notificación como leída. Inténtalo de nuevo.');
      }
    } catch {
      // Do not display internal provider messages in the client UI.
      setError('No se pudo marcar la notificación como leída. Inténtalo de nuevo.');
    } finally {
      pendingRef.current.delete(id);
      setPendingIds([...pendingRef.current]);
    }
  };

  const getIcon = (type: string | null) => {
    switch (type) {
      case 'success': return <CheckCircle size={16} className="text-[var(--theme-success)]" aria-hidden="true" />;
      case 'warning': return <AlertTriangle size={16} className="text-[var(--theme-warning)]" aria-hidden="true" />;
      case 'error': return <X size={16} className="text-[var(--theme-danger)]" aria-hidden="true" />;
      default: return <Info size={16} className="text-[var(--theme-link)]" aria-hidden="true" />;
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setIsOpen(open => !open); setError(null); }}
        aria-label="Notificaciones"
        aria-expanded={isOpen}
        aria-controls="notification-panel"
        className="group relative rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-2 transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
      >
        <Bell size={20} aria-hidden="true" className={cn("text-[var(--text-secondary)] group-hover:text-[var(--foreground)] transition-colors", unreadCount > 0 && "animate-bounce")} />
        {unreadCount > 0 && (
          <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-4 h-4 px-0.5 bg-red-700 text-[10px] font-bold text-white flex items-center justify-center rounded-full border-2 border-[var(--theme-nav)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <button type="button" tabIndex={-1} aria-label="Cerrar notificaciones" className="fixed inset-0 z-40 cursor-default" onClick={() => setIsOpen(false)} />
          <div id="notification-panel" role="region" aria-label="Notificaciones recientes" className="absolute right-0 z-50 mt-4 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] text-[var(--foreground)] shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="p-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--theme-surface-muted)]">
              <h4 className="font-bold text-[var(--foreground)] text-sm">Notificaciones</h4>
              <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">{unreadCount} sin leer</span>
            </div>

            {error && (
              <p role="alert" className="px-4 py-3 border-b border-red-500/20 bg-red-500/10 text-xs text-[var(--theme-danger)]">
                {error}
              </p>
            )}

            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-[var(--text-tertiary)] text-xs">
                  No hay notificaciones.
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={cn(
                      "p-4 border-b border-[var(--border)] flex gap-3 hover:bg-[var(--theme-hover)] transition-colors relative",
                      !n.isRead && "bg-blue-500/5",
                    )}
                  >
                    <div className="mt-1">{getIcon(n.type)}</div>
                    <div className="flex-1 space-y-1">
                      <p className={cn("text-xs font-bold", !n.isRead ? "text-[var(--foreground)]" : "text-[var(--text-secondary)]")}>{n.title}</p>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{n.message}</p>
                      <p className="text-[10px] text-[var(--text-secondary)] uppercase mt-1">
                        {formatNotificationTime(n.createdAt)}
                      </p>
                    </div>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => void handleMarkAsRead(n.id)}
                        disabled={pendingIds.includes(n.id)}
                        aria-busy={pendingIds.includes(n.id)}
                        aria-label={`Marcar como leída: ${n.title}`}
                        className="p-1 hover:bg-[var(--theme-hover)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50 disabled:cursor-wait"
                      >
                        {pendingIds.includes(n.id)
                          ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                          : <Check size={14} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-3 bg-[var(--theme-surface-muted)] text-center border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[10px] font-bold text-[var(--theme-link)] hover:text-[var(--foreground)] transition-colors uppercase tracking-widest"
              >
                Cerrar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
