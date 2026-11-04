import { describe, expect, it } from 'vitest';
import { canMatchCompanyReport } from './reconciliation-match-policy';

describe('company reconciliation MATCHED decision', () => {
  const valid = {
    logCount: 2,
    internalMinutes: 120,
    externalMinutes: 120,
    internalCalls: 8,
    externalCalls: 8,
  };

  it('accepts matching minutes and calls with internal records', () => {
    expect(canMatchCompanyReport(valid)).toBe(true);
  });

  it('rejects reports without internal records, including zero-minute reports', () => {
    expect(canMatchCompanyReport({ ...valid, logCount: 0 })).toBe(false);
    expect(canMatchCompanyReport({ ...valid, logCount: 0, internalMinutes: 0, externalMinutes: 0 })).toBe(false);
  });

  it('rejects minute mismatches', () => {
    expect(canMatchCompanyReport({ ...valid, externalMinutes: 121 })).toBe(false);
  });

  it('rejects call mismatches even when minutes match', () => {
    expect(canMatchCompanyReport({ ...valid, externalCalls: 9 })).toBe(false);
  });

  it('allows missing external call counts but still requires matching minutes and logs', () => {
    expect(canMatchCompanyReport({ ...valid, externalCalls: null })).toBe(true);
  });

  it('does not confuse a reported zero with a missing call count', () => {
    expect(canMatchCompanyReport({ ...valid, externalCalls: 0 })).toBe(false);
  });
});
