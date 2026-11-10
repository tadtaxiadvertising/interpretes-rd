import { describe, expect, it } from 'vitest';
import {
  isValidPayrollAmount,
  parsePayrollMoney,
  parseVerifiedPayrollMinutes,
} from './payroll-validation';

describe('payroll input validation', () => {
  it('accepts monetary values with at most two decimal places', () => {
    expect(parsePayrollMoney('0')).toBe(0);
    expect(parsePayrollMoney('125.5')).toBe(125.5);
    expect(parsePayrollMoney('99999999.99')).toBe(99_999_999.99);
  });

  it.each(['', null, '-1', '1.001', '1e3', '12abc', '100000000', '01.00'])(
    'rejects malformed or out-of-range money: %s',
    (value) => expect(parsePayrollMoney(value)).toBeNull(),
  );

  it('accepts only bounded positive integer minute values', () => {
    expect(parseVerifiedPayrollMinutes('1')).toBe(1);
    expect(parseVerifiedPayrollMinutes('100000')).toBe(100_000);
  });

  it.each(['0', '-1', '1.5', '12abc', '1e3', '100001', ''])(
    'rejects invalid minute values: %s',
    (value) => expect(parseVerifiedPayrollMinutes(value)).toBeNull(),
  );

  it('rejects non-finite, negative, and database-overflow totals', () => {
    expect(isValidPayrollAmount(10.25)).toBe(true);
    expect(isValidPayrollAmount(Number.NaN)).toBe(false);
    expect(isValidPayrollAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidPayrollAmount(-0.01)).toBe(false);
    expect(isValidPayrollAmount(100_000_000)).toBe(false);
  });
});
