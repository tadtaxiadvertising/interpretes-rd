import { describe, expect, it } from 'vitest';
import { PayrollRecordPatchSchema } from './api-schemas';

describe('payroll PATCH must preserve unmodified financial amounts', () => {
  it('never injects monetary defaults when updating only a status', () => {
    expect(PayrollRecordPatchSchema.parse({ status: 'PAID' })).toEqual({ status: 'PAID' });
  });

  it('accepts an empty PATCH payload without resetting any persisted value', () => {
    expect(PayrollRecordPatchSchema.parse({})).toEqual({});
  });

  it('allows an explicit zero deduction but leaves unrelated values untouched', () => {
    expect(PayrollRecordPatchSchema.parse({ transferDeduction: 0 })).toEqual({
      transferDeduction: 0,
    });
    expect(PayrollRecordPatchSchema.parse({ qualityBonus: 12.5 })).toEqual({
      qualityBonus: 12.5,
    });
  });

  it.each(['qualityBonus', 'incentivesTotal', 'penalidades', 'transferDeduction'])(
    'still rejects a negative value for %s',
    (field) => {
      expect(PayrollRecordPatchSchema.safeParse({ [field]: -1 }).success).toBe(false);
    },
  );
});
