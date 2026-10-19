// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: vi.fn(), update: vi.fn() },
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
    (prisma.roleplaySession.update as any).mockResolvedValue({ id: 'sess-1', status: 'CANCELLED' });
  });

  it('rejects a non-admin without touching the session', async () => {
    (validateAction as any).mockResolvedValue({ error: 'Access denied', code: 'UNAUTHORIZED' });

    const res = await PATCH(request(), context());

    expect(res.status).toBe(403);
    expect(prisma.roleplaySession.findUnique).not.toHaveBeenCalled();
    expect(prisma.roleplaySession.update).not.toHaveBeenCalled();
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
    expect(prisma.roleplaySession.update).not.toHaveBeenCalled();
  });

  it('cancels a live session', async () => {
    const res = await PATCH(request(), context());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { sessionId: 'sess-1', status: 'CANCELLED' } });
    expect(prisma.roleplaySession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-1' }, data: { status: 'CANCELLED' } })
    );
  });

  it('is idempotent for an already cancelled session', async () => {
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ id: 'sess-1', status: 'CANCELLED' });

    const res = await PATCH(request(), context());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('CANCELLED');
    expect(prisma.roleplaySession.update).not.toHaveBeenCalled();
  });

  it('refuses to cancel an expired session', async () => {
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ id: 'sess-1', status: 'EXPIRED' });

    const res = await PATCH(request(), context());

    expect(res.status).toBe(409);
    expect(prisma.roleplaySession.update).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking internals when the update fails', async () => {
    (prisma.roleplaySession.update as any).mockRejectedValue(new Error('db down'));

    const res = await PATCH(request(), context());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to cancel roleplay');
  });
});
