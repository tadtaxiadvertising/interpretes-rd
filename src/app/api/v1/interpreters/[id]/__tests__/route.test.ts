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
  updateUserById: vi.fn(),
  adminAuth: vi.fn(),
  revalidate: vi.fn(),
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
  revalidateInterpreterProfileRecords: m.revalidate,
}));
vi.mock('@/lib/interpreters/delete-interpreter', () => ({
  deleteInterpreterDatabaseRecords: m.deleteRecords,
  InterpreterNotFoundError: class InterpreterNotFoundError extends Error {},
  InterpreterHasHistoricalRecordsError: class InterpreterHasHistoricalRecordsError extends Error {},
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { get auth() { return m.adminAuth(); } },
  ADMIN_UNAVAILABLE_MESSAGE: 'Admin unavailable',
  isAdminUnavailableError: () => false,
}));

import { PATCH, DELETE } from '../route';

const params = { params: Promise.resolve({ id: '12' }) };
const emptyPatchRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const patchRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Updated Interpreter' }),
});
const deleteRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', { method: 'DELETE' });
const statusOnlyRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'Inactivo' }),
});
const emailOnlyRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ emailCorporativo: 'new@example.test' }),
});

const passwordRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'fictional-password-only' }),
});
const combinedPasswordRequest = () => new NextRequest('http://localhost/api/v1/interpreters/12', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'fictional-password-only', name: 'Updated Interpreter' }),
});

describe('interpreter detail admin API privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.guard.mockResolvedValue(null);
    m.adminAuth.mockReturnValue({ admin: { deleteUser: m.deleteUser, updateUserById: m.updateUserById } });
    m.updateUserById.mockResolvedValue({ error: null });
    m.deleteUser.mockResolvedValue({ error: null });
    m.update.mockResolvedValue({ id: 12, name: 'Updated Interpreter', emailCorporativo: null });
    m.updateMany.mockResolvedValue({ count: 1 });
    m.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({
      interpreter: { update: m.update },
      userProfile: { updateMany: m.updateMany },
    }));
    m.deleteRecords.mockResolvedValue({ authUserId: null });
  });

  it('denies PATCH before accessing interpreter data and avoids caching the response', async () => {
    m.guard.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await PATCH(patchRequest(), params);
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(m.update).not.toHaveBeenCalled();
  });

  it('rejects an empty PATCH before accessing Auth or PostgreSQL', async () => {
    const res = await PATCH(emptyPatchRequest(), params);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(await res.json()).toEqual({
      success: false,
      error: 'At least one field must be provided.',
    });
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.updateUserById).not.toHaveBeenCalled();
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
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { interpreterId: 12 },
      data: { displayName: 'Updated Interpreter' },
    });
  });

  it('uses the transaction client for interpreter and profile updates', async () => {
    const txUpdate = vi.fn().mockResolvedValue({
      id: 12, name: 'Transactional Name', emailCorporativo: 'staff@example.test',
    });
    const txProfile = vi.fn().mockResolvedValue({ count: 1 });
    m.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb({
      interpreter: { update: txUpdate },
      userProfile: { updateMany: txProfile },
    }));
    const res = await PATCH(patchRequest(), params);
    expect(res.status).toBe(200);
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 12 }, data: { name: 'Updated Interpreter' },
    });
    expect(txProfile).toHaveBeenCalledWith({
      where: { interpreterId: 12 },
      data: { displayName: 'Transactional Name' },
    });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('does not touch UserProfile when only the interpreter status changes', async () => {
    m.update.mockResolvedValueOnce({ id: 12, name: 'Existing Name', emailCorporativo: 'staff@example.test', status: 'Inactivo' });
    const res = await PATCH(statusOnlyRequest(), params);
    expect(res.status).toBe(200);
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { status: 'Inactivo' },
    });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing profile email during a name-only edit', async () => {
    m.update.mockResolvedValueOnce({
      id: 12,
      name: 'Updated Interpreter',
      emailCorporativo: 'unverified-corporate@example.test',
    });
    const res = await PATCH(patchRequest(), params);
    expect(res.status).toBe(200);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { interpreterId: 12 },
      data: { displayName: 'Updated Interpreter' },
    });
  });

  it('synchronizes profile email when the corporate email is explicitly changed', async () => {
    m.update.mockResolvedValueOnce({ id: 12, name: 'Existing Name', emailCorporativo: 'new@example.test' });
    const res = await PATCH(emailOnlyRequest(), params);
    expect(res.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { emailCorporativo: 'new@example.test' },
    });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { interpreterId: 12 },
      data: { email: 'new@example.test' },
    });
  });

  it('does not attempt to null the required profile email when corporate email is cleared', async () => {
    const clearRequest = new NextRequest('http://localhost/api/v1/interpreters/12', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailCorporativo: null }),
    });
    m.update.mockResolvedValueOnce({ id: 12, name: 'Existing Name', emailCorporativo: null });
    const res = await PATCH(clearRequest, params);
    expect(res.status).toBe(200);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('does not report success when the profile update fails inside the transaction', async () => {
    const error = new Error('postgresql://private:SECRET_PROFILE@db.invalid');
    error.name = 'Bearer SECRET_PROFILE';
    m.updateMany.mockRejectedValueOnce(error);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await PATCH(patchRequest(), params);
      expect(res.status).toBe(500);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(m.transaction).toHaveBeenCalledOnce();
      expect(m.update).toHaveBeenCalledOnce();
      expect(m.updateMany).toHaveBeenCalledOnce();
      expect(JSON.stringify(await res.json())).not.toMatch(/SECRET_PROFILE|postgresql:/);
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/SECRET_PROFILE|postgresql:/);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a password change when the interpreter does not exist', async () => {
    m.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(passwordRequest(), params);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ success: false, error: 'Interpreter not found.' });
    expect(m.findUnique).toHaveBeenCalledOnce();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.adminAuth).not.toHaveBeenCalled();
  });

  it('refuses to claim password success if the interpreter has no linked Auth profile', async () => {
    m.findUnique.mockResolvedValueOnce({ id: 12, userProfile: null });
    const res = await PATCH(passwordRequest(), params);
    expect(res.status).toBe(409);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(await res.json()).toEqual({
      success: false,
      error: 'Cannot change password without a linked authentication account. Contact support.',
    });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.adminAuth).not.toHaveBeenCalled();
  });

  it('finishes a password-only change after Auth succeeds without any PostgreSQL writes', async () => {
    m.findUnique.mockResolvedValueOnce({
      id: 12,
      name: 'Original Interpreter',
      emailCorporativo: 'employee@example.test',
      userProfile: { id: 'auth-user-12', email: 'employee@example.test' },
    });
    // No transaction should execute for this operation; keeping the default
    // mock behavior avoids leaking a one-time rejection into the next test.
    const res = await PATCH(passwordRequest(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      success: true,
      data: { id: 12, name: 'Original Interpreter', emailCorporativo: 'employee@example.test' },
    });
    expect(m.updateUserById).toHaveBeenCalledOnce();
    expect(m.updateUserById).toHaveBeenCalledWith(
      'auth-user-12',
      { password: 'fictional-password-only', email_confirm: true }
    );
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('still uses a DB transaction when changing both password and interpreter fields', async () => {
    m.findUnique.mockResolvedValueOnce({ id: 12, userProfile: { id: 'auth-user-12' } });
    const res = await PATCH(combinedPasswordRequest(), params);
    expect(res.status).toBe(200);
    expect(m.updateUserById).toHaveBeenCalledOnce();
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { name: 'Updated Interpreter' },
    });
    expect(m.updateMany).toHaveBeenCalledOnce();
  });

  it('does not attempt database writes after a failed password-only Auth update', async () => {
    m.findUnique.mockResolvedValueOnce({ id: 12, userProfile: { id: 'auth-user-12' } });
    m.updateUserById.mockResolvedValueOnce({ error: new Error('synthetic Auth failure') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await PATCH(passwordRequest(), params);
      expect(res.status).toBe(500);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(JSON.stringify(await res.json())).not.toContain('synthetic Auth failure');
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
      expect(m.updateMany).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
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

  it('confirms linked Auth deletion before reporting a successful DELETE', async () => {
    m.deleteRecords.mockResolvedValueOnce({ authUserId: 'fictional-auth-id' });
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(m.deleteUser).toHaveBeenCalledWith('fictional-auth-id');
    expect(m.revalidate).toHaveBeenCalledWith(12);
    expect(m.transaction).toHaveBeenCalledOnce();
  });

  it('returns a private 409 if Auth rejects revocation after the local delete', async () => {
    m.deleteRecords.mockResolvedValueOnce({ authUserId: 'fictional-auth-id' });
    const err = new Error('postgresql://SECRET_TOKEN@auth.internal');
    err.name = 'SECRET_BEARER_TOKEN';
    m.deleteUser.mockResolvedValueOnce({ error: err });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await DELETE(deleteRequest(), params);
      expect(res.status).toBe(409);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toContain('Authorization');
      const body = await res.json();
      expect(body).toMatchObject({ success: false, code: 'AUTH_REVOCATION_UNCONFIRMED' });
      expect(body.error).toContain('Do not repeat deletion');
      expect(JSON.stringify([body, spy.mock.calls])).not.toMatch(/SECRET_|postgresql:|auth\.internal/);
      expect(m.transaction).toHaveBeenCalledOnce();
      expect(m.deleteUser).toHaveBeenCalledOnce();
      expect(m.revalidate).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('returns a private 409 if the Auth provider throws after PostgreSQL committed', async () => {
    m.deleteRecords.mockResolvedValueOnce({ authUserId: 'fictional-auth-id' });
    m.deleteUser.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAILS'));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await DELETE(deleteRequest(), params);
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body.code).toBe('AUTH_REVOCATION_UNCONFIRMED');
      expect(JSON.stringify([body, spy.mock.calls])).not.toContain('PRIVATE_PROVIDER_DETAILS');
      expect(m.transaction).toHaveBeenCalledOnce();
      expect(m.deleteUser).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves success if post-commit cache refresh fails after confirmed revocation', async () => {
    m.deleteRecords.mockResolvedValueOnce({ authUserId: 'fictional-auth-id' });
    m.revalidate.mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_ERROR'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await DELETE(deleteRequest(), params);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(m.deleteUser).toHaveBeenCalledOnce();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_CACHE_ERROR');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not claim Auth revocation for a missing local interpreter', async () => {
    const { InterpreterNotFoundError } = await import('@/lib/interpreters/delete-interpreter');
    m.transaction.mockRejectedValueOnce(new InterpreterNotFoundError());
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(409);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      success: false,
      code: 'INTERPRETER_NOT_FOUND_AUTH_UNVERIFIED',
      error: 'The local interpreter no longer exists. Auth revocation cannot be verified; request an administrator review instead of retrying.',
    });
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it('does not present a blind retry after partial Auth failure as successful', async () => {
    m.deleteRecords.mockResolvedValueOnce({ authUserId: 'fictional-auth-id' });
    m.deleteUser.mockResolvedValueOnce({ error: new Error('Synthetic provider outage') });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = await DELETE(deleteRequest(), params);
      expect(first.status).toBe(409);
      expect((await first.json()).code).toBe('AUTH_REVOCATION_UNCONFIRMED');

      const { InterpreterNotFoundError } = await import('@/lib/interpreters/delete-interpreter');
      m.transaction.mockRejectedValueOnce(new InterpreterNotFoundError());
      const retry = await DELETE(deleteRequest(), params);
      expect(retry.status).toBe(409);
      expect((await retry.json()).code).toBe('INTERPRETER_NOT_FOUND_AUTH_UNVERIFIED');
      expect(m.deleteUser).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });

  it('rejects deletion with historical references before deleting Auth', async () => {
    const { InterpreterHasHistoricalRecordsError } = await import('@/lib/interpreters/delete-interpreter');
    m.transaction.mockRejectedValueOnce(new InterpreterHasHistoricalRecordsError());
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(409);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(await res.json()).toEqual({
      success: false,
      error: 'Cannot delete an interpreter with historical records. Deactivate the account instead.',
    });
    expect(m.deleteUser).not.toHaveBeenCalled();
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
