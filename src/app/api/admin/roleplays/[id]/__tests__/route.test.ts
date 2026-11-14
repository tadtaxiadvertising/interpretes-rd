// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

import { PATCH } from '../route';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';

const adminAuth = {
  user: { userId: 'a1', email: 'admin@x.com', role: 'admin', interpreterId: null, profileId: 'a1' },
  profile: { userId: 'a1', email: 'admin@x.com', role: 'admin', interpreterId: null, profileId: 'a1' },
};

function context(id = 'sess-1') {
  return { params: Promise.resolve({ id }) } as any;
}

function request() {
  return new Request('http://localhost/api/admin/roleplays/sess-1', { method: 'PATCH' }) as any;
}

describe('PATCH /api/admin/roleplays/[id] (cancel)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (validateAction as any).mockResolvedValue(adminAuth);
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ id: 'sess-1', status: 'INVITED' });
    (prisma.roleplaySession.updateMany as any).mockResolvedValue({ count: 1 });
  });

  it('rejects a non-admin without touching the session', async () => {
    (validateAction as any).mockResolvedValue({ error: 'Access denied', code: 'UNAUTHORIZED' });

    const res = await PATCH(request(), context());

    expect(res.status).toBe(403);
    expect(prisma.roleplaySession.findUnique).not.toHaveBeenCalled();
    expect(prisma.roleplaySession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an empty id', async () => {
    const res = await PATCH(request(), context('   '));

    expect(res.status).toBe(400);
    expect(prisma.roleplaySession.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown session', async () => {
    (prisma.roleplaySession.findUnique as any).mockResolvedValue(null);

    const res = await PATCH(request(), context());

    expect(res.status).toBe(404);
    expect(prisma.roleplaySession.updateMany).not.toHaveBeenCalled();
  });

  it('cancels a live session', async () => {
    const res = await PATCH(request(), context());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { sessionId: 'sess-1', status: 'CANCELLED' } });
    expect(prisma.roleplaySession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-1', status: 'INVITED' }, data: { status: 'CANCELLED' } })
    );
  });

  it('is idempotent for an already cancelled session', async () => {
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ id: 'sess-1', status: 'CANCELLED' });

    const res = await PATCH(request(), context());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('CANCELLED');
    expect(prisma.roleplaySession.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to cancel an expired session', async () => {
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ id: 'sess-1', status: 'EXPIRED' });

    const res = await PATCH(request(), context());

    expect(res.status).toBe(409);
    expect(prisma.roleplaySession.updateMany).not.toHaveBeenCalled();
  });

  it('returns conflict if the session changes before cancellation', async () => {
    (prisma.roleplaySession.updateMany as any).mockResolvedValue({ count: 0 });
    const res = await PATCH(request(), context());
    expect(res.status).toBe(409);
  });

  it('redacts provider connection details in a failed cancellation and its server logs', async () => {
    const secret = 'postgresql://private:password@internal.invalid/roleplays';
    (prisma.roleplaySession.updateMany as any).mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await PATCH(request(), context());
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.error).toBe('Failed to cancel roleplay');
      expect(JSON.stringify(body)).not.toContain('password');
      expect(JSON.stringify(log.mock.calls)).not.toContain('password');
      expect(JSON.stringify(log.mock.calls)).not.toContain('internal.invalid');
      expect(log).toHaveBeenCalledWith('Cancel Roleplay API Error:', 'Error');
    } finally {
      log.mockRestore();
    }
  });

  it('does not log a secret injected into an exception name', async () => {
    const injected = new Error('Database failure');
    injected.name = 'Bearer_PRIVATE_CANCEL_TOKEN';
    (prisma.roleplaySession.findUnique as any).mockRejectedValue(injected);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await PATCH(request(), context());
      expect(res.status).toBe(500);
      expect(JSON.stringify(log.mock.calls)).not.toContain('Bearer_PRIVATE_CANCEL_TOKEN');
      expect(log).toHaveBeenCalledWith('Cancel Roleplay API Error:', 'Error');
    } finally {
      log.mockRestore();
    }
  });
});
