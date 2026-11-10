import { describe, expect, it } from 'vitest';
import { parseProductionAdherence, parseProductionMinutes } from './production-csv-validation';

describe('production CSV numeric fields', () => {
  it.each([['', 0], ['0', 0], ['120', 120], ['100000', 100_000]])(
    'accepts valid minutes %s',
    (value, expected) => expect(parseProductionMinutes(value)).toBe(expected),
  );

  it.each(['-1', '1.5', '100001', '1e3', '12abc'])(
    'rejects invalid minutes %s',
    (value) => expect(parseProductionMinutes(value)).toBeNull(),
  );

  it.each([['', 0], ['0', 0], ['98.5', 98.5], ['100', 100], ['100.00', 100], ['100%', 100], ['93%', 93], ['98.5%', 98.5]])(
    'accepts valid adherence %s',
    (value, expected) => expect(parseProductionAdherence(value)).toBe(expected),
  );

  it.each(['-1', '100.01', '1.234', '1e2', 'abc'])(
    'rejects invalid adherence %s',
    (value) => expect(parseProductionAdherence(value)).toBeNull(),
  );
});
