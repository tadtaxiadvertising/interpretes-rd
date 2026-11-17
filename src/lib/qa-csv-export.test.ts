import { describe, expect, it } from 'vitest';
import { buildQaScoresCsv, qaSafeCsvCell } from './qa-csv-export';

const row = {
  id: 1,
  auditDate: '2026-11-17T08:30:00.000Z',
  auditor: 'Evaluator',
  totalScore: 100,
  criticalError: false,
  comentarios: 'Evaluación excelente',
  interpreter: { name: 'Intérprete Uno' },
};

describe('QA spreadsheet CSV export safety', () => {
  it('escapes commas and embedded quotes without creating extra columns', () => {
    expect(qaSafeCsvCell('Ada, "Medical"')).toBe('"Ada, ""Medical"""');
    expect(qaSafeCsvCell('Simple')).toBe('"Simple"');
  });

  it.each([
    '=HYPERLINK("https://bad.invalid","click")',
    '+SUM(1,2)',
    '-5+9',
    '@SUM(1,2)',
    '   =cmd|"/C calc"!A0',
    '\t=1+1',
    '\r\n=1+1',
  ])('neutralizes spreadsheet formula syntax: %s', (value) => {
    const csv = qaSafeCsvCell(value);
    expect(csv.startsWith('"\'')).toBe(true);
    expect(csv).not.toContain('\r');
    expect(csv).not.toContain('\n');
    expect(csv).not.toContain('\t');
  });

  it('does not let multi-line comments create new CSV records', () => {
    expect(qaSafeCsvCell('First line\n=EVIL(1)\rSecond line')).toBe(
      '"First line =EVIL(1) Second line"',
    );
  });

  it('formats UTF-8 QA exports with exactly one physical row per record', () => {
    const csv = buildQaScoresCsv([{
      ...row,
      auditor: '=WEBSERVICE("https://bad.invalid")',
      comentarios: 'Bien, con "comillas"\n=cmd|"/C calc"!A0',
      interpreter: { name: ' +SUM(1,2)' },
    }]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3); // heading, record, final newline
    expect(csv).toContain('"\'=WEBSERVICE(""https://bad.invalid"")"');
    expect(csv).toContain('"\'+SUM(1,2)"');
    expect(csv).toContain('"Bien, con ""comillas"" =cmd|""/C calc""!A0"');
    expect(csv).toContain('"100%"');
    expect(csv).toContain('"2026-11-17"');
  });

  it('does not crash on missing interpreter, empty comment or invalid date', () => {
    const csv = buildQaScoresCsv([{
      ...row, interpreter: null, comentarios: null, auditDate: 'invalid',
    }]);
    expect(csv).toContain('"Desconocido"');
    expect(csv).toContain('""');
    expect(csv).not.toContain('Invalid Date');
  });

  it('keeps a negative numeric value inert even with malformed upstream data', () => {
    const csv = buildQaScoresCsv([{ ...row, totalScore: -7 }]);
    expect(csv).toContain('"\'-7%"');
  });
});
