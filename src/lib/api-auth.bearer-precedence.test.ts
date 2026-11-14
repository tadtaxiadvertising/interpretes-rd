// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  getCurrentActor: vi.fn(),
  profile: vi.fn(),
  candidate: vi.fn(),
  interpreter: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => m.createClient(...args),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: { findUnique: m.profile },
    recruitmentCandidate: { findUnique: m.candidate },
    interpreter: { findFirst: m.interpreter },
  },
}));
vi.mock('@/lib/admin-identity', () => ({
  resolveUserRoleByEmail: () => 'interpreter',
}));
vi.mock('@/lib/auth/current-actor', () => ({
  getCurrentActor: m.getCurrentActor,
}));

import { guardApiAuth, resolveApiActor } from './api-auth';

const request = (authorization?: string) => new Request('http://localhost/api/v1/interpreters', {
  headers: {
    cookie: 'session=valid-cookie',
    ...(authorization !== undefined ? { authorization } : {}),
  },
});

describe('API Authorization credential precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-key');
    m.createClient.mockReturnValue({ auth: { getUser: m.getUser } });
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid token' } });
    m.getCurrentActor.mockResolvedValue({
      userId: 'cookie-admin', email: 'admin@example.test', role: 'admin',
      interpreterId: null, candidateId: null, profileId: 'cookie-admin',
    });
    m.profile.mockResolvedValue({
      id: 'auth-interpreter', role: 'interpreter',
      interpreterId: 33, email: 'interpreter@example.test',
    });
    m.candidate.mockResolvedValue(null);
    m.interpreter.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('still authenticates a cookie when there is no Authorization header', async () => {
    const actor = await resolveApiActor(request());
    expect(actor?.userId).toBe('cookie-admin');
    expect(actor?.role).toBe('admin');
    expect(m.getCurrentActor).toHaveBeenCalledOnce();
    expect(m.getUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid Bearer token rather than falling back to an admin cookie', async () => {
    expect(await resolveApiActor(request('Bearer invalid-token'))).toBeNull();
    expect(m.getUser).toHaveBeenCalledWith('invalid-token');
    expect(m.getCurrentActor).not.toHaveBeenCalled();
  });

  it('rejects a malformed explicit Authorization header without cookie fallback', async () => {
    expect(await resolveApiActor(request('Basic not-a-bearer-token'))).toBeNull();
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.getCurrentActor).not.toHaveBeenCalled();
  });

  it('preserves the identity from a valid verified Bearer token', async () => {
    m.getUser.mockResolvedValueOnce({
      data: { user: { id: 'auth-interpreter', email: 'interpreter@example.test' } },
      error: null,
    });
    const actor = await resolveApiActor(request('Bearer valid-token'));
    expect(actor).toMatchObject({
      userId: 'auth-interpreter',
      role: 'interpreter',
      interpreterId: 33,
      profileId: 'auth-interpreter',
    });
    expect(m.getCurrentActor).not.toHaveBeenCalled();
  });

  it('returns 401, not an admin authorization, for invalid Bearer with a valid admin cookie', async () => {
    const result = await guardApiAuth(request('Bearer invalid-token'), 'admin');
    expect(result?.status).toBe(401);
    expect(await result?.json()).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.getCurrentActor).not.toHaveBeenCalled();
  });
});
