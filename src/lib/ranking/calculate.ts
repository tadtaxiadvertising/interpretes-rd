import prisma from '@/lib/prisma';
import { getSystemConfig } from '@/app/actions/settings';
import { getMonthBounds } from '@/lib/interpreter-metrics';

export interface InterpreterRankingSummary {
  position: number;
  totalEligible: number;
  score: number;
  ownProductionMinutes: number;
  ownGoalProgress: number;
  ownQaScore: number | null;
  percentile?: number;
}

export interface AdminRankingRow {
  interpreterId: number;
  name: string;
  campaign: string | null;
  score: number;
  productionMinutes: number;
  qaScore: number | null;
  goalProgress: number;
}

/**
 * Calculate ranking score based on configurable weights from SystemConfig
 * Default weights (configurable via SystemConfig):
 * - production: 0.50 (production minutes)
 * - qa: 0.30 (QA score)
 * - adherence: 0.15 (schedule adherence)
 * - consistency: 0.05 (consistency bonus)
 */
export async function calculateRankingScore(
  productionMinutes: number,
  qaScore: number | null,
  adherence: number | null,
  consistencyBonus: number
): Promise<number> {
  const [
    weightProduction,
    weightQA,
    weightAdherence,
    weightConsistency,
  ] = await Promise.all([
    getSystemConfig('ranking_weight_production', '0.50'),
    getSystemConfig('ranking_weight_qa', '0.30'),
    getSystemConfig('ranking_weight_adherence', '0.15'),
    getSystemConfig('ranking_weight_consistency', '0.05'),
  ]);

  const wProd = parseFloat(weightProduction);
  const wQA = parseFloat(weightQA);
  const wAdh = parseFloat(weightAdherence);
  const wCons = parseFloat(weightConsistency);

  // Normalize production minutes (cap at monthly goal for scoring)
  const monthlyGoal = parseFloat(await getSystemConfig('standard_monthly_goal_hours', '120')) * 60;
  const normalizedProd = Math.min(productionMinutes / monthlyGoal, 1);

  // QA score is 0-100, normalize to 0-1
  const normalizedQA = (qaScore ?? 0) / 100;

  // Adherence is percentage, normalize to 0-1
  const normalizedAdh = (adherence ?? 0) / 100;

  // Consistency bonus is 0-1
  const normalizedCons = Math.min(consistencyBonus, 1);

  const score = (
    normalizedProd * wProd * 100 +
    normalizedQA * wQA * 100 +
    normalizedAdh * wAdh * 100 +
    normalizedCons * wCons * 100
  );

  return Math.round(score * 100) / 100;
}

/**
 * Get private ranking summary for a single interpreter
 * Returns only their position and metrics — no peer data
 */
export async function getPrivateRankingSummary(
  interpreterId: number
): Promise<InterpreterRankingSummary | null> {
  const { startOfMonth, endOfMonth } = getMonthBounds();

  // Get all interpreters' monthly production and QA for ranking calculation
  const allInterpreters = await prisma.interpreter.findMany({
    where: { status: 'Activo' },
    select: {
      id: true,
      name: true,
      monthlyGoal: true,
      productionLogs: {
        where: { date: { gte: startOfMonth, lte: endOfMonth } },
        select: { interpretedMinutes: true, verifiedMinutes: true, adherence: true, date: true },
      },
      qaScores: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { totalScore: true },
      },
    },
  });

  if (allInterpreters.length === 0) return null;

  // Calculate scores for all
  const scored = await Promise.all(
    allInterpreters.map(async (interp) => {
      const totalMinutes = interp.productionLogs.reduce(
        (sum, log) => sum + (log.verifiedMinutes ?? log.interpretedMinutes ?? 0),
        0
      );
      const avgAdherence = interp.productionLogs.length > 0
        ? interp.productionLogs.reduce((sum, log) => sum + Number(log.adherence ?? 0), 0) / interp.productionLogs.length
        : null;
      const rawQaScore = interp.qaScores[0]?.totalScore;
      const qaScore = rawQaScore == null ? null : Number(rawQaScore);
      
      // Simple consistency: days with production / working days in month
      const workingDays = 22; // Approximate
      const activeDays = new Set(interp.productionLogs.map(l => l.date.toISOString().split('T')[0])).size;
      const consistency = activeDays / workingDays;

      const score = await calculateRankingScore(totalMinutes, qaScore, avgAdherence, consistency);
      const monthlyGoal = interp.monthlyGoal ?? parseFloat(await getSystemConfig('standard_monthly_goal_hours', '120')) * 60;
      const goalProgress = Math.min((totalMinutes / monthlyGoal) * 100, 100);

      return {
        id: interp.id,
        name: interp.name,
        totalMinutes,
        score,
        qaScore,
        goalProgress,
        monthlyGoal,
      };
    })
  );

  // Sort by score desc
  scored.sort((a, b) => b.score - a.score);

  const myIndex = scored.findIndex(s => s.id === interpreterId);
  if (myIndex === -1) return null;

  const myData = scored[myIndex];
  const totalEligible = scored.length;
  const position = myIndex + 1;
  const percentile = Math.round(((totalEligible - position) / totalEligible) * 100);

  return {
    position,
    totalEligible,
    score: myData.score,
    ownProductionMinutes: myData.totalMinutes,
    ownGoalProgress: myData.goalProgress,
    ownQaScore: myData.qaScore,
    percentile,
  };
}

/**
 * Get full admin leaderboard with all interpreter details
 */
export async function getAdminLeaderboard(): Promise<AdminRankingRow[]> {
  const { startOfMonth, endOfMonth } = getMonthBounds();

  const allInterpreters = await prisma.interpreter.findMany({
    where: { status: 'Activo' },
    select: {
      id: true,
      name: true,
      campaign: true,
      monthlyGoal: true,
      productionLogs: {
        where: { date: { gte: startOfMonth, lte: endOfMonth } },
        select: { interpretedMinutes: true, verifiedMinutes: true, adherence: true, date: true },
      },
      qaScores: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { totalScore: true },
      },
    },
  });

  const scored = await Promise.all(
    allInterpreters.map(async (interp) => {
      const totalMinutes = interp.productionLogs.reduce(
        (sum, log) => sum + (log.verifiedMinutes ?? log.interpretedMinutes ?? 0),
        0
      );
      const avgAdherence = interp.productionLogs.length > 0
        ? interp.productionLogs.reduce((sum, log) => sum + Number(log.adherence ?? 0), 0) / interp.productionLogs.length
        : null;
      const rawQaScore = interp.qaScores[0]?.totalScore;
      const qaScore = rawQaScore == null ? null : Number(rawQaScore);
      
      const workingDays = 22;
      const activeDays = new Set(interp.productionLogs.map(l => l.date.toISOString().split('T')[0])).size;
      const consistency = activeDays / workingDays;

      const score = await calculateRankingScore(totalMinutes, qaScore, avgAdherence, consistency);
      const monthlyGoal = interp.monthlyGoal ?? parseFloat(await getSystemConfig('standard_monthly_goal_hours', '120')) * 60;
      const goalProgress = Math.min((totalMinutes / monthlyGoal) * 100, 100);

      return {
        interpreterId: interp.id,
        name: interp.name,
        campaign: interp.campaign,
        score,
        productionMinutes: totalMinutes,
        qaScore,
        goalProgress,
      };
    })
  );

  scored.sort((a, b) => b.score - a.score);
  return scored;
}