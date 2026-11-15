import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  interpreterFindMany: vi.fn(),
  interpreterFindUnique: vi.fn(),
  metricsFindMany: vi.fn(),
  metricsUpsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: {
      findMany: m.interpreterFindMany,
      findUnique: m.interpreterFindUnique,
    },
    interpreterMonthlyMetrics: {
      findMany: m.metricsFindMany,
      upsert: m.metricsUpsert,
    },
    $transaction: m.transaction,
  },
}));

import {
  updateInterpreterMetrics,
  recalculateRankings,
  refreshAllMetrics,
} from '../metrics-service';

const secretError = () =>
  new Error('postgresql://db:PRIVATE_PASSWORD@internal-db.invalid/production?token=PRIVATE_PASSWORD');

describe('metrics service private error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose raw Prisma failures as action return values or logs', async () => {
    m.interpreterFindUnique.mockRejectedValueOnce(secretError());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await updateInterpreterMetrics(7, '2026-10');
      expect(result).toEqual({ error: 'Failed to update interpreter metrics' });
      expect(log).toHaveBeenCalledWith('[METRICS] updateInterpreterMetrics error:', 'Error');
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
    } finally {
      log.mockRestore();
    }
  });

  it('does not log private DB errors when recalculation fails', async () => {
    m.metricsFindMany.mockRejectedValueOnce(secretError());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await recalculateRankings('2026-10')).toBe(0);
      expect(log).toHaveBeenCalledWith('[METRICS] recalculateRankings error:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
    } finally {
      log.mockRestore();
    }
  });

  it('does not log internal interpreter identifiers or provider error details on partial failures', async () => {
    m.interpreterFindMany.mockResolvedValueOnce([{ id: 75321 }]);
    m.interpreterFindUnique.mockRejectedValueOnce(secretError());
    m.metricsFindMany.mockResolvedValueOnce([]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await refreshAllMetrics()).toEqual({ updated: 0, errors: 1 });
      const messages = JSON.stringify(log.mock.calls);
      expect(messages).toContain('Interpreter metric refresh failed');
      expect(messages).not.toMatch(/75321|PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
    } finally {
      log.mockRestore();
    }
  });

  it('does not log sensitive database details if the interpreter roster lookup fails', async () => {
    m.interpreterFindMany.mockRejectedValueOnce(secretError());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await refreshAllMetrics()).toEqual({ updated: 0, errors: 1 });
      expect(log).toHaveBeenCalledWith('[METRICS] refreshAllMetrics error:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally {
      log.mockRestore();
    }
  });
});
