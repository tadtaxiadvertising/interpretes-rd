import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  confirmUpload: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: async () => ({ user: { role: 'admin', userId: 'admin-1' } }),
}));
vi.mock('@/lib/prisma', () => ({
  default: { roleplaySession: { findUnique: m.findUnique, updateMany: m.updateMany } },
}));
vi.mock('@/lib/roleplay', () => ({
  createSignedUploadUrl: vi.fn(),
  getBaseAudioPath: vi.fn(),
  getResponseAudioPath: vi.fn(),
  confirmUpload: m.confirmUpload,
  validateAudioFile: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/roleplay-audio-conversion', () => ({ queueMp3Conversion: vi.fn() }));
vi.mock('@/services/recruitment/transitions', () => ({ advanceApplication: vi.fn() }));
vi.mock('@/app/actions/notifications', () => ({ createNotification: vi.fn() }));

import { confirmBaseAudioUpload } from '@/app/actions/roleplay';

describe('confirmBaseAudioUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findUnique.mockResolvedValue({ id: 'session-123', baseAudioUrl: 'base/session-123.webm' });
    m.updateMany.mockResolvedValue({ count: 1 });
    m.confirmUpload.mockResolvedValue('signed-url');
  });

  it('rejects a path from a different session', async () => {
    const result = await confirmBaseAudioUpload('session-123', 'base/session-999.webm');
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.confirmUpload).not.toHaveBeenCalled();
  });

  it('rejects a response-audio path', async () => {
    const result = await confirmBaseAudioUpload('session-123', 'responses/session-123/audio.webm');
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.confirmUpload).not.toHaveBeenCalled();
  });

  it('confirms the canonical path with a compare-and-set update', async () => {
    const result = await confirmBaseAudioUpload('session-123', 'base/session-123.webm');
    expect(result).toMatchObject({ success: true, data: { baseAudioUrl: 'signed-url' } });
    expect(m.confirmUpload).toHaveBeenCalledWith('base/session-123.webm');
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-123', baseAudioUrl: 'base/session-123.webm' },
      data: { baseAudioUrl: 'signed-url' },
    });
  });

  it('rejects if the path changed during confirmation', async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    const result = await confirmBaseAudioUpload('session-123', 'base/session-123.webm');
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
  });
});
