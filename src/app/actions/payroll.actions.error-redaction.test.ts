import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validateAction: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: m.validateAction,
}));
vi.mock('@/lib/prisma', () => ({
  default: { $transaction: m.transaction },
}));
vi.mock('next/cache', () => ({
  revalidatePath: m.revalidatePath,
}));

import {
  markPayrollAsPaid,
  updatePayrollAdjustments,
  verifyPayrollMinutes,
} from './payroll.actions';

const actions = [
  {
    name: 'updatePayrollAdjustments',
    run: updatePayrollAdjustments,
    entries: [['id', 'payroll-1'], ['incentives', '12.50'], ['penalties', '0']],
  },
  {
    name: 'verifyPayrollMinutes',
    run: verifyPayrollMinutes,
    entries: [['id', 'payroll-1'], ['verifiedMinutes', '30']],
  },
  {
    name: 'markPayrollAsPaid',
    run: markPayrollAsPaid,
    entries: [['id', 'payroll-1'], ['transactionReference', 'BANK-12345']],
  },
];

function formData(entries: string[][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe('admin payroll Server Actions: safe provider errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.transaction.mockReset();
    m.validateAction.mockReset();
    m.validateAction.mockResolvedValue({ user: { userId: 'admin-1', role: 'admin' } });
  });

  it.each(actions)('$name rejects unauthorized requests before touching payroll', async ({ run, entries }) => {
    m.validateAction.mockResolvedValueOnce({ error: 'Forbidden', code: 'FORBIDDEN' });

    const result = await run(undefined, formData(entries));

    expect(result).toMatchObject({ success: false, code: 'FORBIDDEN' });
    expect(m.validateAction).toHaveBeenCalledWith('admin');
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(actions)('$name redacts sensitive database connection errors from return values and logs', async ({ name, run, entries }) => {
    m.transaction.mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@internal-db.invalid/payroll'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await run(undefined, formData(entries));

      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.transaction).toHaveBeenCalledTimes(1);
      expect(m.revalidatePath).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(`${name} failed:`, 'Error');
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
    } finally {
      log.mockRestore();
    }
  });

  it('handles a non-Error rejection without serializing the thrown payload', async () => {
    m.transaction.mockRejectedValueOnce({
      connection: 'postgresql://admin:PRIVATE_PASSWORD@internal-db.invalid/payroll',
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await markPayrollAsPaid(undefined, formData(actions[2].entries));
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(log).toHaveBeenCalledWith('markPayrollAsPaid failed:', 'UnknownError');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally {
      log.mockRestore();
    }
  });
});
