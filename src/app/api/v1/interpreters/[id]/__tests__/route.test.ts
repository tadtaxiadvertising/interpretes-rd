// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  guard: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  deleteRecords: vi.fn(),
  deleteUser: vi.fn(),
  adminAuth: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ guardApiAuth: m.guard }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { update: m.update, findUnique: m.findUnique },
    userProfile: { updateMany: m.updateMany },
    $transaction: m.transaction,
  },
}));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));
vi.mock('@/lib/interpreters/delete-interpreter', () => ({
  deleteInterpreterDatabaseRecords: m.deleteRecords,
  InterpreterNotFoundError: class InterpreterNotFoundError extends Error {},
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { get auth() { return m.adminAuth(); } },
  ADMIN_UNAVAILABLE_MESSAGE: 'Admin unavailable',
  isAdminUnavailableError: () => false,
}));

import { PATCH, DELETE } from '../route';

const params = { params: Promise.resolve({ id: '12' }) };
const patchRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Updated Interpreter' }),
});
const deleteRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', { method: 'DELETE' });

describe('interpreter detail admin API privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.guard.mockResolvedValue(null);
    m.adminAuth.mockReturnValue({ admin: { deleteUser: m.deleteUser } });
    m.update.mockResolvedValue({ id: 12, name: 'Updated Interpreter', emailCorporativo: null });
    m.updateMany.mockResolvedValue({ count: 1 });
    m.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({}));
    m.deleteRecords.mockResolvedValue({ authUserId: null });
  });

  it('denies PATCH before accessing interpreter data and avoids caching the response', async () => {
    m.guard.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await PATCH(patchRequest(), params);
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(m.update).not.toHaveBeenCalled();
  });

  it('returns private successful PATCH without changing the update contract', async () => {
    const res = await PATCH(patchRequest(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect((await res.json()).success).toBe(true);
    expect(m.update).toHaveBeenCalledOnce();
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { name: 'Updated Interpreter' },
    });
  });

  it('redacts provider errors from PATCH response and logs', async () => {
    const err = new Error('postgresql://hidden:SECRET_VALUE@database.invalid');
    err.name = 'Bearer SECRET_VALUE';
    m.update.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await PATCH(patchRequest(), params);
      expect(res.status).toBe(500);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(JSON.stringify(await res.json())).not.toMatch(/SECRET_VALUE|postgresql:/);
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/SECRET_VALUE|postgresql:/);
    } finally {
      spy.mockRestore();
    }
  });


  it('does not run the destructive database transaction when Auth admin cannot initialize', async () => {
    const error = new Error('postgresql://hidden:SECRET_VALUE@invalid');
    error.name = 'Bearer SECRET_VALUE';
    m.adminAuth.mockImplementationOnce(() => { throw error; });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await DELETE(deleteRequest(), params);
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toContain('Cookie');
      expect(await res.json()).toEqual({
        success: false,
        error: 'Authentication administration is unavailable. No interpreter records were deleted.',
      });
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m.deleteRecords).not.toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/SECRET_VALUE|postgresql:/);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a typed missing interpreter as an idempotent success', async () => {
    const { InterpreterNotFoundError } = await import('@/lib/interpreters/delete-interpreter');
    m.transaction.mockRejectedValueOnce(new InterpreterNotFoundError());
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ success: true });
  });

  it('does not report success for a provider error with the former not-found text', async () => {
    m.transaction.mockRejectedValueOnce(new Error('Intérprete no encontrado'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await DELETE(deleteRequest(), params);
      expect(res.status).toBe(500);
      expect((await res.json()).success).toBe(false);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      spy.mockRestore();
    }
  });

  it('redacts database errors from DELETE and preserves private response headers', async () => {
    const err = new Error('Bearer SECRET_VALUE');
    err.name = 'postgresql://hidden:SECRET_VALUE@database.invalid';
    m.transaction.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await DELETE(deleteRequest(), params);
      expect(res.status).toBe(500);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(JSON.stringify(await res.json())).not.toMatch(/SECRET_VALUE|postgresql:/);
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/SECRET_VALUE|postgresql:/);
    } finally {
      spy.mockRestore();
    }
  });
});
