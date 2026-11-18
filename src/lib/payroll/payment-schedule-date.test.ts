// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getSantoDomingoPaymentDay } from './payment-schedule-date';

describe('payroll payment day in America/Santo_Domingo', () => {
  it('uses the previous local day before 04:00 UTC', () => {
    expect(getSantoDomingoPaymentDay(new Date('2026-11-18T00:30:00Z'))).toEqual({
      dayOfWeek: 'Tuesday',
      dayOfMonth: '17',
    });
  });

  it('does not advance weekly/biweekly eligibility before local midnight', () => {
    expect(getSantoDomingoPaymentDay(new Date('2026-11-19T02:30:00Z'))).toEqual({
      dayOfWeek: 'Wednesday',
      dayOfMonth: '18',
    });
  });

  it('changes eligibility exactly at Santo Domingo midnight', () => {
    expect(getSantoDomingoPaymentDay(new Date('2026-11-19T04:00:00Z'))).toEqual({
      dayOfWeek: 'Thursday',
      dayOfMonth: '19',
    });
  });

  it('does not shift a December payroll into January on UTC New Year', () => {
    expect(getSantoDomingoPaymentDay(new Date('2026-01-01T02:00:00Z'))).toEqual({
      dayOfWeek: 'Wednesday',
      dayOfMonth: '31',
    });
    expect(getSantoDomingoPaymentDay(new Date('2026-01-01T04:00:00Z'))).toEqual({
      dayOfWeek: 'Thursday',
      dayOfMonth: '1',
    });
  });

  it('remains on the prior year when UTC rolls forward', () => {
    expect(getSantoDomingoPaymentDay(new Date('2027-01-01T02:30:00Z'))).toEqual({
      dayOfWeek: 'Thursday',
      dayOfMonth: '31',
    });
  });

  it('rejects invalid timestamps rather than determining a wrong date', () => {
    expect(() => getSantoDomingoPaymentDay(new Date(Number.NaN))).toThrow();
  });
});
