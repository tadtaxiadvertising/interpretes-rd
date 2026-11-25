import React from 'react';
import { redirect } from 'next/navigation';
import { Trophy, TrendingUp, Target, Award, Medal } from 'lucide-react';
import { getCurrentActor } from '@/lib/auth/current-actor';
import { getPrivateRankingSummary } from '@/lib/ranking/calculate';
import { getLeaderboard } from '@/services/metrics/metrics-service';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface LeaderboardEntry {
  position: number;
  name: string;
  minutes: number;
  qaScore: number | null;
}

interface InterpreterRankingSummary {
  position: number;
  totalEligible: number;
  score: number;
  ownProductionMinutes: number;
  ownGoalProgress: number;
  ownQaScore: number | null;
  percentile?: number;
  leaderboard?: LeaderboardEntry[];
}

async function fetchPrivateRanking(interpreterId: number): Promise<InterpreterRankingSummary | null> {
  try {
    // Call the service directly instead of self-fetching `/api/dashboard/ranking`:
    // a server-side relative fetch is unparseable, and that endpoint returned a
    // different shape (rankingPosition/interpretedMinutes) than this page expects.
    const [summary, leaderboard] = await Promise.all([
      getPrivateRankingSummary(interpreterId),
      getLeaderboard(undefined, 10),
    ]);

    if (!summary) return null;

    return {
      ...summary,
      leaderboard: leaderboard.map((entry, index) => ({
        position: index + 1,
        name: entry.name,
        minutes: entry.interpretedMinutes,
        qaScore: entry.qaScore,
      })),
    };
  } catch (error) {
    console.error('[RankingPage] Failed to load private ranking:', error);
    return null;
  }
}

export default async function RankingPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');

  const ranking = actor.interpreterId ? await fetchPrivateRanking(actor.interpreterId) : null;

  const monthName = new Date().toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });

  if (!ranking) {
    return (
      <div className="space-y-8 animate-in fade-in duration-700">
        <div className="flex items-center gap-3">
          <Trophy size={28} className="text-[var(--theme-warning)]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] capitalize">Ranking — {monthName}</h1>
            <p className="text-sm text-[var(--text-secondary)]">Tu posición y métricas privadas</p>
          </div>
        </div>

        <div className="glass rounded-3xl p-8 border border-[var(--border)] text-center">
          <p className="text-[var(--text-secondary)]">No hay datos de ranking disponibles para este mes.</p>
        </div>
      </div>
    );
  }

  const { position, totalEligible, score, ownProductionMinutes, ownGoalProgress, ownQaScore, percentile, leaderboard = [] } = ranking;

  // Top 3 for podium
  const top3 = leaderboard.slice(0, 3);
  // Current user's position if not in top 3
  const isInTop3 = top3.some(l => l.position === position);
  const showCurrentUser = !isInTop3 && position > 0 && position <= totalEligible;

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Trophy size={28} className="text-[var(--theme-warning)]" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] capitalize">Mi Ranking — {monthName}</h1>
          <p className="text-sm text-[var(--text-secondary)]">Top 3 y tu posición basada en producción, QA y adherencia</p>
        </div>
      </div>

      {/* Podium - Top 3 */}
      <div className="glass rounded-3xl overflow-hidden border border-[var(--border)]">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
            <Medal size={20} className="text-[var(--theme-warning)]" />
            Podio del Mes
          </h3>
        </div>
        <div className="p-6">
          <div className="flex flex-wrap justify-center items-end gap-3 sm:gap-4 md:gap-8">
            {/* 2nd Place */}
            {top3[1] && (
              <div className="flex-1 flex flex-col items-center">
                <div className="relative w-24 h-24 md:w-28 md:h-28 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shadow-xl">
                  <span className="text-3xl md:text-4xl font-bold text-[#ffffff]">#{top3[1].position}</span>
                </div>
                <div className="mt-3 text-center">
                  <p className="font-bold text-[var(--foreground)] truncate max-w-[120px]">{top3[1].name}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{(top3[1].minutes / 60).toFixed(1)} hrs</p>
                  {top3[1].qaScore !== null && (
                    <p className="text-xs text-[var(--theme-success)]">QA: {top3[1].qaScore}%</p>
                  )}
                </div>
                <div className="mt-2 text-[var(--text-tertiary)] text-xs">2.º Lugar</div>
              </div>
            )}
            {/* 1st Place */}
            {top3[0] && (
              <div className="flex-1 flex flex-col items-center">
                <div className="relative w-32 h-32 md:w-36 md:h-36 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center shadow-[0_0_30px_rgba(251,191,36,0.4)]">
                  <span className="text-4xl md:text-5xl font-bold text-[#13233b]">#{top3[0].position}</span>
                </div>
                <div className="mt-3 text-center">
                  <p className="font-bold text-[var(--foreground)] truncate max-w-[140px]">{top3[0].name}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{(top3[0].minutes / 60).toFixed(1)} hrs</p>
                  {top3[0].qaScore !== null && (
                    <p className="text-xs text-[var(--theme-success)]">QA: {top3[0].qaScore}%</p>
                  )}
                </div>
                <div className="mt-2 text-[var(--theme-warning)] text-xs font-bold">1.er Lugar 👑</div>
              </div>
            )}
            {/* 3rd Place */}
            {top3[2] && (
              <div className="flex-1 flex flex-col items-center">
                <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-amber-700 to-amber-900 flex items-center justify-center shadow-lg">
                  <span className="text-2xl md:text-3xl font-bold text-[#ffffff]">#{top3[2].position}</span>
                </div>
                <div className="mt-3 text-center">
                  <p className="font-bold text-[var(--foreground)] truncate max-w-[120px]">{top3[2].name}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{(top3[2].minutes / 60).toFixed(1)} hrs</p>
                  {top3[2].qaScore !== null && (
                    <p className="text-xs text-[var(--theme-success)]">QA: {top3[2].qaScore}%</p>
                  )}
                </div>
                <div className="mt-2 text-[var(--text-tertiary)] text-xs">3.er Lugar</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Current User Position (if not in top 3) */}
      {showCurrentUser && (
        <div className="glass rounded-3xl overflow-hidden border border-blue-500/20">
          <div className="px-6 py-4 border-b border-blue-500/20 bg-blue-500/5">
            <h3 className="text-lg font-bold text-[var(--theme-link)] flex items-center gap-2">
              <Target size={20} />
              Tu Posición
            </h3>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-700 to-blue-900 flex items-center justify-center shadow-lg">
                  <span className="text-2xl font-bold text-[#ffffff]">#{position}</span>
                </div>
                <div>
                  <p className="font-bold text-[var(--foreground)] text-lg">Tu posición actual</p>
                  <p className="text-sm text-[var(--text-secondary)]">de {totalEligible} intérpretes activos</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-[var(--theme-link)]">Top {100 - (percentile ?? 0)}%</p>
                <p className="text-xs text-[var(--text-secondary)]">Superas al {percentile ?? 0}%</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="glass rounded-2xl p-5 border border-amber-500/10">
          <p className="text-xs text-[var(--text-secondary)] mb-1 uppercase tracking-wide font-bold">Tu Posición</p>
          <p className="text-3xl font-bold text-[var(--theme-warning)]">#{position}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">de {totalEligible} intérpretes</p>
        </div>
        <div className="glass rounded-2xl p-5 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-secondary)] mb-1 uppercase tracking-wide font-bold">Tu Score</p>
          <p className="text-3xl font-bold text-[var(--foreground)]">{score.toFixed(1)}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">puntos ponderados</p>
        </div>
        <div className="glass rounded-2xl p-5 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-secondary)] mb-1 uppercase tracking-wide font-bold">Tus Horas</p>
          <p className="text-3xl font-bold text-[var(--foreground)]">{(ownProductionMinutes / 60).toFixed(1)}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">hrs este mes</p>
        </div>
        <div className="glass rounded-2xl p-5 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-secondary)] mb-1 uppercase tracking-wide font-bold">Percentil</p>
          <p className="text-3xl font-bold text-[var(--theme-link)]">{percentile ?? 0}%</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">superas al {percentile ?? 0}%</p>
        </div>
      </div>

      {/* Detailed metrics */}
      <div className="glass rounded-3xl overflow-hidden border border-[var(--border)]">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
            <TrendingUp size={20} className="text-[var(--theme-link)]" />
            Detalle de Métricas
          </h3>
        </div>
        <div className="divide-y divide-white/5 p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Production */}
            <div>
              <p className="text-xs text-[var(--text-secondary)] mb-1 uppercase tracking-wide">Producción Verificada</p>
              <p className="text-2xl font-bold text-[var(--foreground)]">{(ownProductionMinutes / 60).toFixed(1)} hrs</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">{ownProductionMinutes} minutos totales</p>
            </div>
            {/* Goal Progress */}
            <div>
              <p className="text-xs text-[var(--text-secondary)] mb-1 uppercase tracking-wide">Progreso de Meta</p>
              <p className="text-2xl font-bold text-[var(--theme-success)]">{ownGoalProgress.toFixed(1)}%</p>
              <div className="mt-2 h-2 bg-[var(--theme-track)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(ownGoalProgress, 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* QA Score */}
            <div>
              <p className="text-xs text-[var(--text-secondary)] mb-1 uppercase tracking-wide">QA Score Promedio</p>
              <p className={cn("text-2xl font-bold", ownQaScore !== null && ownQaScore >= 90 ? "text-[var(--theme-success)]" : "text-[var(--foreground)]")}>
                {ownQaScore !== null ? `${ownQaScore}%` : 'Sin datos'}
              </p>
              {ownQaScore !== null && (
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  {ownQaScore >= 90 ? 'Excelente' : ownQaScore >= 80 ? 'Bueno' : 'Mejorable'}
                </p>
              )}
            </div>
            {/* Percentile context */}
            <div>
              <p className="text-xs text-[var(--text-secondary)] mb-1 uppercase tracking-wide">Comparativa</p>
              <p className="text-2xl font-bold text-[var(--theme-link)]">Top {100 - (percentile ?? 0)}%</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Superas al {percentile ?? 0}% de los {totalEligible} intérpretes activos
              </p>
            </div>
          </div>

          {/* Score breakdown */}
          <div className="pt-4 border-t border-[var(--border)]">
            <p className="text-xs text-[var(--text-secondary)] mb-3 uppercase tracking-wide">Cómo se calcula tu Score</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div className="p-3 rounded-xl bg-[var(--theme-surface-muted)]">
                <p className="text-xs text-[var(--text-secondary)]">Producción (50%)</p>
                <p className="text-sm font-bold text-[var(--foreground)]">Basada en minutos verificados</p>
              </div>
              <div className="p-3 rounded-xl bg-[var(--theme-surface-muted)]">
                <p className="text-xs text-[var(--text-secondary)]">QA (30%)</p>
                <p className="text-sm font-bold text-[var(--foreground)]">Calidad de interpretación</p>
              </div>
              <div className="p-3 rounded-xl bg-[var(--theme-surface-muted)]">
                <p className="text-xs text-[var(--text-secondary)]">Adherencia (15%)</p>
                <p className="text-sm font-bold text-[var(--foreground)]">Cumplimiento de horarios</p>
              </div>
              <div className="p-3 rounded-xl bg-[var(--theme-surface-muted)]">
                <p className="text-xs text-[var(--text-secondary)]">Consistencia (5%)</p>
                <p className="text-sm font-bold text-[var(--foreground)]">Días activos en el mes</p>
              </div>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-3 text-center">
              Pesos configurables en SystemConfig — ver <code className="font-mono">ranking_weight_*</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}