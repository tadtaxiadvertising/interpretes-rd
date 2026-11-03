import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { COMPANY_CSV_COLUMNS, validateCompanyCsvHeaders } from './company-csv-validation';

describe('Company CSV import headers', () => {
  const header = COMPANY_CSV_COLUMNS.join(',');
  const row = '1,2026-11-01,2026-11-03,November report,240,15,Initial import';
  const parseCsv = (input: string) => parse(input, {
    columns: validateCompanyCsvHeaders,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: false,
    max_record_size: 4096,
  });

  it('accepts a valid report', () => {
    const records = parseCsv(`${header}\n${row}\n`);
    expect(records).toHaveLength(1);
    expect(records[0].reportedMinutes).toBe('240');
  });

  it('rejects reordered headers', () => {
    expect(() => validateCompanyCsvHeaders(['periodStart', 'accountId', ...COMPANY_CSV_COLUMNS.slice(2)])).toThrow();
  });

  it('rejects duplicate headers', () => {
    expect(() => validateCompanyCsvHeaders([...COMPANY_CSV_COLUMNS.slice(0, -1), 'accountId'])).toThrow();
  });

  it('rejects unexpected columns', () => {
    expect(() => validateCompanyCsvHeaders([...COMPANY_CSV_COLUMNS, 'extra'])).toThrow();
  });

  it('rejects malformed row column count', () => {
    expect(() => parseCsv(`${header}\n1,2026-11-01\n`)).toThrow();
  });

  it('supports UTF-8 BOM', () => {
    expect(parseCsv(`\uFEFF${header}\n${row}\n`)).toHaveLength(1);
  });
});
