'use client';

import React, { useState } from 'react';
import { RotateCw, Loader2, Check } from 'lucide-react';
import { syncAllSupabaseUsers } from '@/app/actions/admin-users';

export function SyncUsersButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncedCount(null);
    try {
      const res = await syncAllSupabaseUsers();
      if (res.success) {
        setSyncedCount(res.syncedCount ?? 0);
        setTimeout(() => setSyncedCount(null), 4000);
      } else {
        alert(res.error || 'Error al sincronizar los usuarios.');
      }
    } catch {
      alert('Error inesperado al conectar con el servidor.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {syncedCount !== null && (
        <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-2xl animate-in fade-in slide-in-from-right-4 duration-300 flex items-center gap-1.5">
          <Check size={14} />
          {syncedCount === 0 
            ? 'No hubo perfiles nuevos ni cambios de rol' 
            : `Se actualizaron ${syncedCount} perfiles correctamente`}
        </span>
      )}

      <button
        onClick={handleSync}
        disabled={isSyncing}
        className="flex items-center gap-2.5 px-6 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-50"
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
