import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateInterpreterMetrics, recalculateRankings, refreshAllMetrics, getInterpreterMetrics, getLeaderboard } from '@/services/metrics/metrics-service';
import type { MetricUpdateResult } from '@/services/metrics/metrics-service';

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    interpreterMonthlyMetrics: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    productionLog: {
      findMany: vi.fn(),
    },
    qAScore: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from '@/lib/prisma';

const mockPrisma = prisma as any;

describe('Metrics Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateInterpreterMetrics', () => {
    it('should calculate and upsert metrics for an interpreter', async () => {
      const mockInterpreter = {
        id: 1,
        productionLogs: [
          { interpretedMinutes: 120, verifiedMinutes: 120 },
          { interpretedMinutes: 180, verifiedMinutes: 180 },
        ],
        qaScores: [{ totalScore: 85.5 }],
      };
      mockPrisma.interpreter.findUnique.mockResolvedValue(mockInterpreter);
      mockPrisma.interpreterMonthlyMetrics.upsert.mockResolvedValue({
        interpreterId: 1,
        period: '2026-10',
        interpretedMinutes: 300,
        qaScore: 85.5,
        rankingPosition: null,
        totalInterpreters: 0,
      });

      const result = await updateInterpreterMetrics(1, '2026-10');

      if ('error' in result) {
        throw new Error('Expected success but got error');
      }
      expect(result).toEqual({
        interpreterId: 1,
        period: '2026-10',
        interpretedMinutes: 300,
        qaScore: 85.5,
        rankingPosition: null,
        totalInterpreters: 0,
      });
    });

    it('preserves a valid zero QA score after monthly metrics are updated', async () => {
      mockPrisma.interpreter.findUnique.mockResolvedValue({
        id: 1,
        productionLogs: [],
        qaScores: [{ totalScore: 0 }],
      });
      mockPrisma.interpreterMonthlyMetrics.upsert.mockResolvedValue({
        interpreterId: 1,
        period: '2026-10',
        interpretedMinutes: 0,
        qaScore: 0,
        rankingPosition: null,
        totalInterpreters: 1,
      });

      const result = await updateInterpreterMetrics(1, '2026-10');
      expect(result).toMatchObject({ qaScore: 0 });
    });

    it('should handle interpreter with no production logs', async () => {
      const mockInterpreter = {
        id: 2,
        productionLogs: [],
        qaScores: [],
      };
      mockPrisma.interpreter.findUnique.mockResolvedValue(mockInterpreter);
      mockPrisma.interpreterMonthlyMetrics.upsert.mockResolvedValue({
        interpreterId: 2,
        period: '2026-10',
        interpretedMinutes: 0,
        qaScore: null,
        rankingPosition: null,
        totalInterpreters: 0,
      });

      const result = await updateInterpreterMetrics(2, '2026-10');

      if ('error' in result) {
        throw new Error('Expected success but got error');
      }
      expect(result.interpretedMinutes).toBe(0);
      expect(result.qaScore).toBeNull();
    });

    it('should return error for non-existent interpreter', async () => {
      mockPrisma.interpreter.findUnique.mockResolvedValue(null);

      const result = await updateInterpreterMetrics(999);

      expect(result).toEqual({ error: 'Interpreter not found' });
    });
  });

  describe('recalculateRankings', () => {
    it('should update ranking positions based on minutes and QA score', async () => {
      const mockMetrics = [
        { id: 1, interpreterId: 1, interpretedMinutes: 500, qaScore: 90 },
        { id: 2, interpreterId: 2, interpretedMinutes: 400, qaScore: 95 },
        { id: 3, interpreterId: 3, interpretedMinutes: 400, qaScore: 85 },
      ];
      mockPrisma.interpreterMonthlyMetrics.findMany.mockResolvedValue(mockMetrics);
      mockPrisma.$transaction.mockResolvedValue(undefined);

      const result = await recalculateRankings('2026-10');

      expect(result).toBe(3);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should return 0 for empty period', async () => {
      mockPrisma.interpreterMonthlyMetrics.findMany.mockResolvedValue([]);

      const result = await recalculateRankings('2026-10');

      expect(result).toBe(0);
    });
  });

  describe('getInterpreterMetrics', () => {
    it('should return metrics from materialized view', async () => {
      mockPrisma.interpreterMonthlyMetrics.findUnique.mockResolvedValue({
        interpreterId: 1,
        period: '2026-10',
        interpretedMinutes: 250,
        qaScore: 88.5,
        rankingPosition: 3,
        totalInterpreters: 25,
      });

      const result = await getInterpreterMetrics(1, '2026-10');

      expect(result).toEqual({
        interpretedMinutes: 250,
        qaScore: 88.5,
        rankingPosition: 3,
        totalInterpreters: 25,
      });
    });

    it('distinguishes zero QA from an absent score in interpreter metrics', async () => {
      mockPrisma.interpreterMonthlyMetrics.findUnique.mockResolvedValue({
        interpretedMinutes: 0,
        qaScore: 0,
        rankingPosition: 10,
        totalInterpreters: 10,
      });
      expect(await getInterpreterMetrics(1, '2026-10')).toMatchObject({ qaScore: 0 });

      mockPrisma.interpreterMonthlyMetrics.findUnique.mockResolvedValue({
        interpretedMinutes: 0,
        qaScore: null,
        rankingPosition: 10,
        totalInterpreters: 10,
      });
      expect(await getInterpreterMetrics(1, '2026-10')).toMatchObject({ qaScore: null });
    });

    it('should return null for non-existent metrics', async () => {
      mockPrisma.interpreterMonthlyMetrics.findUnique.mockResolvedValue(null);

      const result = await getInterpreterMetrics(999);

      expect(result).toBeNull();
    });
  });

  describe('getLeaderboard', () => {
    it('shows zero QA as a measured score in the leaderboard rather than missing data', async () => {
      mockPrisma.interpreterMonthlyMetrics.findMany.mockResolvedValue([
        {
          interpreterId: 1, interpretedMinutes: 10, qaScore: 0,
          rankingPosition: 2, interpreter: { name: 'Interpreter with zero QA' },
        },
        {
          interpreterId: 2, interpretedMinutes: 9, qaScore: null,
          rankingPosition: 3, interpreter: { name: 'Interpreter without QA' },
        },
      ]);

      const leaderboard = await getLeaderboard('2026-10', 2);
      expect(leaderboard.map((entry) => entry.qaScore)).toEqual([0, null]);
    });

    it('should return top interpreters ordered by minutes and QA', async () => {
      const mockMetrics = [
        { interpreterId: 1, interpretedMinutes: 500, qaScore: 90, rankingPosition: 1, interpreter: { name: 'Top Interpreter' } },
        { interpreterId: 2, interpretedMinutes: 400, qaScore: 95, rankingPosition: 2, interpreter: { name: 'Second Best' } },
        { interpreterId: 3, interpretedMinutes: 300, qaScore: 80, rankingPosition: 3, interpreter: { name: 'Third Place' } },
      ];
      mockPrisma.interpreterMonthlyMetrics.findMany.mockResolvedValue(mockMetrics);

      const result = await getLeaderboard('2026-10', 3);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Top Interpreter');
      expect(result[0].interpretedMinutes).toBe(500);
      expect(result[0].rankingPosition).toBe(1);
    });
  });
});