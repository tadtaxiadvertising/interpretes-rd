'use client';

import React, { useRef, useState } from 'react';
import { RotateCw, Loader2, Check } from 'lucide-react';
import { syncAllSupabaseUsers } from '@/app/actions/admin-users';

export function SyncUsersButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const syncing = useRef(false);

  const handleSync = async () => {
    if (syncing.current) return;
    syncing.current = true;
    setIsSyncing(true);
    setError(null);
    setSyncedCount(null);
    try {
      const res = await syncAllSupabaseUsers();
      if (res.success) {
        setSyncedCount(res.syncedCount ?? 0);
      } else {
        setError('No se pudo completar la sincronización de usuarios. Revisa el estado antes de reintentar.');
      }
    } catch {
      setError('No se pudo confirmar la sincronización. Revisa el estado antes de reintentar.');
    } finally {
      syncing.current = false;
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {syncedCount !== null && (
        <span role="status" className="text-sm font-semibold text-[var(--theme-success)] bg-[var(--theme-surface-muted)] border border-[var(--theme-control-border)] px-3 py-2 rounded-xl flex items-center gap-1.5">
          <Check size={14} aria-hidden="true" />
          {syncedCount === 0 
            ? 'No hubo perfiles nuevos ni cambios de rol' 
            : `Se actualizaron ${syncedCount} perfiles correctamente`}
        </span>
      )}

      {error && <p role="alert" className="w-full rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-surface-muted)] p-3 text-sm text-[var(--theme-danger)]">{error}</p>}
      <button
        type="button"
        aria-busy={isSyncing}
        onClick={handleSync}
        disabled={isSyncing}
        className="theme-action-primary flex min-h-11 items-center gap-2.5 px-4 py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-50"
      >
        {isSyncing ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <RotateCw className="group-hover:rotate-180 transition-transform duration-700" size={16} />
        )}
        {isSyncing ? 'Sincronizando...' : 'Sincronizar Supabase'}
      </button>
    </div>
  );
}
