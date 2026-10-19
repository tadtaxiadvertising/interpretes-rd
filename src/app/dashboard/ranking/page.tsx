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
          <Trophy size={28} className="text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold text-white capitalize">Ranking — {monthName}</h1>
            <p className="text-sm text-slate-300">Tu posición y métricas privadas</p>
          </div>
        </div>

        <div className="glass rounded-3xl p-8 border border-white/5 text-center">
          <p className="text-slate-400">No hay datos de ranking disponibles para este mes.</p>
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
        <Trophy size={28} className="text-amber-400" />
        <div>
          <h1 className="text-2xl font-bold text-white capitalize">Mi Ranking — {monthName}</h1>
          <p className="text-sm text-slate-300">Top 3 y tu posición basada en producción, QA y adherencia</p>
        </div>
      </div>

      {/* Podium - Top 3 */}
      <div className="glass rounded-3xl overflow-hidden border border-white/5">
        <div className="px-6 py-4 border-b border-white/5">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Medal size={20} className="text-amber-400" />
            Podio del Mes
          </h3>
        </div>
        <div className="p-6">
          <div className="flex justify-center items-end gap-4 md:gap-8">
            {/* 2nd Place */}
            {top3[1] && (
              <div className="flex-1 flex flex-col items-center">
                <div className="relative w-24 h-24 md:w-28 md:h-28 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center shadow-xl">
                  <span className="text-3xl md:text-4xl font-bold text-white">#{top3[1].position}</span>
                </div>
                <div className="mt-3 text-center">
                  <p className="font-bold text-white truncate max-w-[120px]">{top3[1].name}</p>
                  <p className="text-xs text-slate-400">{(top3[1].minutes / 60).toFixed(1)} hrs</p>
                  {top3[1].qaScore !== null && (
                    <p className="text-xs text-emerald-400">QA: {top3[1].qaScore}%</p>
                  )}
                </div>
                <div className="mt-2 text-slate-500 text-xs">2.º Lugar</div>
              </div>
            )}
            {/* 1st Place */}
            {top3[0] && (
              <div className="flex-1 flex flex-col items-center">
                <div className="relative w-32 h-32 md:w-36 md:h-36 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-[0_0_30px_rgba(251,191,36,0.4)]">
                  <span className="text-4xl md:text-5xl font-bold text-white">#{top3[0].position}</span>
                </div>
                <div className="mt-3 text-center">
                  <p className="font-bold text-white truncate max-w-[140px]">{top3[0].name}</p>
                  <p className="text-xs text-slate-300">{(top3[0].minutes / 60).toFixed(1)} hrs</p>
                  {top3[0].qaScore !== null && (
                    <p className="text-xs text-emerald-400">QA: {top3[0].qaScore}%</p>
                  )}
                </div>
                <div className="mt-2 text-amber-400 text-xs font-bold">1.er Lugar 👑</div>
              </div>
            )}
            {/* 3rd Place */}
            {top3[2] && (
              <div className="flex-1 flex flex-col items-center">
                <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-amber-700 to-amber-900 flex items-center justify-center shadow-lg">
                  <span className="text-2xl md:text-3xl font-bold text-white">#{top3[2].position}</span>
                </div>
                <div className="mt-3 text-center">
                  <p className="font-bold text-white truncate max-w-[120px]">{top3[2].name}</p>
                  <p className="text-xs text-slate-400">{(top3[2].minutes / 60).toFixed(1)} hrs</p>
                  {top3[2].qaScore !== null && (
                    <p className="text-xs text-emerald-400">QA: {top3[2].qaScore}%</p>
                  )}
                </div>
                <div className="mt-2 text-slate-500 text-xs">3.er Lugar</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Current User Position (if not in top 3) */}
      {showCurrentUser && (
        <div className="glass rounded-3xl overflow-hidden border border-blue-500/20">
          <div className="px-6 py-4 border-b border-blue-500/20 bg-blue-500/5">
            <h3 className="text-lg font-bold text-blue-400 flex items-center gap-2">
              <Target size={20} />
              Tu Posición
            </h3>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg">
                  <span className="text-2xl font-bold text-white">#{position}</span>
                </div>
                <div>
                  <p className="font-bold text-white text-lg">Tu posición actual</p>
                  <p className="text-sm text-slate-400">de {totalEligible} intérpretes activos</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-400">Top {100 - (percentile ?? 0)}%</p>
                <p className="text-xs text-slate-400">Superas al {percentile ?? 0}%</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="glass rounded-2xl p-5 border border-amber-500/10">
          <p className="text-xs text-slate-300 mb-1 uppercase tracking-wide font-bold">Tu Posición</p>
          <p className="text-3xl font-bold text-amber-400">#{position}</p>
          <p className="text-xs text-slate-300 mt-1">de {totalEligible} intérpretes</p>
        </div>
        <div className="glass rounded-2xl p-5 border border-white/5">
          <p className="text-xs text-slate-300 mb-1 uppercase tracking-wide font-bold">Tu Score</p>
          <p className="text-3xl font-bold text-white">{score.toFixed(1)}</p>
          <p className="text-xs text-slate-300 mt-1">puntos ponderados</p>
        </div>
        <div className="glass rounded-2xl p-5 border border-white/5">
          <p className="text-xs text-slate-300 mb-1 uppercase tracking-wide font-bold">Tus Horas</p>
          <p className="text-3xl font-bold text-white">{(ownProductionMinutes / 60).toFixed(1)}</p>
          <p className="text-xs text-slate-300 mt-1">hrs este mes</p>
        </div>
        <div className="glass rounded-2xl p-5 border border-white/5">
          <p className="text-xs text-slate-300 mb-1 uppercase tracking-wide font-bold">Percentil</p>
          <p className="text-3xl font-bold text-blue-400">{percentile ?? 0}%</p>
          <p className="text-xs text-slate-300 mt-1">superas al {percentile ?? 0}%</p>
        </div>
      </div>

      {/* Detailed metrics */}
      <div className="glass rounded-3xl overflow-hidden border border-white/5">
        <div className="px-6 py-4 border-b border-white/5">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp size={20} className="text-blue-400" />
            Detalle de Métricas
          </h3>
        </div>
        <div className="divide-y divide-white/5 p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Production */}
            <div>
              <p className="text-xs text-slate-400 mb-1 uppercase tracking-wide">Producción Verificada</p>
              <p className="text-2xl font-bold text-white">{(ownProductionMinutes / 60).toFixed(1)} hrs</p>
              <p className="text-sm text-slate-400 mt-1">{ownProductionMinutes} minutos totales</p>
            </div>
            {/* Goal Progress */}
            <div>
              <p className="text-xs text-slate-400 mb-1 uppercase tracking-wide">Progreso de Meta</p>
              <p className="text-2xl font-bold text-emerald-400">{ownGoalProgress.toFixed(1)}%</p>
              <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
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
              <p className="text-xs text-slate-400 mb-1 uppercase tracking-wide">QA Score Promedio</p>
              <p className="text-2xl font-bold {ownQaScore !== null && ownQaScore >= 90 ? 'text-emerald-400' : 'text-white'}">
                {ownQaScore !== null ? `${ownQaScore}%` : 'Sin datos'}
              </p>
              {ownQaScore !== null && (
                <p className="text-xs text-slate-400 mt-1">
                  {ownQaScore >= 90 ? 'Excelente' : ownQaScore >= 80 ? 'Bueno' : 'Mejorable'}
                </p>
              )}
            </div>
            {/* Percentile context */}
            <div>
              <p className="text-xs text-slate-400 mb-1 uppercase tracking-wide">Comparativa</p>
              <p className="text-2xl font-bold text-blue-400">Top {100 - (percentile ?? 0)}%</p>
              <p className="text-xs text-slate-400 mt-1">
                Superas al {percentile ?? 0}% de los {totalEligible} intérpretes activos
              </p>
            </div>
          </div>

          {/* Score breakdown */}
          <div className="pt-4 border-t border-white/5">
            <p className="text-xs text-slate-400 mb-3 uppercase tracking-wide">Cómo se calcula tu Score</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div className="p-3 rounded-xl bg-slate-800/50">
                <p className="text-xs text-slate-400">Producción (50%)</p>
                <p className="text-sm font-bold text-white">Basada en minutos verificados</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-800/50">
                <p className="text-xs text-slate-400">QA (30%)</p>
                <p className="text-sm font-bold text-white">Calidad de interpretación</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-800/50">
                <p className="text-xs text-slate-400">Adherencia (15%)</p>
                <p className="text-sm font-bold text-white">Cumplimiento de horarios</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-800/50">
                <p className="text-xs text-slate-400">Consistencia (5%)</p>
                <p className="text-sm font-bold text-white">Días activos en el mes</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3 text-center">
              Pesos configurables en SystemConfig — ver <code className="font-mono">ranking_weight_*</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}