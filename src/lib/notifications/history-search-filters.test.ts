import { describe, expect, it } from 'vitest';
import { HistorySearchFiltersSchema } from './history-search-filters';

describe('history search filters', () => {
  it('accepts literal text and inclusive same-day ranges', () => {
    expect(HistorySearchFiltersSchema.parse({ search: '  QA 100%_  ', fromDate: '2024-02-29', toDate: '2024-02-29' })).toEqual({ search: 'QA 100%_', fromDate: '2024-02-29', toDate: '2024-02-29' });
    expect(HistorySearchFiltersSchema.safeParse({}).success).toBe(true);
    expect(HistorySearchFiltersSchema.safeParse({ toDate: '2026-11-25' }).success).toBe(true);
  });
  it.each([{search:'x'}, {search:'a'.repeat(81)}, {search:'ab\u0000cd'}, {fromDate:'2026-02-29'}, {toDate:'2026-04-31'}, {fromDate:'2026-12-01',toDate:'2026-11-30'}, {userId:'another-account'}])('rejects malformed filters %j', input => {
    expect(HistorySearchFiltersSchema.safeParse(input).success).toBe(false);
  });
});
