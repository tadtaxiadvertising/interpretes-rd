// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findMany: vi.fn(), findUnique: vi.fn() },
    roleplaySession: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  actorFromBearer: vi.fn(),
}));
vi.mock('@/lib/roleplay-studio/bounded-multipart', () => {
  class MultipartBodyTooLargeError extends Error {
    constructor() {
      super('MULTIPART_BODY_TOO_LARGE');
      this.name = 'MultipartBodyTooLargeError';
    }
  }
  return {
    MultipartBodyTooLargeError,
    readBoundedMultipartFormData: vi.fn(async () => {
      throw new MultipartBodyTooLargeError();
    }),
  };
});

import { POST } from '../route';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { readBoundedMultipartFormData } from '@/lib/roleplay-studio/bounded-multipart';

function request(): Request {
  const form = new FormData();
  form.append('participantType', 'all-active-interpreters');
  return new Request('http://localhost/api/admin/roleplays', {
    method: 'POST', body: form,
  });
}

describe('roleplay admin multipart cap is enforced before database or Storage writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue({
      user: { userId: 'test-admin', role: 'admin' },
    } as never);
  });

  it('maps streaming limit violations to private HTTP 413 and skips side effects', async () => {
    const result = await POST(request() as never);
    expect(result.status).toBe(413);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await result.json()).error).toContain('lote de audio');
    expect(readBoundedMultipartFormData).toHaveBeenCalledOnce();
    expect(prisma.interpreter.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before accepting any multipart bytes', async () => {
    vi.mocked(validateAction).mockResolvedValueOnce({
      error: 'Forbidden', code: 'UNAUTHORIZED',
    } as never);
    const result = await POST(request() as never);
    expect(result.status).toBe(403);
    expect(readBoundedMultipartFormData).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
