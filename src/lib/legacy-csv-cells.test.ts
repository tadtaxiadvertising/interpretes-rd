import { describe, expect, it } from 'vitest';
import { csvNumberCell, csvTextCell } from './legacy-csv-cells';

describe('legacy administrative CSV serialization', () => {
  it.each(['=1+1', '+1+1', '-1+1', '@SUM(1,2)', '  =1+1', '\t=1+1', '\r\n=1+1', '＝1+1', '＋1+1', '－1+1', '＠SUM(1,2)'])(
    'neutralizes formula-like text: %s',
    value => {
      const cell = csvTextCell(value);
      expect(cell.startsWith("\"'")).toBe(true);
      expect(cell).not.toMatch(/[\r\n\t]/);
    }
  );

  it('preserves ordinary text and escapes delimiters, quotes and line breaks', () => {
    expect(csvTextCell('Santiago')).toBe('Santiago');
    expect(csvTextCell('José', true)).toBe('"José"');
    expect(csvTextCell('Ana, "María"')).toBe('"Ana, ""María"""');
    expect(csvTextCell('Una línea\r\nOtra línea')).toBe('Una línea Otra línea');
    expect(csvTextCell('00123')).toBe('00123');
    expect(csvTextCell('+18095550123')).toBe("\"'+18095550123\"");
  });

  it('preserves numeric amounts, including negative adjustments and decimal precision', () => {
    expect(csvNumberCell(-125.5)).toBe('-125.5');
    expect(csvNumberCell('-125.50')).toBe('-125.50');
    expect(csvNumberCell('120.00')).toBe('120.00');
    expect(csvNumberCell(0)).toBe('0');
    expect(csvNumberCell('1e-7')).toBe('1e-7');
    expect(csvNumberCell('-1+1')).toBe("\"'-1+1\"");
    expect(csvNumberCell('=1+1')).toBe("\"'=1+1\"");
  });
});
