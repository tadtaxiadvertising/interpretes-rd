import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  actor: { userId: 'admin-1', email: 'admin@example.com', role: 'admin' } as any,
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  confirmUpload: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () => m.actor ? { user: m.actor } : { error: 'Not authorized', code: 'UNAUTHORIZED' },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: {
      findUnique: m.sessionFindUnique,
      update: m.sessionUpdate,
    },
  },
}));
vi.mock('@/lib/roleplay', () => ({
  createSignedUploadUrl: vi.fn(),
  getBaseAudioPath: (sessionId: string, extension: string) => `base/${sessionId}.${extension}`,
  getResponseAudioPath: vi.fn(),
  confirmUpload: m.confirmUpload,
  validateAudioFile: vi.fn(),
}));
vi.mock('@/lib/identity/resolve-user', () => ({ resolveCurrentIdentity: vi.fn() }));
vi.mock('@/app/actions/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/roleplay/scoring', () => ({ calculateRoleplayScore: vi.fn() }));
vi.mock('@/services/recruitment/transitions', () => ({ advanceApplication: vi.fn() }));

import { confirmBaseAudioUpload } from '../roleplay';

describe('confirmBaseAudioUpload session ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor = { userId: 'admin-1', email: 'admin@example.com', role: 'admin' };
    m.sessionFindUnique.mockResolvedValue({ id: 'session-1' });
    m.confirmUpload.mockResolvedValue('https://signed.example/base-audio');
    m.sessionUpdate.mockResolvedValue({ id: 'session-1' });
  });

  it('rejects an audio path belonging to another session before signing or updating', async () => {
    const result = await confirmBaseAudioUpload('session-1', 'base/session-2.webm');

    expect(result.success).toBe(false);
    expect(result.code).toBe('FORBIDDEN');
    expect(m.confirmUpload).not.toHaveBeenCalled();
    expect(m.sessionUpdate).not.toHaveBeenCalled();
  });

  it('rejects an unknown session before signing', async () => {
    m.sessionFindUnique.mockResolvedValue(null);

    const result = await confirmBaseAudioUpload('missing-session', 'base/missing-session.webm');

    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
    expect(m.confirmUpload).not.toHaveBeenCalled();
  });

  it('confirms the canonical base-audio path for the target session', async () => {
    const result = await confirmBaseAudioUpload('session-1', 'base/session-1.webm');

    expect(result.success).toBe(true);
    expect(m.confirmUpload).toHaveBeenCalledWith('base/session-1.webm');
    expect(m.sessionUpdate).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { baseAudioUrl: 'https://signed.example/base-audio' },
    });
  });
});
