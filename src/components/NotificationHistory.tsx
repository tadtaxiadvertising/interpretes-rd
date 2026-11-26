'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { notificationCategories, notificationCategoryLabel, notificationSeverityLabel, type NotificationCategory } from '@/lib/notifications/notification-display';
import { safeNotificationLink } from '@/lib/notifications/safe-notification-link';
import type { HistoryCursor } from '@/lib/notifications/history-cursor';
import { HistorySearchFiltersSchema, type HistorySearchFilters } from '@/lib/notifications/history-search-filters';
import { getMyNotificationHistory } from '@/app/actions/notifications';

type HistoryItem = {
  id: string;
  title: string;
  message: string;
  type: string | null;
  isRead: boolean | null;
  createdAt: Date | string | null;
  link: string | null;
  category?: string | null;
};

interface Props {
  onlyUnread: boolean;
  candidateOnly?: boolean;
  refreshVersion: number;
  locallyReadIds: string[];
  pendingIds: string[];
  bulkPending: boolean;
  onRead: (id: string) => Promise<void>;
  onNavigate: () => void;
}

export function NotificationHistory({ onlyUnread, candidateOnly = false, refreshVersion, locallyReadIds, pendingIds, bulkPending, onRead, onNavigate }: Props) {
  const [cursors, setCursors] = useState<(HistoryCursor | null)[]>([null]);
  const page = cursors.length - 1;
  const after = cursors[page];
  const [category, setCategory] = useState<NotificationCategory | ''>('');
  const [importantOnly, setImportantOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [draft, setDraft] = useState({ search: '', fromDate: '', toDate: '' });
  const [searchFilters, setSearchFilters] = useState<HistorySearchFilters>({});
  const [filterError, setFilterError] = useState(false);
  const hasSearch = Boolean(searchFilters.search || searchFilters.fromDate || searchFilters.toDate);
  const filterKey = JSON.stringify([category, importantOnly, onlyUnread, searchFilters]);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ page: number; version: number; retry: number; filterKey: string; data: HistoryItem[]; nextCursor: HistoryCursor | null; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await getMyNotificationHistory({ page, after, unreadOnly: onlyUnread, ...(category ? { category } : {}), ...(importantOnly ? { importantOnly: true } : {}), ...(hasSearch ? { searchFilters } : {}) });
        if (!active) return;
        if (response.success) {
          if (page > 0 && response.data.length === 0) {
            setCursors(current => current.length > 1 ? current.slice(0, -1) : current);
            return;
          }
          setResult({ page, version: refreshVersion, retry, filterKey, data: response.data, nextCursor: 'nextCursor' in response ? response.nextCursor ?? null : null, failed: false });
          return;
        }
      } catch {
        // Never expose provider errors.
      }
      if (active) setResult({ page, version: refreshVersion, retry, filterKey, data: [], nextCursor: null, failed: true });
    };
    void load();
    return () => { active = false; };
  }, [page, after, onlyUnread, refreshVersion, retry, category, importantOnly, filterKey, hasSearch, searchFilters]);

  const current = result?.page === page && result.version === refreshVersion && result.retry === retry && result.filterKey === filterKey ? result : null;
  const items = (current?.data ?? []).filter(item => !onlyUnread || (!item.isRead && !locallyReadIds.includes(item.id)));
  return (
    <div className="flex min-h-36 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] p-3">
        {!candidateOnly && <label className="min-w-0 flex-1 text-xs text-[var(--text-secondary)]">Categoría
          <select value={category} onChange={e => { setCategory(e.target.value as NotificationCategory | ''); setCursors([null]); }} className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--theme-panel)] px-2 text-xs text-[var(--foreground)]">
            <option value="">Todas las categorías</option>
            {notificationCategories.map(value => <option key={value} value={value}>{notificationCategoryLabel(value)}</option>)}
          </select>
        </label>}
        <label className="flex min-h-11 items-center gap-2 text-xs">
          <input type="checkbox" checked={importantOnly} onChange={e => { setImportantOnly(e.target.checked); setCursors([null]); }} />
          Solo importantes
        </label>
      </div>
      <div className="shrink-0 border-b border-[var(--border)] px-3 py-1">
        <button type="button" aria-expanded={searchOpen} onClick={() => setSearchOpen(open => !open)} className="min-h-11 text-sm font-semibold text-[var(--theme-link)] focus-visible:outline-2 focus-visible:outline-[var(--theme-focus)]">Buscar y filtrar por fecha{hasSearch ? ' · activos' : ''}</button>
        {searchOpen && <form className="max-h-[min(19rem,45dvh)] overflow-y-auto space-y-2 pb-3" onSubmit={event => {
          event.preventDefault();
          const parsed = HistorySearchFiltersSchema.safeParse({ ...(draft.search.trim() ? { search: draft.search.trim() } : {}), ...(draft.fromDate ? { fromDate: draft.fromDate } : {}), ...(draft.toDate ? { toDate: draft.toDate } : {}) });
          setFilterError(!parsed.success);
          if (!parsed.success) return;
          setSearchFilters(parsed.data);
          setCursors([null]);
        }}>
          <label className="block text-xs text-[var(--text-secondary)]">Buscar por título o contenido
            <input type="search" value={draft.search} maxLength={80} onChange={event => { setDraft(current => ({ ...current, search: event.target.value })); setFilterError(false); }} className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 text-sm text-[var(--foreground)]" />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="min-w-0 text-xs text-[var(--text-secondary)]">Desde
              <input type="date" value={draft.fromDate} min="1900-01-01" max="9999-12-31" onChange={event => { setDraft(current => ({ ...current, fromDate: event.target.value })); setFilterError(false); }} className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 text-sm text-[var(--foreground)]" />
            </label>
            <label className="min-w-0 text-xs text-[var(--text-secondary)]">Hasta
              <input type="date" value={draft.toDate} min="1900-01-01" max="9999-12-31" onChange={event => { setDraft(current => ({ ...current, toDate: event.target.value })); setFilterError(false); }} className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 text-sm text-[var(--foreground)]" />
            </label>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">Escribe entre 2 y 80 caracteres. Fechas inclusivas, hora de República Dominicana. Los avisos sin fecha no coinciden con un filtro de fecha.</p>
          {filterError && <p role="alert" className="text-xs text-[var(--theme-danger)]">Comprueba el texto y las fechas: la fecha inicial no puede ser posterior a la final.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="min-h-11 rounded-lg border border-[var(--theme-control-border)] px-3 text-xs font-semibold text-[var(--theme-link)]">Aplicar filtros</button>
            <button type="button" onClick={() => { setDraft({ search: '', fromDate: '', toDate: '' }); setFilterError(false); if (hasSearch) { setSearchFilters({}); setCursors([null]); } }} className="min-h-11 px-3 text-xs text-[var(--theme-link)]">Limpiar búsqueda y fechas</button>
          </div>
        </form>}
        {hasSearch && <p className="pb-2 break-words text-xs text-[var(--text-secondary)]">Filtros aplicados: {searchFilters.search ? '«' + searchFilters.search + '» ' : ''}{searchFilters.fromDate ? 'Desde ' + searchFilters.fromDate + ' ' : ''}{searchFilters.toDate ? 'Hasta ' + searchFilters.toDate : ''}</p>}
      </div>
      <div className="min-h-24 max-h-[400px] flex-1 overflow-y-auto overscroll-contain" aria-busy={!current}>
        {!current ? <p role="status" className="p-5 text-center text-sm text-[var(--text-secondary)]">Cargando historial…</p> :
          current.failed ? <div className="p-5 text-center text-sm"><p role="alert">No se pudo cargar el historial.</p><button type="button" className="min-h-11 text-[var(--theme-link)] underline" onClick={() => setRetry(n => n + 1)}>Reintentar historial</button></div> :
          items.length === 0 ? <p className="p-5 text-center text-sm text-[var(--text-secondary)]">{onlyUnread ? 'No hay notificaciones sin leer en esta página.' : 'No hay notificaciones en esta página.'}</p> :
          items.map(item => {
            const read = item.isRead || locallyReadIds.includes(item.id);
            const date = item.createdAt instanceof Date ? item.createdAt : item.createdAt ? new Date(item.createdAt) : null;
            return <article key={item.id} className={`border-b border-[var(--border)] p-4 text-sm ${read ? '' : 'bg-blue-500/5'}`}>
              <div className="flex items-start justify-between gap-2">
                <h5 className="min-w-0 break-words font-semibold">{item.title}</h5>
                <span className="shrink-0 text-xs text-[var(--text-secondary)]">{read ? 'Leída' : 'Sin leer'}</span>
              </div>
              <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[var(--text-secondary)]"><span>{notificationCategoryLabel(item.category)}</span><span className={item.type === 'error' ? 'font-semibold text-[var(--theme-danger)]' : item.type === 'warning' ? 'font-semibold text-[var(--theme-warning)]' : ''}>{notificationSeverityLabel(item.type)}</span></p>
              <p className="mt-1 break-words text-sm text-[var(--text-secondary)]">{item.message}</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{date && Number.isFinite(date.getTime()) ? date.toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' }) : 'Fecha no disponible'}</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {safeNotificationLink(item.link) && <Link href={safeNotificationLink(item.link)!} prefetch={false} onClick={onNavigate} className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--theme-link)] underline">Ir al módulo<span className="sr-only">: {item.title}</span></Link>}
                {!read && <button type="button" disabled={bulkPending || pendingIds.includes(item.id)} onClick={() => void onRead(item.id)} aria-busy={pendingIds.includes(item.id)} className="min-h-11 text-xs font-semibold text-[var(--theme-link)] disabled:opacity-50">Marcar como leída<span className="sr-only">: {item.title}</span></button>}
              </div>
            </article>;
          })}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-1">
        <button type="button" disabled={!page || !current} onClick={() => setCursors(previous => previous.length === page + 1 && previous.length > 1 ? previous.slice(0, -1) : previous)} className="min-h-11 px-2 text-xs text-[var(--theme-link)] disabled:opacity-50">Anterior</button>
        <span className="text-xs text-[var(--text-secondary)]">Página {page + 1}</span>
        <button type="button" disabled={!current?.nextCursor || current.failed || page >= 100000} onClick={() => { if (current?.nextCursor) setCursors(previous => previous.length === page + 1 ? [...previous, current.nextCursor] : previous); }} className="min-h-11 px-2 text-xs text-[var(--theme-link)] disabled:opacity-50">Siguiente</button>
      </div>
    </div>
  );
}
