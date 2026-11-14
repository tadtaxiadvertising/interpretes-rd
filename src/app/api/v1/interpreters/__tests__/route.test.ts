// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  profileUpsert: vi.fn(),
  guard: vi.fn(),
  provision: vi.fn(),
  adminAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { create: m.create, findMany: m.findMany },
    userProfile: { upsert: m.profileUpsert },
  },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: m.guard }));
vi.mock('@/lib/api-security', () => ({ withSecurity: (handler: unknown) => handler }));
vi.mock('@/lib/supabase/auth-users', () => ({ upsertConfirmedAuthUser: m.provision }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { get auth() { return m.adminAuth(); } },
}));

import { GET, POST } from '../route';

const input = {
  externalId: 'INT-TEST-01',
  name: 'Test Interpreter',
  tariffPerMinute: 0.12,
  emailCorporativo: 'private.employee@example.test',
  password: 'fictional-password-value',
};
const getRequest = () => new NextRequest('http://localhost/api/v1/interpreters');
const postRequest = () => new NextRequest('http://localhost/api/v1/interpreters', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});

describe('interpreter admin API privacy and Auth provisioning failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.guard.mockResolvedValue(null);
    m.adminAuth.mockReturnValue({ admin: {} });
    m.create.mockResolvedValue({ id: 77, name: 'Test Interpreter' });
    m.findMany.mockResolvedValue([{ id: 77, name: 'Private Employee', emailCorporativo: input.emailCorporativo }]);
    m.profileUpsert.mockResolvedValue({ id: 'auth-id-1' });
    m.provision.mockResolvedValue({ id: 'auth-id-1' });
  });

  it('guards the interpreter list before reading employee data', async () => {
    m.guard.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await GET(getRequest(), undefined);
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('never creates an interpreter when Supabase Admin configuration is missing', async () => {
    const error = new Error('postgresql://SECRET_AUTH@db.invalid');
    error.name = 'Bearer SECRET_AUTH';
    m.adminAuth.mockImplementationOnce(() => { throw error; });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await POST(postRequest(), undefined);
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Vary')).toContain('Authorization');
      expect(await response.json()).toEqual({
        success: false,
        error: 'Authentication administration is unavailable. No interpreter was created.',
      });
      expect(m.create).not.toHaveBeenCalled();
      expect(m.provision).not.toHaveBeenCalled();
      expect(m.profileUpsert).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/SECRET_AUTH|postgresql:/);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps admin interpreter listing and creation private', async () => {
    const list = await GET(getRequest(), undefined);
    expect(list.status).toBe(200);
    expect(list.headers.get('Cache-Control')).toBe('private, no-store');
    expect(list.headers.get('Vary')).toContain('Cookie');

    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const notice = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const create = await POST(postRequest(), undefined);
      expect(create.status).toBe(201);
      expect(create.headers.get('Cache-Control')).toBe('private, no-store');
      expect(create.headers.get('Vary')).toContain('Authorization');
      expect(m.provision).toHaveBeenCalledWith(expect.objectContaining({
        email: input.emailCorporativo, password: input.password,
      }));
      expect(m.profileUpsert).toHaveBeenCalledOnce();
      expect(JSON.stringify([...log.mock.calls, ...notice.mock.calls]))
        .not.toContain(input.emailCorporativo);
    } finally {
      log.mockRestore();
      notice.mockRestore();
    }
  });

  it('does not send or log a provider connection string on partial Auth creation failure', async () => {
    const error = new Error('postgresql://private:PRIVATE_PASSWORD@db.invalid');
    error.name = 'Bearer PRIVATE_AUTH_TOKEN';
    m.provision.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const res = await POST(postRequest(), undefined);
      const body = await res.json();
      expect(res.status).toBe(400); // Existing provisioning contract retained
      expect(body).toEqual({
        success: false,
        error: 'Interpreter record created, but account provisioning failed. Contact support.',
        interpreterId: 77,
      });
      expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|postgresql:/);
      expect(JSON.stringify([...log.mock.calls, ...info.mock.calls]))
        .not.toMatch(/PRIVATE_|postgresql:|private\.employee/);
      expect(log).toHaveBeenCalledWith('[API_INTERPRETERS_POST] Auth creation failed:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(m.profileUpsert).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      info.mockRestore();
    }
  });

  it('reports a partial profile-link failure without exposing the provider error or creating another Auth user', async () => {
    const error = new Error('postgresql://secret:PRIVATE_PROFILE_PASSWORD@db.invalid');
    error.name = 'Bearer PRIVATE_PROFILE_TOKEN';
    m.profileUpsert.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(postRequest(), undefined);
      expect(res.status).toBe(500);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toContain('Cookie');
      const body = await res.json();
      expect(body).toEqual({
        success: false,
        error: 'Interpreter and Auth records created, but profile linking failed. Contact support before retrying.',
        interpreterId: 77,
      });
      expect(JSON.stringify(body)).not.toMatch(/PRIVATE_PROFILE_|postgresql:/);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_PROFILE_|postgresql:/);
      expect(m.create).toHaveBeenCalledOnce();
      expect(m.provision).toHaveBeenCalledOnce();
      expect(m.profileUpsert).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });

  it('returns the same static provisioning failure if Auth returns no user', async () => {
    m.provision.mockResolvedValueOnce(null);
    const res = await POST(postRequest(), undefined);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Interpreter record created, but account provisioning failed. Contact support.',
      interpreterId: 77,
    });
    expect(m.profileUpsert).not.toHaveBeenCalled();
  });
});
