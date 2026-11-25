'use client';

import { useEffect, useState, useTransition, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getWorkdayRosterAction, getLiveRosterAction } from '@/app/actions/monitoring';
import type { WorkdayInterpreter } from '@/app/actions/monitoring';
import type { MonitoredInterpreter } from '@/lib/validators/monitoring';
import type { RealtimeChannel, REALTIME_SUBSCRIBE_STATES } from '@supabase/realtime-js';
import StatusBadge from '@/components/StatusBadge';
import StatusTimeline from '@/components/admin/StatusTimeline';
import {
  Search, Filter, Users, Wifi, WifiOff, ShieldCheck,
  Phone, Coffee, Activity, RefreshCw, Clock, Hash,
  TrendingUp, TrendingDown, Minus, MoreHorizontal,
  Timer, AlertTriangle, CalendarDays, LogIn, LogOut,
  PhoneCall, Target, BarChart3, PlayCircle, PauseCircle,
  Hourglass,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'Online', label: '🟢 Online', color: 'text-[var(--theme-success)]' },
  { value: 'Busy', label: '🟡 En llamada', color: 'text-[var(--theme-warning)]' },
  { value: 'Away', label: '🟠 Ausente', color: 'text-[var(--theme-away)]' },
  { value: 'Offline', label: '🔴 Offline', color: 'text-[var(--text-secondary)]' },
];

interface PresenceTrackPayload {
  interpreterId: number;
  user_email: string;
  online_at: string;
}

type TelemetryStatus = 'connected' | 'disconnected' | 'connecting';

// Session tracker for Busy interpreters
interface SessionTracker {
  [interpreterId: number]: {
    startedAt: number;
    accumulated: number;
  };
}

// Workday status config
const WORKDAY_STATUS_CONFIG: Record<string, {
  label: string;
  icon: any;
  color: string;
  bg: string;
  border: string;
}> = {
  'En llamada': {
    label: 'En llamada',
    icon: PhoneCall,
    color: 'text-[var(--theme-warning)]',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  'Activo': {
    label: 'Activo',
    icon: PlayCircle,
    color: 'text-[var(--theme-success)]',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  'Disponible': {
    label: 'Disponible',
    icon: Wifi,
    color: 'text-[var(--theme-link)]',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  'En pausa': {
    label: 'En pausa',
    icon: PauseCircle,
    color: 'text-[var(--theme-away)]',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
  },
  'Desconectado (laboró)': {
    label: 'Desconectado',
    icon: LogOut,
    color: 'text-[var(--text-secondary)]',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/20',
  },
  'Online sin registro': {
    label: 'Online sin registro',
    icon: AlertTriangle,
    color: 'text-[var(--theme-warning)]',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
  },
  'Sin actividad hoy': {
    label: 'Sin actividad',
    icon: Hourglass,
    color: 'text-[var(--text-tertiary)]',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/20',
  },
};

function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatHours(decimalHours: number): string {
  if (decimalHours === 0) return '0h';
  const h = Math.floor(decimalHours);
  const m = Math.round((decimalHours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const now = Date.now();
  const then = new Date(date).getTime();
  if (isNaN(then)) return '—';
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'ahora';
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)}min`;
  if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)}h`;
  return `hace ${Math.floor(diffSec / 86400)}d`;
}

function formatReason(reason: string | null | undefined): string {
  if (!reason || reason === 'initial') return '—';
  return reason.replace(/_/g, ' ');
}

export default function RealTimeMonitor() {
  // Core data
  const [workdayRoster, setWorkdayRoster] = useState<WorkdayInterpreter[]>([]);
  const [liveRoster, setLiveRoster] = useState<MonitoredInterpreter[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<number>>(new Set());
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryStatus>('connecting');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [search, setSearch] = useState('');
  const [campaign, setCampaign] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [campaigns, setCampaigns] = useState<string[]>([]);

  // UI state
  const [selectedInterpreter, setSelectedInterpreter] = useState<WorkdayInterpreter | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Session tracking for Busy interpreters (real-time seconds counter)
  const [sessions, setSessions] = useState<SessionTracker>({});
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Session timer tick ──
  useEffect(() => {
    sessionTimerRef.current = setInterval(() => {
      setSessions((prev) => {
        const updated = { ...prev };
        for (const id of Object.keys(updated).map(Number)) {
          const interp = workdayRoster.find((i) => i.id === id);
          if (interp?.realtimeStatus !== 'Busy' && updated[id].accumulated >= 0) {
            // Pause accumulating when not busy
            const elapsed = Math.floor((Date.now() - updated[id].startedAt) / 1000);
            updated[id] = {
              ...updated[id],
              accumulated: updated[id].accumulated + elapsed,
              startedAt: Date.now(),
            };
          } else if (interp?.realtimeStatus === 'Busy') {
            // Reset start time to accumulate on next tick
            updated[id] = {
              ...updated[id],
              startedAt: Date.now(),
            };
          }
        }
        return updated;
      });
    }, 1000);
    return () => {
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    };
  }, [workdayRoster]);

  const getSessionDuration = useCallback(
    (interpreterId: number): number => {
      const session = sessions[interpreterId];
      if (!session) return 0;
      return session.accumulated;
    },
    [sessions]
  );

  // ── Fetch workday roster ──
  const fetchWorkdayRoster = useCallback(async () => {
    startTransition(async () => {
      try {
        const result = await getWorkdayRosterAction();
        if (result.success && result.data) {
          setWorkdayRoster(result.data);

          // Collect campaigns
          const uniqueCampaigns = [
            ...new Set(result.data.map((i) => i.campaign).filter(Boolean)),
          ] as string[];
          setCampaigns((prev) =>
            [...new Set([...prev, ...uniqueCampaigns])].sort()
          );
          setLastUpdated(new Date());
        }
      } finally {
        setIsInitialLoading(false);
      }
    });
  }, []);

  // ── Fetch live roster (for presence overlay) ──
  const fetchLiveRoster = useCallback(async () => {
    const result = await getLiveRosterAction({
      search: search || undefined,
      campaign: campaign || undefined,
      realtimeStatus: statusFilter || undefined,
    });
    if (result.success && result.data) {
      setLiveRoster(result.data);
    }
  }, [search, campaign, statusFilter]);

  // Initial load
  useEffect(() => {
    fetchWorkdayRoster();
    fetchLiveRoster();
  }, [fetchWorkdayRoster, fetchLiveRoster]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchWorkdayRoster();
      fetchLiveRoster();
    }, 15_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchWorkdayRoster, fetchLiveRoster]);

  // Supabase Presence
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    try {
      const client = createClient();
      if (!client) {
        setTelemetryStatus('disconnected');
        return;
      }
      channel = client.channel('room:dashboard_presence', {
        config: { presence: { key: 'admin-observer' } },
      });

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel!.presenceState();
        const ids = new Set<number>();
        for (const [, presences] of Object.entries(state)) {
          for (const p of presences as unknown as PresenceTrackPayload[]) {
            if (typeof p.interpreterId === 'number') {
              ids.add(p.interpreterId);
            }
          }
        }
        setOnlineIds(ids);
        setTelemetryStatus('connected');
      });

      channel.subscribe(async (status: REALTIME_SUBSCRIBE_STATES) => {
        if (status === 'SUBSCRIBED') {
          await channel!.track({
            role: 'admin-observer',
            online_at: new Date().toISOString(),
          });
          setTelemetryStatus('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setTelemetryStatus('disconnected');
        }
      });
    } catch (err) {
      setTelemetryStatus('disconnected');
      console.warn('[Monitoring] Presence unavailable (Supabase client not configured):', err);
      return;
    }

    return () => {
      if (channel) {
        channel.untrack();
        channel.unsubscribe();
      }
    };
  }, []);

  // Presence overlay on live roster
  const mergedLiveRoster = useMemo(() => {
    return liveRoster.map((i) => ({
      ...i,
      _presenceOnline: onlineIds.has(i.id),
    }));
  }, [liveRoster, onlineIds]);

  // ── Filter workday roster ──
  const filteredWorkdayRoster = useMemo(() => {
    let roster = workdayRoster;

    if (search.trim()) {
      const term = search.trim().toLowerCase();
      roster = roster.filter(
        (i) =>
          i.name.toLowerCase().includes(term) ||
          i.externalId.toLowerCase().includes(term)
      );
    }

    if (campaign.trim()) {
      roster = roster.filter(
        (i) => (i.campaign || '').toLowerCase() === campaign.trim().toLowerCase()
      );
    }

    if (statusFilter.trim()) {
      roster = roster.filter((i) => i.realtimeStatus === statusFilter);
    }

    return roster;
  }, [workdayRoster, search, campaign, statusFilter]);

  // ── Workday KPIs ──
  const workdayKPIs = useMemo(() => {
    const total = filteredWorkdayRoster.length;
    const workingNow = filteredWorkdayRoster.filter(
      (i) => ['Online', 'Busy', 'Away', 'Disponible'].includes(i.workdayStatus)
    ).length;
    const activeToday = filteredWorkdayRoster.filter(
      (i) => i.workdayStatus !== 'Sin actividad hoy'
    ).length;
    const totalHoursToday = filteredWorkdayRoster.reduce((sum, i) => sum + i.connectedHours, 0);
    const totalCallsToday = filteredWorkdayRoster.reduce((sum, i) => sum + i.callsAttended, 0);
    const avgAdherence =
      filteredWorkdayRoster.filter((i) => i.adherence !== null && i.adherence !== undefined && i.adherence > 0)
        .reduce((sum, i, arr) => sum + (i.adherence || 0), 0) /
      Math.max(1, filteredWorkdayRoster.filter((i) => i.adherence && i.adherence > 0).length);

    // Busy count from live roster
    const onlineCount = mergedLiveRoster.filter((i) => i.realtimeStatus === 'Online').length;
    const busyCount = mergedLiveRoster.filter((i) => i.realtimeStatus === 'Busy').length;

    return {
      total,
      workingNow,
      activeToday,
      totalHoursToday,
      totalCallsToday,
      avgAdherence: avgAdherence || 0,
      onlineCount,
      busyCount,
    };
  }, [filteredWorkdayRoster, mergedLiveRoster]);

  // ── Group by workday status ──
  const groupedByWorkday = useMemo(() => {
    const groups: Record<string, WorkdayInterpreter[]> = {};
    const order = ['En llamada', 'Activo', 'Disponible', 'En pausa', 'Desconectado (laboró)', 'Online sin registro', 'Sin actividad hoy'];

    for (const status of order) {
      groups[status] = filteredWorkdayRoster.filter((i) => i.workdayStatus === status);
    }

    return groups;
  }, [filteredWorkdayRoster]);

  // ── Filter handlers ──
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    fetchLiveRoster();
  }, [fetchLiveRoster]);

  const handleCampaignChange = useCallback((value: string) => {
    setCampaign(value);
    fetchLiveRoster();
  }, [fetchLiveRoster]);

  const handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value);
    fetchLiveRoster();
  }, [fetchLiveRoster]);

  return (
    <div className="space-y-6">
      {/* ── TOP KPI CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          {
            label: 'Total activos',
            value: workdayKPIs.total,
            icon: Users,
            color: 'text-[var(--theme-link)]',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20',
          },
          {
            label: 'En jornada',
            value: workdayKPIs.workingNow,
            icon: Activity,
            color: 'text-[var(--theme-success)]',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20',
          },
          {
            label: 'Online',
            value: workdayKPIs.onlineCount,
            icon: Wifi,
            color: 'text-[var(--theme-success)]',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20',
          },
          {
            label: 'En llamada',
            value: workdayKPIs.busyCount,
            icon: PhoneCall,
            color: 'text-[var(--theme-warning)]',
            bg: 'bg-amber-500/10',
            border: 'border-amber-500/20',
          },
          {
            label: 'Horas hoy',
            value: formatHours(workdayKPIs.totalHoursToday),
            icon: Clock,
            color: 'text-[var(--theme-purple)]',
            bg: 'bg-purple-500/10',
            border: 'border-purple-500/20',
          },
          {
            label: 'Llamadas hoy',
            value: workdayKPIs.totalCallsToday,
            icon: Phone,
            color: 'text-[var(--theme-info)]',
            bg: 'bg-cyan-500/10',
            border: 'border-cyan-500/20',
          },
          {
            label: 'Adherencia',
            value: `${workdayKPIs.avgAdherence.toFixed(1)}%`,
            icon: Target,
            color: workdayKPIs.avgAdherence >= 80 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-warning)]',
            bg: workdayKPIs.avgAdherence >= 80 ? 'bg-emerald-500/10' : 'bg-amber-500/10',
            border: workdayKPIs.avgAdherence >= 80 ? 'border-emerald-500/20' : 'border-amber-500/20',
          },
          {
            label: 'Actualizado',
            value: lastUpdated ? formatTime(lastUpdated) : '...',
            icon: RefreshCw,
            color: 'text-[var(--text-secondary)]',
            bg: 'bg-slate-500/10',
            border: 'border-slate-500/20',
          },
        ].map((card, i) => (
          <div
            key={i}
            className={cn(
              'rounded-2xl border p-4 relative overflow-hidden group flex flex-col justify-between min-h-[100px] transition-all hover:scale-[1.03]',
              card.bg,
              card.border
            )}
          >
            <div className="absolute -right-3 -top-3 opacity-5 group-hover:opacity-10 transition-opacity">
              <card.icon size={48} />
            </div>
            <div className={cn('p-2 rounded-lg bg-[var(--theme-surface-muted)] w-fit', card.color)}>
              <card.icon size={16} />
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-tertiary)] font-medium uppercase tracking-wider leading-tight">
                {card.label}
              </p>
              <h3 className={cn('text-2xl font-bold mt-1 leading-none', card.color)}>
                {card.value}
              </h3>
            </div>
          </div>
        ))}
      </div>

      {/* ── FILTER BAR ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar por nombre o ID..."
            className="w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)] outline-none ring-0 placeholder:text-[var(--text-tertiary)] focus:border-[var(--theme-focus)]"
          />
        </div>

        <div className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value)}
            className="rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-2 pl-9 pr-8 text-sm text-[var(--foreground)] appearance-none focus:border-[var(--theme-focus)] cursor-pointer"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="relative">
          <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <select
            value={campaign}
            onChange={(e) => handleCampaignChange(e.target.value)}
            className="rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] py-2 pl-9 pr-8 text-sm text-[var(--foreground)] appearance-none focus:border-[var(--theme-focus)] cursor-pointer"
          >
            <option value="">Todas las Campañas</option>
            {campaigns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
            autoRefresh
              ? 'bg-emerald-500/10 text-[var(--theme-success)] border border-emerald-500/20'
              : 'bg-[var(--theme-surface-muted)] text-[var(--text-secondary)] border border-[var(--border)]'
          )}
        >
          <RefreshCw size={14} className={cn(autoRefresh && 'animate-spin-slow')} />
          {autoRefresh ? 'Auto-refresh ON' : 'Manual'}
        </button>

        {isPending && !isInitialLoading && (
          <span className="text-xs text-[var(--text-secondary)] animate-pulse">Actualizando...</span>
        )}

        <span className="text-xs text-[var(--text-tertiary)] ml-auto flex items-center gap-2">
          {lastUpdated && (
            <span className="flex items-center gap-1 text-[var(--text-tertiary)]">
              <Clock size={11} />
              {formatRelativeTime(lastUpdated.toISOString())}
            </span>
          )}
          <ShieldCheck size={12} />
          {telemetryStatus === 'connected' ? (
            <span className="text-[var(--theme-success)]">Presence</span>
          ) : (
            <span className="text-[var(--theme-danger)]">Sin telemetría</span>
          )}
        </span>
      </div>

      {/* ── WORKDAY ROSTER BY STATUS ── */}
      {isInitialLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-4 animate-pulse">
              <div className="h-6 w-48 rounded bg-[var(--theme-surface-muted)] mb-4" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-3 py-2">
                    <div className="w-8 h-8 rounded-lg bg-[var(--theme-surface-muted)]" />
                    <div className="flex-1 space-y-1">
                      <div className="h-4 w-40 rounded bg-[var(--theme-surface-muted)]" />
                      <div className="h-3 w-24 rounded bg-[var(--theme-surface-muted)]" />
                    </div>
                    <div className="h-5 w-20 rounded-full bg-[var(--theme-surface-muted)]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByWorkday).map(([status, interpreters]) => {
            if (interpreters.length === 0) return null;
            const statusConfig = WORKDAY_STATUS_CONFIG[status];
            if (!statusConfig) return null;
            const StatusIcon = statusConfig.icon;

            return (
              <div
                key={status}
                className={cn(
                  'rounded-xl border overflow-hidden bg-[var(--theme-panel)]',
                  statusConfig.bg,
                  statusConfig.border
                )}
              >
                {/* Section Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2.5">
                    <StatusIcon size={16} className={statusConfig.color} />
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">{status}</h3>
                    <span
                      className={cn(
                        'text-xs font-mono px-1.5 py-0.5 rounded',
                        'bg-[var(--theme-surface-muted)] text-[var(--text-secondary)]'
                      )}
                    >
                      {interpreters.length}
                    </span>
                  </div>
                </div>

                {/* Interpreters Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
                  {interpreters.map((interpreter) => {
                    const isBusy = interpreter.realtimeStatus === 'Busy';
                    const sessionDuration = isBusy ? getSessionDuration(interpreter.id) : 0;
                    const currentHours = sessionDuration
                      ? interpreter.connectedHours + sessionDuration / 3600
                      : interpreter.connectedHours;

                    // Workday progress bar (% of 8h goal)
                    const goalHours = 8;
                    const progressPercent = Math.min((currentHours / goalHours) * 100, 100);

                    return (
                      <div
                        key={interpreter.id}
                        className="rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] p-4 hover:bg-[var(--theme-hover)] hover:border-[var(--theme-control-border)] transition-all cursor-pointer group"
                        onClick={() => setSelectedInterpreter(interpreter)}
                      >
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className={cn(
                              'w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0',
                              interpreter.realtimeStatus === 'Online' ? 'bg-emerald-500/20 text-[var(--theme-success)]' :
                              interpreter.realtimeStatus === 'Busy' ? 'bg-amber-500/20 text-[var(--theme-warning)]' :
                              interpreter.realtimeStatus === 'Away' ? 'bg-orange-500/20 text-[var(--theme-away)]' :
                              'bg-slate-500/20 text-[var(--text-secondary)]'
                            )}>
                              {interpreter.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                                {interpreter.name}
                              </p>
                              <p className="text-[11px] text-[var(--text-tertiary)] font-mono">
                                {interpreter.externalId}
                              </p>
                            </div>
                          </div>
                          <StatusBadge
                            status={interpreter.realtimeStatus}
                            statusReason={interpreter.statusReason}
                            size="sm"
                            showTime={false}
                          />
                        </div>

                        {/* Workday Status Badge */}
                        <div className="mb-3">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full border',
                            statusConfig.bg,
                            statusConfig.border,
                            statusConfig.color
                          )}>
                            <StatusIcon size={10} />
                            {interpreter.workdayStatus}
                          </span>
                        </div>

                        {/* Hours Progress */}
                        <div className="space-y-2 mb-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[var(--text-tertiary)]">Horas hoy</span>
                            <span className={cn(
                              'font-mono font-bold',
                              currentHours >= goalHours ? 'text-[var(--theme-success)]' : currentHours >= 4 ? 'text-[var(--theme-link)]' : 'text-[var(--text-secondary)]'
                            )}>
                              {formatHours(currentHours)}
                              {isBusy && sessionDuration > 0 && (
                                <span className="text-[var(--theme-warning)] text-[10px] ml-1">
                                  ({formatDuration(sessionDuration)})
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[var(--theme-track)] overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                currentHours >= goalHours ? 'bg-emerald-500' :
                                currentHours >= 6 ? 'bg-blue-500' :
                                currentHours >= 3 ? 'bg-amber-500' : 'bg-gray-600'
                              )}
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-lg bg-[var(--theme-surface-muted)] border border-[var(--border)] p-2">
                            <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">Llamadas</p>
                            <p className="text-sm font-bold text-[var(--foreground)]">
                              {interpreter.callsAttended}
                              {sessionDuration > 0 && interpreter.realtimeStatus === 'Busy' && (
                                <span className="inline-block w-1 h-1 rounded-full bg-amber-500 animate-pulse ml-1" />
                              )}
                            </p>
                          </div>
                          <div className="rounded-lg bg-[var(--theme-surface-muted)] border border-[var(--border)] p-2">
                            <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">Minutos</p>
                            <p className="text-sm font-bold text-[var(--foreground)]">
                              {interpreter.interpretedMinutes}
                            </p>
                          </div>
                          <div className="rounded-lg bg-[var(--theme-surface-muted)] border border-[var(--border)] p-2">
                            <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">Adherencia</p>
                            <p className={cn(
                              'text-sm font-bold',
                              interpreter.adherence && interpreter.adherence >= 80 ? 'text-[var(--theme-success)]' :
                              interpreter.adherence && interpreter.adherence >= 60 ? 'text-[var(--theme-warning)]' : 'text-[var(--text-tertiary)]'
                            )}>
                              {interpreter.adherence != null ? `${interpreter.adherence.toFixed(1)}%` : '—'}
                            </p>
                          </div>
                        </div>

                        {/* Login / Logout row */}
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--border)] text-[10px] text-[var(--text-tertiary)]">
                          <span className="flex items-center gap-1">
                            <LogIn size={10} className="text-[var(--theme-success)]" />
                            {formatTime(interpreter.loginTime)}
                          </span>
                          <span className="flex items-center gap-1">
                            {formatTime(interpreter.logoutTime)}
                            <LogOut size={10} className="text-[var(--text-tertiary)]" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CAMPAIGN MINI STATS ── */}
      {campaigns.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-[var(--text-tertiary)] mr-1">Campañas activas:</span>
          {campaigns.map((c) => (
            <span
              key={c}
              className="text-[11px] text-[var(--text-secondary)] px-2.5 py-1 rounded-full bg-[var(--theme-panel)] border border-[var(--border)] font-mono"
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {/* ── STATUS TIMELINE (when expanded) ── */}
      {selectedInterpreter && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold',
                selectedInterpreter.realtimeStatus === 'Online' ? 'bg-emerald-500/20 text-[var(--theme-success)]' :
                selectedInterpreter.realtimeStatus === 'Busy' ? 'bg-amber-500/20 text-[var(--theme-warning)]' :
                selectedInterpreter.realtimeStatus === 'Away' ? 'bg-orange-500/20 text-[var(--theme-away)]' :
                'bg-slate-500/20 text-[var(--text-secondary)]'
              )}>
                {selectedInterpreter.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="text-[var(--foreground)] font-bold text-lg">{selectedInterpreter.name}</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  {selectedInterpreter.externalId} · Campaña: {selectedInterpreter.campaign || '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge
                status={selectedInterpreter.realtimeStatus}
                statusReason={selectedInterpreter.statusReason}
                size="md"
                showTime={true}
              />
              <button
                onClick={() => setSelectedInterpreter(null)}
                className="text-[var(--text-tertiary)] hover:text-[var(--foreground)] transition-colors text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-gray-500"
              >
                Cerrar
              </button>
            </div>
          </div>

          {/* Workday detail */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div className="rounded-lg bg-[var(--theme-panel)] border border-[var(--border)] p-3">
              <p className="text-[10px] text-[var(--text-tertiary)] mb-1">Horas conectadas</p>
              <p className="text-lg font-bold text-[var(--theme-purple)]">
                {formatHours(selectedInterpreter.connectedHours)}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--theme-panel)] border border-[var(--border)] p-3">
              <p className="text-[10px] text-[var(--text-tertiary)] mb-1">Llamadas atendidas</p>
              <p className="text-lg font-bold text-[var(--theme-info)]">{selectedInterpreter.callsAttended}</p>
            </div>
            <div className="rounded-lg bg-[var(--theme-panel)] border border-[var(--border)] p-3">
              <p className="text-[10px] text-[var(--text-tertiary)] mb-1">Minutos interpretados</p>
              <p className="text-lg font-bold text-[var(--theme-link)]">{selectedInterpreter.interpretedMinutes}</p>
            </div>
            <div className="rounded-lg bg-[var(--theme-panel)] border border-[var(--border)] p-3">
              <p className="text-[10px] text-[var(--text-tertiary)] mb-1">Adherencia</p>
              <p className={cn(
                'text-lg font-bold',
                selectedInterpreter.adherence && selectedInterpreter.adherence >= 80 ? 'text-[var(--theme-success)]' :
                selectedInterpreter.adherence && selectedInterpreter.adherence >= 60 ? 'text-[var(--theme-warning)]' : 'text-[var(--text-tertiary)]'
              )}>
                {selectedInterpreter.adherence != null ? `${selectedInterpreter.adherence.toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 text-xs">
            <div>
              <p className="text-[var(--text-tertiary)] mb-1">Login</p>
              <p className="text-[var(--text-secondary)] font-mono flex items-center gap-1">
                <LogIn size={11} className="text-[var(--theme-success)]" />
                {formatTime(selectedInterpreter.loginTime)}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-tertiary)] mb-1">Logout</p>
              <p className="text-[var(--text-secondary)] font-mono flex items-center gap-1">
                <LogOut size={11} className="text-[var(--text-tertiary)]" />
                {formatTime(selectedInterpreter.logoutTime)}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-tertiary)] mb-1">Jornada</p>
              <p className="text-[var(--text-secondary)]">{selectedInterpreter.workdayStatus}</p>
            </div>
            <div>
              <p className="text-[var(--text-tertiary)] mb-1">Tarifa</p>
              <p className="text-[var(--text-secondary)] font-mono">RD$ {selectedInterpreter.tariffPerMinute.toFixed(2)}/min</p>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Historial de estados</h4>
            <StatusTimeline interpreterId={selectedInterpreter.id} />
          </div>
        </div>
      )}
    </div>
  );
}