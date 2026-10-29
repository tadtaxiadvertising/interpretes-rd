'use server';

import prisma from '@/lib/prisma';
import { getMonthBounds, getMonthBoundsForPeriod, sumEffectiveLogMinutes } from '@/lib/interpreter-metrics';

const db = prisma;

export interface MetricUpdateResult {
  interpreterId: number;
  period: string;
  interpretedMinutes: number;
  qaScore: number | null;
  rankingPosition: number | null;
  totalInterpreters: number;
}

/**
 * Get the current period in YYYY-MM format (Santo Domingo timezone)
 */
function getCurrentPeriod(): string {
  const now = new Date();
  const sd = new Date(now.toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' }));
  return `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get period from date in YYYY-MM format (Santo Domingo timezone)
 */
function getPeriodFromDate(date: Date): string {
  const sd = new Date(date.toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' }));
  return `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Calculate and update monthly metrics for a specific interpreter
 */
export async function updateInterpreterMetrics(
  interpreterId: number,
  period?: string
): Promise<MetricUpdateResult | { error: string }> {
  const targetPeriod = period || getCurrentPeriod();
  if (!/^\d{4}-\d{2}$/.test(targetPeriod)) {
    return { error: 'Invalid period' };
  }

  try {
    // Get interpreter with production logs and QA scores for the period
    const { startOfMonth, endOfMonth } = getMonthBoundsForPeriod(targetPeriod);

    const interpreter = await db.interpreter.findUnique({
      where: { id: interpreterId },
      select: {
        id: true,
        productionLogs: {
          where: {
            date: { gte: startOfMonth, lte: endOfMonth },
          },
          select: { interpretedMinutes: true, verifiedMinutes: true },
        },
        qaScores: {
          where: {
            auditDate: { gte: startOfMonth, lte: endOfMonth },
          },
          orderBy: { auditDate: 'desc' },
          take: 1,
          select: { totalScore: true },
        },
      },
    });

    if (!interpreter) {
      return { error: 'Interpreter not found' };
    }

    const interpretedMinutes = sumEffectiveLogMinutes(interpreter.productionLogs);
    const rawQaScore = interpreter.qaScores?.[0]?.totalScore;
    const qaScore = rawQaScore == null ? null : Number(rawQaScore);

    // Upsert metrics
    const metrics = await db.interpreterMonthlyMetrics.upsert({
      where: {
        interpreterId_period: {
          interpreterId,
          period: targetPeriod,
        },
      },
      update: {
        interpretedMinutes,
        qaScore,
        updatedAt: new Date(),
      },
      create: {
        interpreterId,
        period: targetPeriod,
        interpretedMinutes,
        qaScore,
      },
    });

    return {
      interpreterId: metrics.interpreterId,
      period: metrics.period,
      interpretedMinutes: metrics.interpretedMinutes,
      qaScore: metrics.qaScore ? Number(metrics.qaScore) : null,
      rankingPosition: metrics.rankingPosition,
      totalInterpreters: metrics.totalInterpreters ?? 0,
    };
  } catch (error) {
    console.error('[METRICS] updateInterpreterMetrics error:', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Recalculate rankings for all interpreters for a given period
 */
export async function recalculateRankings(period?: string): Promise<number> {
  const targetPeriod = period || getCurrentPeriod();
  if (!/^\d{4}-\d{2}$/.test(targetPeriod)) {
    return 0;
  }

  try {
    // Get all metrics for the period
    const allMetrics = await db.interpreterMonthlyMetrics.findMany({
      where: { period: targetPeriod },
      include: { interpreter: { select: { id: true } } },
      orderBy: [
        { interpretedMinutes: 'desc' },
        { qaScore: 'desc' },
      ],
    });

    if (allMetrics.length === 0) return 0;

    const totalInterpreters = allMetrics.length;

    // Update rankings in batch
    await db.$transaction(
      allMetrics.map((metric, index) =>
        db.interpreterMonthlyMetrics.update({
          where: { id: metric.id },
          data: {
            rankingPosition: index + 1,
            totalInterpreters,
          },
        })
      )
    );

    return totalInterpreters;
  } catch (error) {
    console.error('[METRICS] recalculateRankings error:', error);
    return 0;
  }
}

/**
 * Full refresh: update all interpreters' metrics and recalculate rankings for current period
 */
export async function refreshAllMetrics(): Promise<{ updated: number; errors: number }> {
  const period = getCurrentPeriod();
  let updated = 0;
  let errors = 0;

  try {
    // Get all active interpreters
    const interpreters = await db.interpreter.findMany({
      where: { status: 'Activo' },
      select: { id: true },
    });

    // Update each interpreter's metrics
    for (const interpreter of interpreters) {
      const result = await updateInterpreterMetrics(interpreter.id, period);
      if ('error' in result) {
        errors++;
        console.error(`[METRICS] Error updating interpreter ${interpreter.id}:`, result.error);
      } else {
        updated++;
      }
    }

    // Recalculate rankings
    await recalculateRankings(period);

    return { updated, errors };
  } catch (error) {
    console.error('[METRICS] refreshAllMetrics error:', error);
    return { updated, errors: errors + 1 };
  }
}

/**
 * Get metrics for a specific interpreter (for dashboard)
 */
export async function getInterpreterMetrics(
  interpreterId: number,
  period?: string
): Promise<{
  interpretedMinutes: number;
  qaScore: number | null;
  rankingPosition: number | null;
  totalInterpreters: number | null;
} | null> {
  const targetPeriod = period || getCurrentPeriod();
  if (!/^\d{4}-\d{2}$/.test(targetPeriod)) {
    return null;
  }

  const metrics = await db.interpreterMonthlyMetrics.findUnique({
    where: {
      interpreterId_period: {
        interpreterId,
        period: targetPeriod,
      },
    },
    select: {
      interpretedMinutes: true,
      qaScore: true,
      rankingPosition: true,
      totalInterpreters: true,
    },
  });

  if (!metrics) return null;

  return {
    interpretedMinutes: metrics.interpretedMinutes,
    qaScore: metrics.qaScore ? Number(metrics.qaScore) : null,
    rankingPosition: metrics.rankingPosition,
    totalInterpreters: metrics.totalInterpreters,
  };
}

// Month bounds are centralized in @/lib/interpreter-metrics to keep
// production, payroll and metrics aligned on the same period definition.

/**
 * Get top interpreters for leaderboard
 */
export async function getLeaderboard(period?: string, limit = 10): Promise<Array<{
  interpreterId: number;
  name: string;
  interpretedMinutes: number;
  qaScore: number | null;
  rankingPosition: number;
}>> {
  const targetPeriod = period || getCurrentPeriod();
  if (!/^\d{4}-\d{2}$/.test(targetPeriod)) {
    return [];
  }

  const metrics = await db.interpreterMonthlyMetrics.findMany({
    where: { period: targetPeriod },
    include: {
      interpreter: { select: { id: true, name: true } },
    },
    orderBy: [
      { interpretedMinutes: 'desc' },
      { qaScore: 'desc' },
    ],
    take: limit,
  });

  return metrics.map(m => ({
    interpreterId: m.interpreterId,
    name: m.interpreter?.name || 'Unknown',
    interpretedMinutes: m.interpretedMinutes,
    qaScore: m.qaScore ? Number(m.qaScore) : null,
    rankingPosition: m.rankingPosition || 0,
  }));
}