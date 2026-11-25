// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.createClient }));

import { GET } from './route';

const origin = 'https://interpretes.example.test';
const session = { access_token: 'test-only' };
function request(query: string) {
  return new Request('https://untrusted.example/auth/callback?' + query);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', origin);
  m.createClient.mockResolvedValue({ auth: {
    verifyOtp: m.verifyOtp,
    exchangeCodeForSession: m.exchangeCodeForSession,
  } });
});
afterEach(() => vi.unstubAllEnvs());

describe('verified email callback', () => {
  it.each(['invite', 'recovery'])('verifies %s token and opens password setup', async (type) => {
    m.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    const res = await GET(request('token_hash=test-token&type=' + type + '&next=https://evil.example'));
    expect(m.verifyOtp).toHaveBeenCalledWith({ token_hash: 'test-token', type });
    expect(m.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(origin + '/reset-password');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it.each([
    'token_hash=&type=invite',
    'token_hash=test-token&type=email_change',
    'token_hash=test-token&type=invite&code=other',
    'token_hash=test-token',
    '',
  ])('rejects malformed or unsupported credentials: %s', async (query) => {
    const res = await GET(request(query));
    expect(m.createClient).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(origin + '/login?error=auth_link_invalid');
  });

  it('rejects expired tokens without exposing provider details', async () => {
    m.verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'private test token' } });
    const res = await GET(request('token_hash=test-token&type=recovery'));
    expect(res.headers.get('location')).toBe(origin + '/login?error=auth_link_invalid');
  });

  it('requires a session even if verification returns no error', async () => {
    m.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    const res = await GET(request('token_hash=test-token&type=invite'));
    expect(res.headers.get('location')).toBe(origin + '/login?error=auth_link_invalid');
  });

  it('preserves PKCE exchange with a safe internal destination', async () => {
    m.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
    const res = await GET(request('code=test-code&next=%2Fcandidate'));
    expect(m.exchangeCodeForSession).toHaveBeenCalledWith('test-code');
    expect(res.headers.get('location')).toBe(origin + '/candidate');
  });

  it.each(['%2F%2Fevil.example', '%2F.%2F%2Fevil.example', 'https%3A%2F%2Fevil.example'])(
    'rejects unsafe PKCE destinations: %s', async (next) => {
      m.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
      const res = await GET(request('code=test-code&next=' + next));
      expect(res.headers.get('location')).toBe(origin + '/dashboard');
    },
  );

  it('handles provider exceptions without returning sensitive error text', async () => {
    m.createClient.mockRejectedValue(new Error('private credential'));
    const res = await GET(request('code=test-code'));
    expect(res.headers.get('location')).toBe(origin + '/login?error=auth_link_invalid');
  });
});
