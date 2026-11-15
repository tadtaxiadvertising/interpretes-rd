import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validateAction: vi.fn(),
  upsert: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag: m.revalidateTag,
  revalidatePath: m.revalidatePath,
}));
vi.mock('@/lib/auth/actions', () => ({
  validateAction: m.validateAction,
}));
vi.mock('@/lib/prisma', () => ({
  default: { systemConfig: { upsert: m.upsert } },
}));
vi.mock('@/lib/security/safe-server-error', () => ({
  safeServerErrorCategory: vi.fn(() => 'DatabaseError'),
}));

import { updateSystemConfig } from './settings';

describe('system configuration admin Server Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validateAction.mockResolvedValue({
      user: { userId: 'admin-1', role: 'admin' },
    });
    m.upsert.mockResolvedValue({ key: 'standard_monthly_goal_hours' });
  });

  it('rejects unauthorized callers before reading or changing private configuration', async () => {
    m.validateAction.mockResolvedValueOnce({
      error: 'Forbidden',
      code: 'UNAUTHORIZED',
    });
    const result = await updateSystemConfig('ranking_weight_qa', '0.50');
    expect(result.success).toBe(false);
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.revalidateTag).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('invalidates SystemConfig data immediately after an authorized successful write', async () => {
    expect(await updateSystemConfig('standard_monthly_goal_hours', '150')).toEqual({ success: true });
    expect(m.validateAction).toHaveBeenCalledWith('admin');
    expect(m.upsert).toHaveBeenCalledWith({
      where: { key: 'standard_monthly_goal_hours' },
      update: { value: '150' },
      create: { key: 'standard_monthly_goal_hours', value: '150' },
      select: { key: true },
    });
    expect(m.revalidateTag).toHaveBeenCalledWith('system-config');
    expect(m.revalidatePath).toHaveBeenCalledWith('/admin');
    expect(m.revalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('never invalidates caches if the database write fails', async () => {
    m.upsert.mockRejectedValueOnce(new Error('DB:PRIVATE_PASSWORD@internal.invalid'));
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await updateSystemConfig('ranking_weight_qa', '0.70')).toMatchObject({
        success: false,
        code: 'INTERNAL_ERROR',
      });
      expect(m.revalidateTag).not.toHaveBeenCalled();
      expect(m.revalidatePath).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally {
      warn.mockRestore();
    }
  });
});
