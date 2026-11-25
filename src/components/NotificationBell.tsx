'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { notificationCategoryLabel, notificationSeverityLabel } from '@/lib/notifications/notification-display';
import { safeNotificationLink } from '@/lib/notifications/safe-notification-link';
import { Bell, X, Check, Info, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationHistory } from './NotificationHistory';
import { getMyNotifications, markNotificationAsRead, markAllNotificationsAsRead } from '@/app/actions/notifications';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string | null;
  isRead: boolean | null;
  createdAt: Date | string | null;
  category?: string | null;
  link?: string | null;
}

function formatNotificationTime(value: Date | string | null): string {
  if (value === null) return 'Fecha no disponible';
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('es-DO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Fecha no disponible';
}

export function NotificationBell({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [isOpen, setIsOpen] = useState(false);
  // Keep local read acknowledgments, not a frozen copy of server props.
  // New notifications supplied by a refreshed layout must appear immediately.
  const [locallyReadIds, setLocallyReadIds] = useState<string[]>([]);
  const [feed, setFeed] = useState<{ data: Notification[]; unreadCount: number; source: Notification[] } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const bulkRef = useRef(false);
  const generation = useRef(0);
  const requestRefresh = () => {
    generation.current += 1;
    setRefreshVersion(version => version + 1);
  };
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy || bulkRef.current || document.visibilityState === 'hidden') return;
      busy = true;
      const currentGeneration = generation.current;
      try {
        const result = await getMyNotifications();
        if (!active || currentGeneration !== generation.current) return;
        if (result.success) {
          setFeed({ data: result.data, unreadCount: result.unreadCount, source: initialNotifications });
          setRefreshFailed(false);
        } else setRefreshFailed(true);
      } catch {
        // Keep the last successful snapshot during transient failures.
        if (active && currentGeneration === generation.current) setRefreshFailed(true);
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [isOpen, initialNotifications, refreshVersion]);
  const snapshot = feed?.source === initialNotifications ? feed : null;
  const rawNotifications = snapshot?.data ?? initialNotifications;
  const notifications = rawNotifications.map(n =>
    locallyReadIds.includes(n.id) ? { ...n, isRead: true } : n
  );
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);

  const acknowledged = rawNotifications.filter(n => !n.isRead && locallyReadIds.includes(n.id)).length;
  const unreadCount = Math.max(0, (snapshot?.unreadCount ?? rawNotifications.filter(n => !n.isRead).length) - acknowledged);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const visibleNotifications = onlyUnread ? notifications.filter(n => !n.isRead) : notifications;

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setIsOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen]);

  const handleMarkAsRead = async (id: string) => {
    // A ref guards against rapid double clicks before React can re-render.
    if (bulkRef.current || pendingRef.current.has(id)) return;
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
        requestRefresh();
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

  const handleMarkAll = async () => {
    if (bulkRef.current || pendingRef.current.size || unreadCount === 0) return;
    bulkRef.current = true;
    generation.current += 1;
    setBulkPending(true);
    setError(null);
    try {
      const result = await markAllNotificationsAsRead();
      if (!result.success) {
        setError('No se pudieron marcar todas las notificaciones. Inténtalo de nuevo.');
        return;
      }
      setLocallyReadIds(current => [...new Set([...current, ...rawNotifications.map(n => n.id)])]);
      setFeed(current => current ? { ...current, unreadCount: 0, data: current.data.map(n => ({ ...n, isRead: true })) } : current);
    } catch {
      setError('No se pudieron marcar todas las notificaciones. Inténtalo de nuevo.');
    } finally {
      bulkRef.current = false;
      setBulkPending(false);
      requestRefresh();
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
        ref={triggerRef}
        aria-label="Notificaciones"
        aria-description={`${unreadCount} sin leer`}
        aria-expanded={isOpen}
        aria-controls="notification-panel"
        className="group relative rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-2 transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
      >
        <Bell size={20} aria-hidden="true" className={cn("text-[var(--text-secondary)] group-hover:text-[var(--foreground)] transition-colors", unreadCount > 0 && "text-[var(--theme-link)]")} />
        {unreadCount > 0 && (
          <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-4 h-4 px-0.5 bg-red-700 text-[10px] font-bold text-white flex items-center justify-center rounded-full border-2 border-[var(--theme-nav)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <button type="button" tabIndex={-1} aria-label="Cerrar notificaciones" className="fixed inset-0 z-40 cursor-default" onClick={() => setIsOpen(false)} />
          <div id="notification-panel" role="region" aria-label={showHistory ? "Historial de notificaciones" : "Notificaciones recientes"} className="fixed inset-x-3 top-[4.5rem] z-50 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96 flex max-h-[calc(100dvh-10rem-env(safe-area-inset-bottom))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] text-[var(--foreground)] shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="p-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--theme-surface-muted)]">
              <h4 className="font-bold text-[var(--foreground)] text-sm">{showHistory ? "Historial" : "Notificaciones"}</h4>
              <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">{unreadCount} sin leer</span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
              <div className="flex gap-1" role="group" aria-label="Filtrar notificaciones">
                <button type="button" aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)} className={cn("min-h-9 rounded-lg px-2 text-xs", !onlyUnread ? "bg-[var(--theme-hover)] font-bold" : "text-[var(--text-secondary)]")}>Todas</button>
                <button type="button" aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)} className={cn("min-h-9 rounded-lg px-2 text-xs", onlyUnread ? "bg-[var(--theme-hover)] font-bold" : "text-[var(--text-secondary)]")}>Sin leer</button>
              </div>
              <button type="button" disabled={!unreadCount || bulkPending || pendingIds.length > 0} aria-busy={bulkPending} onClick={() => void handleMarkAll()} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-[var(--theme-link)] disabled:opacity-50">{bulkPending ? 'Marcando…' : 'Marcar todas como leídas'}</button>
            </div>
            {refreshFailed && (
              <div role="status" className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--theme-warning)]">
                <span>No se pudo actualizar. Se muestran los últimos datos disponibles.</span>
                <button type="button" onClick={requestRefresh} className="min-h-9 font-semibold underline">Reintentar</button>
              </div>
            )}
            {error && (
              <p role="alert" className="px-4 py-3 border-b border-red-500/20 bg-red-500/10 text-xs text-[var(--theme-danger)]">
                {error}
              </p>
            )}

            {showHistory ? (
              <NotificationHistory key={onlyUnread ? 'unread' : 'all'} onlyUnread={onlyUnread} refreshVersion={refreshVersion} locallyReadIds={locallyReadIds} pendingIds={pendingIds} bulkPending={bulkPending} onRead={handleMarkAsRead} onNavigate={() => setIsOpen(false)} />
            ) : (
            <div className="min-h-0 max-h-[400px] flex-1 overflow-y-auto overscroll-contain">
              {visibleNotifications.length === 0 ? (
                <div className="p-8 text-center text-[var(--text-tertiary)] text-xs">
                  {onlyUnread ? 'No hay notificaciones recientes sin leer.' : 'No hay notificaciones.'}
                </div>
              ) : (
                visibleNotifications.map(n => (
                  <div
                    key={n.id}
                    className={cn(
                      "p-4 border-b border-[var(--border)] flex gap-3 hover:bg-[var(--theme-hover)] transition-colors relative",
                      !n.isRead && "bg-blue-500/5",
                    )}
                  >
                    <div className="mt-1">{getIcon(n.type)}</div>
                    <div className="min-w-0 flex-1 space-y-1 break-words">
                      <p className={cn("text-xs font-bold", !n.isRead ? "text-[var(--foreground)]" : "text-[var(--text-secondary)]")}>{n.title}</p>
                      <p className="flex flex-wrap gap-x-2 text-[11px] text-[var(--text-secondary)]">
                        <span>{notificationCategoryLabel(n.category)}</span>
                        <span className={cn(n.type === 'error' && 'font-semibold text-[var(--theme-danger)]', n.type === 'warning' && 'font-semibold text-[var(--theme-warning)]')}>{notificationSeverityLabel(n.type)}</span>
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{n.message}</p>
                      {safeNotificationLink(n.link) && <Link href={safeNotificationLink(n.link)!} prefetch={false} onClick={() => setIsOpen(false)} className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--theme-link)] underline">Ir al módulo<span className="sr-only">: {n.title}</span></Link>}
                      <p className="text-[10px] text-[var(--text-secondary)] uppercase mt-1">
                        {formatNotificationTime(n.createdAt)}
                      </p>
                    </div>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => void handleMarkAsRead(n.id)}
                        disabled={bulkPending || pendingIds.includes(n.id)}
                        aria-busy={pendingIds.includes(n.id)}
                        aria-label={`Marcar como leída: ${n.title}`}
                        className="min-h-11 min-w-11 self-start flex items-center justify-center p-1 hover:bg-[var(--theme-hover)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50 disabled:cursor-wait"
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

            )}
            <div className="shrink-0 p-3 bg-[var(--theme-surface-muted)] border-t border-[var(--border)]">
              {!showHistory && <p className="mb-1 text-center text-xs text-[var(--text-secondary)]">Últimas 10 notificaciones</p>}
              <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setShowHistory(value => !value)} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-[var(--theme-link)] hover:bg-[var(--theme-hover)]">{showHistory ? 'Volver a recientes' : 'Ver historial completo'}</button>
              <button
                type="button"
                onClick={() => { setIsOpen(false); triggerRef.current?.focus(); }}
                className="text-[10px] font-bold text-[var(--theme-link)] hover:text-[var(--foreground)] transition-colors uppercase tracking-widest"
              >
                Cerrar
              </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
