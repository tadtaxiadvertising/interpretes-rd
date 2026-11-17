import { describe, expect, it } from 'vitest';
import { formatStudioTime } from './format-time';

describe('Audio Studio time labels', () => {
  it.each([
    [0, '00:00.0'],
    [0.04, '00:00.0'],
    [0.05, '00:00.1'],
    [5.3, '00:05.3'],
    [59.94, '00:59.9'],
    [59.96, '01:00.0'],
    [3599.94, '59:59.9'],
    [3599.96, '01:00:00.0'],
    [3600.05, '01:00:00.1'],
    [43199.96, '12:00:00.0'],
  ])('rounds %s seconds to valid display %s', (value, expected) => {
    expect(formatStudioTime(value)).toBe(expected);
  });

  it('renders unusable and negative timestamps safely', () => {
    for (const value of [NaN, Infinity, -Infinity, -100]) {
      expect(formatStudioTime(value)).toBe('00:00.0');
    }
  });

  it('does not change edit/export interval values', () => {
    const source = { start: 59.96, end: 60.14 };
    expect(formatStudioTime(source.start)).toBe('01:00.0');
    expect(source).toEqual({ start: 59.96, end: 60.14 });
  });
});
