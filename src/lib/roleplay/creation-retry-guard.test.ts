import { describe, expect, it, vi } from 'vitest';
import { confirmRoleplayCreationRetry } from './creation-retry-guard';

describe('roleplay creation retry guard', () => {
  it.each([[false, false], [false, true], [true, true]])(
    'allows normal or resumed attempts without a duplicate confirmation (%s, %s)',
    (uncertain, resuming) => {
      const confirm = vi.fn(() => false);
      expect(confirmRoleplayCreationRetry(uncertain, resuming, confirm)).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])('requires a deliberate decision for a new attempt after uncertainty (%s)', answer => {
    const confirm = vi.fn(() => answer);
    expect(confirmRoleplayCreationRetry(true, false, confirm)).toBe(answer);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls).toEqual([[expect.stringContaining('riesgo de duplicados')]]);
  });
  it('asks again after cancellation rather than treating cancellation as resolution', () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(confirmRoleplayCreationRetry(true, false, confirm)).toBe(false);
    expect(confirmRoleplayCreationRetry(true, false, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
