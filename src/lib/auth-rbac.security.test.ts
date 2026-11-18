// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rbacFindUnique: vi.fn(),
  config: null as unknown,
}));
vi.mock('next-auth', () => ({
  default: (config: unknown) => {
    mocks.config = config;
    return {
      auth: mocks.auth,
      handlers: {},
      signIn: vi.fn(),
      signOut: vi.fn(),
    };
  },
}));
vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn(() => ({ id: 'credentials' })),
}));
vi.mock('@/lib/prisma', () => ({
  default: { rbacUser: { findUnique: mocks.rbacFindUnique } },
}));
import { requireRole } from './auth-rbac';

type TestSession = { user: { id?: string; email?: string; name?: string; role?: unknown } };
const expectedSelect = { id: true, email: true, name: true, role: true };

function asSession(user: TestSession['user']) {
  return { user };
}

describe('RBAC authorization never trusts a legacy email-only session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(asSession({
      id: 'immutable-rbac-id',
      email: 'holder@example.test',
      role: 'HOLDER',
    }));
    mocks.rbacFindUnique.mockResolvedValue({
      id: 'immutable-rbac-id',
      email: 'holder@example.test',
      name: 'Holder',
      role: 'HOLDER',
    });
  });

  it('permits a valid holder by immutable DB ID, with minimal profile projection', async () => {
    const user = await requireRole('HOLDER');
    expect(user.id).toBe('immutable-rbac-id');
    expect(mocks.rbacFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'immutable-rbac-id' },
      select: expectedSelect,
    });
  });

  it('does not require a legacy session email when a valid ID and current role exist', async () => {
    mocks.auth.mockResolvedValueOnce(asSession({
      id: 'immutable-rbac-id',
      role: 'HOLDER',
    }));
    expect((await requireRole('HOLDER')).id).toBe('immutable-rbac-id');
    expect(mocks.rbacFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'immutable-rbac-id' }, select: expectedSelect,
    });
  });

  it('does not authorize an email-only session even if it matches an administrator', async () => {
    mocks.auth.mockResolvedValueOnce(asSession({
      email: 'admin@example.test', role: 'ADMIN',
    }));
    await expect(requireRole('ADMIN')).rejects.toThrow('Unauthorized');
    expect(mocks.rbacFindUnique).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '    ', 123])(
    'denies invalid or missing session IDs: %s', async id => {
      mocks.auth.mockResolvedValueOnce(asSession({
        id: id as never, email: 'holder@example.test', role: 'HOLDER',
      }));
      await expect(requireRole('HOLDER')).rejects.toThrow('Unauthorized');
      expect(mocks.rbacFindUnique).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, '', 'ADMINISTRATOR', 'candidate', 42])(
    'denies stale or invalid role claims before database queries: %s', async role => {
      mocks.auth.mockResolvedValueOnce(asSession({
        id: 'immutable-rbac-id', email: 'holder@example.test', role,
      }));
      await expect(requireRole('HOLDER')).rejects.toThrow('Unauthorized');
      expect(mocks.rbacFindUnique).not.toHaveBeenCalled();
    },
  );

  it('blocks attempts to use a HOLDER session for an ADMIN-only action', async () => {
    await expect(requireRole('ADMIN')).rejects.toThrow('Unauthorized');
    expect(mocks.rbacFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a deleted database identity even if the session claims the correct role', async () => {
    mocks.rbacFindUnique.mockResolvedValueOnce(null);
    await expect(requireRole('HOLDER')).rejects.toThrow('Unauthorized');
  });

  it('uses the live database role rather than a stale session role', async () => {
    mocks.rbacFindUnique.mockResolvedValueOnce({
      id: 'immutable-rbac-id', email: 'holder@example.test', name: 'Holder', role: 'INTERPRETER',
    });
    await expect(requireRole('HOLDER')).rejects.toThrow('Unauthorized');
  });

  it('allows a matching authenticated administrator without relying on email', async () => {
    mocks.auth.mockResolvedValueOnce(asSession({ id: 'admin-rbac-id', role: 'ADMIN' }));
    mocks.rbacFindUnique.mockResolvedValueOnce({
      id: 'admin-rbac-id', email: 'operator@example.test', name: 'Operator', role: 'ADMIN',
    });
    expect((await requireRole('ADMIN')).id).toBe('admin-rbac-id');
  });

  it('does not authenticate an absent session', async () => {
    mocks.auth.mockResolvedValueOnce(null);
    await expect(requireRole('HOLDER')).rejects.toThrow('Unauthorized');
    expect(mocks.rbacFindUnique).not.toHaveBeenCalled();
  });

  it('session callback drops the RBAC role when the token has no immutable ID', async () => {
    const config = mocks.config as {
      callbacks: {
        session: (params: {
          session: TestSession;
          token: { sub?: string; email?: string };
        }) => Promise<TestSession>;
      };
    };
    const session = await config.callbacks.session({
      session: asSession({ email: 'holder@example.test', role: 'HOLDER' }),
      token: { email: 'holder@example.test' },
    });
    expect(session.user.role).toBeUndefined();
    expect(mocks.rbacFindUnique).not.toHaveBeenCalled();
  });

  it('session callback refreshes role from the immutable ID, not a stale email claim', async () => {
    const config = mocks.config as {
      callbacks: {
        session: (params: {
          session: TestSession;
          token: { sub?: string; email?: string };
        }) => Promise<TestSession>;
      };
    };
    const session = await config.callbacks.session({
      session: asSession({ id: 'legacy-id', email: 'other@example.test', role: 'ADMIN' }),
      token: { sub: 'immutable-rbac-id', email: 'other@example.test' },
    });
    expect(session.user.id).toBe('immutable-rbac-id');
    expect(session.user.role).toBe('HOLDER');
    expect(session.user.email).toBe('holder@example.test');
    expect(mocks.rbacFindUnique).toHaveBeenCalledWith({
      where: { id: 'immutable-rbac-id' },
      select: expectedSelect,
    });
  });
});
