import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateRankingScore, getPrivateRankingSummary, getAdminLeaderboard } from '../calculate';

const systemConfigValues: Record<string, string> = {
  'ranking_weight_production': '0.50',
  'ranking_weight_qa': '0.30',
  'ranking_weight_adherence': '0.15',
  'ranking_weight_consistency': '0.05',
  'standard_monthly_goal_hours': '120',
};

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/system-config', () => ({
  getSystemConfig: vi.fn((key: string) => Promise.resolve(systemConfigValues[key] || '0')),
}));

import prisma from '@/lib/prisma';
import { getSystemConfig } from '@/lib/system-config';

describe('Ranking Calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateRankingScore', () => {
    it('calculates score with default weights', async () => {
      const score = await calculateRankingScore(
        3600, // 60 hours = 3600 minutes
        90,   // QA score
        95,   // adherence
        0.8   // consistency
      );

      // Monthly goal = 120 hours = 7200 minutes
      // normalizedProd = 3600/7200 = 0.5
      // normalizedQA = 90/100 = 0.9
      // normalizedAdh = 95/100 = 0.95
      // normalizedCons = 0.8
      // score = 0.5*0.5*100 + 0.9*0.3*100 + 0.95*0.15*100 + 0.8*0.05*100
      // = 25 + 27 + 14.25 + 4 = 70.25
      expect(score).toBeCloseTo(70.25, 1);
    });

    it('handles missing QA score', async () => {
      const score = await calculateRankingScore(
        7200, // full goal
        null, // no QA
        100,
        1.0
      );

      // normalizedProd = 1.0, normalizedQA = 0, normalizedAdh = 1.0, normalizedCons = 1.0
      // score = 1.0*0.5*100 + 0*0.3*100 + 1.0*0.15*100 + 1.0*0.05*100 = 50 + 0 + 15 + 5 = 70
      expect(score).toBe(70);
    });

    it('caps production at monthly goal', async () => {
      const score = await calculateRankingScore(
        14400, // double the goal
        100,
        100,
        1.0
      );

      // normalizedProd should be capped at 1.0
      // score = 1.0*0.5*100 + 1.0*0.3*100 + 1.0*0.15*100 + 1.0*0.05*100 = 50 + 30 + 15 + 5 = 100
      expect(score).toBe(100);
    });
  });

  describe('getPrivateRankingSummary', () => {
    it('returns null when no interpreters', async () => {
      (prisma.interpreter.findMany as any).mockResolvedValue([]);

      const result = await getPrivateRankingSummary(42);
      expect(result).toBeNull();
    });

    it('returns ranking summary for interpreter', async () => {
      const today = new Date();
      (prisma.interpreter.findMany as any).mockResolvedValue([
        { id: 1, name: 'A', monthlyGoal: 7200, productionLogs: [{ verifiedMinutes: 4000, interpretedMinutes: 4000, date: today }], qaScores: [{ totalScore: 90 }] },
        { id: 42, name: 'Me', monthlyGoal: 7200, productionLogs: [{ verifiedMinutes: 5000, interpretedMinutes: 5000, date: today }], qaScores: [{ totalScore: 95 }] },
        { id: 3, name: 'C', monthlyGoal: 7200, productionLogs: [{ verifiedMinutes: 3000, interpretedMinutes: 3000, date: today }], qaScores: [{ totalScore: 85 }] },
      ]);

      const result = await getPrivateRankingSummary(42);

      expect(result).not.toBeNull();
      expect(result?.position).toBe(1); // Should be first with highest score
      expect(result?.totalEligible).toBe(3);
      expect(result?.ownProductionMinutes).toBe(5000);
      expect(result?.ownGoalProgress).toBeGreaterThan(0);
      expect(result?.ownQaScore).toBe(95);
    });

    it('returns null when interpreter not found', async () => {
      (prisma.interpreter.findMany as any).mockResolvedValue([
        { id: 1, name: 'A', monthlyGoal: 7200, productionLogs: [], qaScores: [] },
      ]);

      const result = await getPrivateRankingSummary(999);
      expect(result).toBeNull();
    });
  });

  describe('getAdminLeaderboard', () => {
    it('returns full leaderboard with all interpreter data', async () => {
      const today = new Date();
      (prisma.interpreter.findMany as any).mockResolvedValue([
        { id: 1, name: 'A', campaign: 'Campaign 1', monthlyGoal: 7200, productionLogs: [{ verifiedMinutes: 4000, date: today }], qaScores: [{ totalScore: 90 }] },
        { id: 2, name: 'B', campaign: 'Campaign 2', monthlyGoal: 7200, productionLogs: [{ verifiedMinutes: 5000, date: today }], qaScores: [{ totalScore: 95 }] },
      ]);

      const result = await getAdminLeaderboard();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        interpreterId: expect.any(Number),
        name: expect.any(String),
        campaign: expect.any(String),
        score: expect.any(Number),
        productionMinutes: expect.any(Number),
        qaScore: expect.any(Number),
        goalProgress: expect.any(Number),
      }));
      // Should be sorted by score desc
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    });
  });
});