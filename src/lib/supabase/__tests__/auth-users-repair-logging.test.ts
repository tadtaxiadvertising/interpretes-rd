// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  listUsers: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { auth: { admin: { listUsers: m.listUsers, updateUserById: m.updateUserById } } },
  isAdminUnavailableError: () => false,
}));

import { repairAuthUser } from '../auth-users';

const email = 'private.employee@example.test';
const input = { email, password: 'fictional-password-only', displayName: 'Test Interpreter' };

describe('repairAuthUser log privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.listUsers.mockResolvedValue({ data: { users: [], nextPage: null }, error: null });
  });

  it('never logs an absent identity email and does not attempt to create or update Auth', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const legacyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await repairAuthUser(input)).toBeNull();
      expect(m.listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 });
      expect(m.updateUserById).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('[AUTH-USERS] repairAuthUser: account missing; no automatic repair attempted');
      expect(JSON.stringify([...log.mock.calls, ...legacyLog.mock.calls])).not.toContain(email);
    } finally {
      log.mockRestore();
      legacyLog.mockRestore();
    }
  });

  it('refuses to repair a broken identity without deleting or recreating it', async () => {
    m.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: 'existing-auth-id', email, identities: [], user_metadata: {} }], nextPage: null },
      error: null,
    });
    await expect(repairAuthUser(input)).rejects.toThrow('reparación administrativa');
    expect(m.updateUserById).not.toHaveBeenCalled();
  });

  it('preserves the existing repair operation for an identity with linked providers', async () => {
    const existing = {
      id: 'existing-auth-id', email, user_metadata: {}, identities: [{ id: 'linked' }],
    };
    m.listUsers.mockResolvedValueOnce({ data: { users: [existing], nextPage: null }, error: null });
    m.updateUserById.mockResolvedValue({ data: { user: existing }, error: null });

    const repaired = await repairAuthUser(input);
    expect(repaired?.id).toBe(existing.id);
    expect(m.updateUserById).toHaveBeenCalledWith(existing.id, {
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: input.displayName },
    });
  });
});
