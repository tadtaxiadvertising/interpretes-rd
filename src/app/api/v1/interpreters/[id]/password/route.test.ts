// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  guard: vi.fn(),
  findUnique: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ guardApiAuth: m.guard }));
vi.mock('@/lib/prisma', () => ({
  default: { interpreter: { findUnique: m.findUnique } },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { auth: { admin: { updateUserById: m.updateUserById } } },
  isAdminUnavailableError: (error: unknown) =>
    error instanceof Error && error.name === 'SupabaseAdminUnavailableError',
}));

import { POST } from './route';

const secret = 'postgresql://private:SUPER_SECRET@internal.test/credentials';
const params = (id = '12') => ({ params: Promise.resolve({ id }) });
const request = (password = 'SyntheticPassword123') => new Request(
  'https://interpretes.example/api/v1/interpreters/12/password',
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) },
);

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const part of ['Cookie', 'Authorization', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(part);
  }
}

describe('interpreter password reset admin privacy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.guard.mockResolvedValue(null);
    m.findUnique.mockResolvedValue({
      id: 12, userProfile: { id: 'verified-auth-uid' },
    });
    m.updateUserById.mockResolvedValue({ error: null });
  });

  it('rejects unauthorized callers before interpreting input or reading personnel records', async () => {
    m.guard.mockResolvedValueOnce(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 }),
    );
    const response = await POST(request(), params());
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.updateUserById).not.toHaveBeenCalled();
  });

  it('updates only the linked Auth user and returns a private success', async () => {
    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      success: true, message: 'Password updated successfully',
    });
    expect(m.updateUserById).toHaveBeenCalledWith('verified-auth-uid', {
      password: 'SyntheticPassword123', email_confirm: true,
    });
  });

  it('returns a private not-found result without contacting Auth', async () => {
    m.findUnique.mockResolvedValueOnce({ id: 12, userProfile: null });
    const response = await POST(request(), params());
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(m.updateUserById).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs or passwords without touching the database', async () => {
    const badId = await POST(request(), params('invalid-id'));
    expect(badId.status).toBe(400);
    expectPrivate(badId);
    const badPassword = await POST(request('abc'), params());
    expect(badPassword.status).toBe(400);
    expectPrivate(badPassword);
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.updateUserById).not.toHaveBeenCalled();
  });

  it('keeps configuration-unavailable errors static and private', async () => {
    const error = new Error('private admin secret: ' + secret);
    error.name = 'SupabaseAdminUnavailableError';
    m.updateUserById.mockRejectedValueOnce(error);
    const response = await POST(request(), params());
    expect(response.status).toBe(503);
    expectPrivate(response);
    const body = await response.json();
    expect(body).toEqual({
      success: false, error: 'Authentication administration is unavailable.',
    });
    expect(JSON.stringify(body)).not.toContain('SUPER_SECRET');
  });

  it('never logs or returns upstream Auth credentials or arbitrary provider errors', async () => {
    m.updateUserById.mockResolvedValueOnce({ error: new Error(secret) });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request(), params());
      expect(response.status).toBe(500);
      expectPrivate(response);
      expect(await response.json()).toEqual({ success: false, error: 'Error resetting password' });
      expect(log).toHaveBeenCalledWith('Error resetting interpreter password:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/SUPER_SECRET|internal\.test|postgresql:/);
    } finally { log.mockRestore(); }
  });

  it('redacts database errors as well as Supabase errors', async () => {
    m.findUnique.mockRejectedValueOnce(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request(), params());
      expect(response.status).toBe(500);
      expectPrivate(response);
      expect(JSON.stringify(await response.json())).not.toContain('SUPER_SECRET');
      expect(JSON.stringify(log.mock.calls)).not.toContain('SUPER_SECRET');
      expect(m.updateUserById).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
