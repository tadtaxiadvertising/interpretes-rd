// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: vi.fn() },
    roleplayLibraryArchive: { upsert: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { POST, DELETE } from '../route';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getRoleplaySnapshotHash } from '@/lib/roleplay-library';

const scenarios = [{
  order: 0,
  title: 'Patient intake',
  baseAudioUrl: 'https://example.supabase.co/storage/v1/object/public/roleplay-audio/base/a/0.mp3',
  durationLimitSec: 240,
  scriptPrompt: 'Interpretar',
  expectedKeys: ['Terminología clínica'],
}];
const fingerprint = getRoleplaySnapshotHash(scenarios);

const auth = {
  user: { userId: 'admin-1', email: 'admin@example.com', role: 'admin' },
  profile: { userId: 'admin-1', email: 'admin@example.com', role: 'admin' },
};

const context = (id = fingerprint) => ({ params: Promise.resolve({ fingerprint: id }) }) as any;

function archiveRequest(sourceSessionId = 'session-source-1') {
  return new Request(`http://localhost/api/admin/roleplays/library/${fingerprint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceSessionId }),
  }) as any;
}
function restoreRequest() {
  return new Request(`http://localhost/api/admin/roleplays/library/${fingerprint}`, {
    method: 'DELETE',
  }) as any;
}

describe('admin roleplay library visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (validateAction as any).mockResolvedValue(auth);
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ status: 'INVITED', scenarios });
    (prisma.roleplayLibraryArchive.upsert as any).mockResolvedValue({ fingerprint, archivedAt: new Date() });
    (prisma.roleplayLibraryArchive.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      roleplayLibraryArchive: {
        upsert: prisma.roleplayLibraryArchive.upsert,
        updateMany: prisma.roleplayLibraryArchive.updateMany,
      },
    }));
  });

  it('requires admin privileges to archive', async () => {
    (validateAction as any).mockResolvedValue({ error: 'Access denied', code: 'UNAUTHORIZED' });
    const response = await POST(archiveRequest(), context());
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(prisma.roleplayLibraryArchive.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['interpreter', { userId: 'interpreter-2', role: 'interpreter' }],
    ['different admin', { userId: 'admin-other', role: 'admin' }],
    ['invalid token', null],
  ])('does not archive a library snapshot with mismatched Bearer: %s', async (_label, actor) => {
    (actorFromBearer as any).mockResolvedValue(actor);
    const req = archiveRequest();
    req.headers.set('Authorization', 'Bearer explicit-user-token');
    const res = await POST(req, context());
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.roleplaySession.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not restore an archived snapshot with another user Bearer', async () => {
    (actorFromBearer as any).mockResolvedValue({ userId: 'other-admin', role: 'admin' });
    const req = restoreRequest();
    req.headers.set('Authorization', 'Bearer other-admin-token');
    const res = await DELETE(req, context());
    expect(res.status).toBe(403);
    expect(prisma.roleplayLibraryArchive.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows a verified same-admin Bearer for archive and restore', async () => {
    (actorFromBearer as any).mockResolvedValue({ userId: 'admin-1', role: 'admin' });
    const post = archiveRequest();
    post.headers.set('Authorization', 'Bearer same-admin-token');
    expect((await POST(post, context())).status).toBe(200);
    const del = restoreRequest();
    del.headers.set('Authorization', 'Bearer same-admin-token');
    expect((await DELETE(del, context())).status).toBe(200);
    expect(prisma.roleplayLibraryArchive.upsert).toHaveBeenCalledOnce();
    expect(prisma.roleplayLibraryArchive.updateMany).toHaveBeenCalledOnce();
  });

  it('rejects an invalid fingerprint', async () => {
    const response = await POST(archiveRequest(), context('bad'));
    expect(response.status).toBe(400);
  });

  it('cannot withdraw another source using a forged fingerprint', async () => {
    const response = await POST(archiveRequest(), context('a'.repeat(64)));
    expect(response.status).toBe(409);
    expect(prisma.roleplayLibraryArchive.upsert).not.toHaveBeenCalled();
  });

  it('refuses draft sources', async () => {
    (prisma.roleplaySession.findUnique as any).mockResolvedValue({ status: 'DRAFT', scenarios });
    const response = await POST(archiveRequest(), context());
    expect(response.status).toBe(409);
  });

  it('archives catalog visibility without deleting source sessions or storage', async () => {
    const response = await POST(archiveRequest(), context());
    expect(response.status).toBe(200);
    expect((await response.json()).archived).toBe(true);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(prisma.roleplayLibraryArchive.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { fingerprint },
      create: expect.objectContaining({ fingerprint }),
      update: expect.objectContaining({ archivedAt: expect.any(Date), archivedBy: 'admin-1' }),
    }));
    expect(prisma.roleplaySession.findUnique).toHaveBeenCalledOnce();
  });

  it('restores withdrawn catalog entries with admin access', async () => {
    const response = await DELETE(restoreRequest(), context());
    expect(response.status).toBe(200);
    expect(prisma.roleplayLibraryArchive.updateMany).toHaveBeenCalledWith({
      where: { fingerprint, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
  });

  it('requires admin privileges to restore', async () => {
    (validateAction as any).mockResolvedValue({ error: 'Access denied', code: 'UNAUTHORIZED' });
    const response = await DELETE(restoreRequest(), context());
    expect(response.status).toBe(403);
    expect(prisma.roleplayLibraryArchive.updateMany).not.toHaveBeenCalled();
  });

  it('never logs provider exception names or database secrets during archive', async () => {
    const error = new Error('postgresql://PRIVATE_PASSWORD@internal.invalid');
    error.name = 'Bearer PRIVATE_AUTH_TOKEN';
    (prisma.roleplayLibraryArchive.upsert as any).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(archiveRequest(), context());
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_PASSWORD');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_|postgresql:/);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(log).toHaveBeenCalledWith('[ADMIN ROLEPLAY LIBRARY] Failed to archive snapshot', 'Error');
    } finally {
      log.mockRestore();
    }
  });

  it('does not leak a provider error when restoring archived catalog visibility', async () => {
    const error = new Error('PRIVATE_RESTORE_TOKEN');
    error.name = 'PRIVATE_ERROR_NAME';
    (prisma.roleplayLibraryArchive.updateMany as any).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await DELETE(restoreRequest(), context());
      expect(response.status).toBe(500);
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      log.mockRestore();
    }
  });
});
