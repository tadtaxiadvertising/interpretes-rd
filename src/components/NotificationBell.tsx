'use client';

import React, { useRef, useState } from 'react';
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
  const date = new Date(value);
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
      case 'success': return <CheckCircle size={16} className="text-green-400" aria-hidden="true" />;
      case 'warning': return <AlertTriangle size={16} className="text-yellow-400" aria-hidden="true" />;
      case 'error': return <X size={16} className="text-red-400" aria-hidden="true" />;
      default: return <Info size={16} className="text-blue-400" aria-hidden="true" />;
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
        className="relative p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group"
      >
        <Bell size={20} aria-hidden="true" className={cn("text-gray-400 group-hover:text-white transition-colors", unreadCount > 0 && "animate-bounce")} />
        {unreadCount > 0 && (
          <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-4 h-4 px-0.5 bg-red-500 text-[10px] font-bold text-white flex items-center justify-center rounded-full border-2 border-[#0a0a0a]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <button type="button" tabIndex={-1} aria-label="Cerrar notificaciones" className="fixed inset-0 z-40 cursor-default" onClick={() => setIsOpen(false)} />
          <div id="notification-panel" role="region" aria-label="Notificaciones recientes" className="absolute right-0 mt-4 w-80 glass border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <h4 className="font-bold text-white text-sm">Notificaciones</h4>
              <span className="text-[10px] text-gray-500 uppercase tracking-widest">{unreadCount} sin leer</span>
            </div>

            {error && (
              <p role="alert" className="px-4 py-3 border-b border-red-500/20 bg-red-500/10 text-xs text-red-300">
                {error}
              </p>
            )}

            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-xs">
                  No hay notificaciones.
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={cn(
                      "p-4 border-b border-white/5 flex gap-3 hover:bg-white/[0.02] transition-colors relative",
                      !n.isRead && "bg-blue-500/5",
                    )}
                  >
                    <div className="mt-1">{getIcon(n.type)}</div>
                    <div className="flex-1 space-y-1">
                      <p className={cn("text-xs font-bold", !n.isRead ? "text-white" : "text-gray-400")}>{n.title}</p>
                      <p className="text-[10px] text-gray-500 leading-relaxed">{n.message}</p>
                      <p className="text-[9px] text-gray-600 uppercase mt-1">
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
                        className="p-1 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-wait"
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

            <div className="p-3 bg-white/[0.01] text-center border-t border-white/5">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest"
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
