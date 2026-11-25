import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { prepareProductionCsv } from './production-csv-chunks';

describe('production CSV browser preparation', () => {
  it('preserves multiline fields, escaped quotes, accented text and blank lines inside quoted fields', async () => {
    const csv = '\uFEFFDate,External ID,Minutes,Notes\r\n2026-11-01,TEST,10,"José, ""médico""\r\n\r\nSegunda línea"\r\n\r\n2026-11-02,TEST,20,"  texto  "\r\n';
    const prepared = await prepareProductionCsv(csv);
    expect(prepared.headers).toBe('Date,External ID,Minutes,Notes');
    expect(prepared.totalRows).toBe(2);
    expect(prepared.chunks).toHaveLength(1);
    expect(prepared.chunks[0]).toHaveLength(2);
    expect(parse([prepared.headers, ...prepared.chunks[0]].join('\n'), {
      columns: true, trim: true, record_delimiter: ['\r\n', '\n', '\r'],
    })).toEqual([
      { Date: '2026-11-01', 'External ID': 'TEST', Minutes: '10', Notes: 'José, "médico"\r\n\r\nSegunda línea' },
      { Date: '2026-11-02', 'External ID': 'TEST', Minutes: '20', Notes: '  texto  ' },
    ]);
  });

  it('keeps a multiline record intact at the 500-record boundary', async () => {
    const row = '2026-11-01,TEST,10,"Primera\nSegunda"';
    const prepared = await prepareProductionCsv(['Date,External ID,Minutes,Notes', ...Array(501).fill(row)].join('\n'));
    expect(prepared.totalRows).toBe(501);
    expect(prepared.chunks.map(chunk => chunk.length)).toEqual([500, 1]);
    expect(prepared.chunks[0][499]).toBe(row);
    expect(prepared.chunks[1][0]).toBe(row);
  });

  it('reduces block size to fit the escaped UTF-8 request budget', async () => {
    const row = '2026-11-01,TEST,10,"' + 'á"'.replace('"', '""').repeat(1000) + '"';
    const prepared = await prepareProductionCsv(['Date,External ID,Minutes,Notes', ...Array(200).fill(row)].join('\n'));
    expect(prepared.totalRows).toBe(200);
    expect(prepared.chunks.length).toBeGreaterThan(1);
    for (const rows of prepared.chunks) {
      expect(new TextEncoder().encode(JSON.stringify({ headers: prepared.headers, rows })).length).toBeLessThanOrEqual(512 * 1024);
      expect(rows.length).toBeLessThanOrEqual(500);
    }
  });

  it.each([
    'Date,External ID\n2026-11-01,"TEST',
    'Date,External ID\n2026-11-01,TEST,extra',
    'Date,External ID\n',
    'Date,External ID\n2026-11-01,' + 'x'.repeat(9000),
  ])('rejects malformed or oversized input before sending any block', async text => {
    await expect(prepareProductionCsv(text)).rejects.toThrow(/CSV|fila/);
  });
});
