export const COMPANY_CSV_COLUMNS = [
  'accountId',
  'periodStart',
  'periodEnd',
  'sourceName',
  'reportedMinutes',
  'reportedCalls',
  'notes',
] as const;

export function validateCompanyCsvHeaders(headers: string[]): string[] {
  if (headers.length !== COMPANY_CSV_COLUMNS.length ||
      headers.some((header, index) => header !== COMPANY_CSV_COLUMNS[index])) {
    throw new Error('Invalid CSV headers');
  }
  return headers;
}
