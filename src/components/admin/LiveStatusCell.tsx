'use client';

import { usePresenceFeed, InterpreterPresence } from '@/lib/hooks/usePresenceFeed';
import StatusBadge from '@/components/StatusBadge';

interface Props {
  interpreterId: number;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function LiveStatusCell({ interpreterId }: Props) {
  const { getInterpreter, error } = usePresenceFeed();
  const data: InterpreterPresence | undefined = getInterpreter(interpreterId);

  if (error) {
    return <span className="text-[10px] text-[var(--text-tertiary)] italic">—</span>;
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full bg-[var(--theme-track)] animate-pulse" />
        <span className="text-[10px] text-[var(--text-tertiary)]">cargando...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <StatusBadge
        status={data.realtimeStatus}
        statusReason={data.statusReason}
        lastHeartbeat={data.lastHeartbeat}
        statusChangedAt={data.statusChangedAt}
        size="sm"
        showTime={true}
      />
      {data.lastHeartbeat && (
        <span className="text-[10px] text-[var(--text-tertiary)] font-mono tabular-nums">
          {formatTimeAgo(data.lastHeartbeat)}
        </span>
      )}
    </div>
  );
}
