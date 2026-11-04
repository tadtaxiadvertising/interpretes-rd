export type CompanyReportComparison = {
  logCount: number;
  internalMinutes: number;
  externalMinutes: number;
  internalCalls: number;
  externalCalls: number | null;
};

/** A numerical match requires actual internal production, equal minutes,
 * and equal calls whenever the external report supplies a call count. */
export function canMatchCompanyReport(comparison: CompanyReportComparison): boolean {
  return comparison.logCount > 0 &&
    comparison.internalMinutes === comparison.externalMinutes &&
    (comparison.externalCalls === null || comparison.internalCalls === comparison.externalCalls);
}
