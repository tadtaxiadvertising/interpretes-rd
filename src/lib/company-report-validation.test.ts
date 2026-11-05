import { describe, expect, it } from 'vitest';
import { nonNegativeIntegerInput } from './company-report-validation';

describe('nonNegativeIntegerInput', () => {
  it.each(['0', '1', '240', '0007'])('accepts the non-negative integer string %s', value => {
    expect(nonNegativeIntegerInput.safeParse(value).success).toBe(true);
  });

  it.each(['', '   ', '-1', '1.5', '1e2', 'abc', '100000001'])('rejects invalid integer string %j', value => {
    expect(nonNegativeIntegerInput.safeParse(value).success).toBe(false);
  });
});
