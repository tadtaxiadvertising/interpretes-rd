import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateAction: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validateAction }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: mocks.transaction } }));
vi.mock('@/lib/identity/resolve-user', () => ({ resolveCurrentIdentity: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/roleplay', () => ({
  createSignedUploadUrl: vi.fn(),
  getBaseAudioPath: vi.fn(),
  getResponseAudioPath: vi.fn(),
  confirmUpload: vi.fn(),
  validateAudioFile: vi.fn(),
}));
vi.mock('./notifications', () => ({ createNotification: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/services/recruitment/transitions', () => ({ advanceApplication: vi.fn() }));
vi.mock('@/lib/roleplay-audio-conversion', () => ({ queueMp3Conversion: vi.fn() }));

import { evaluateRoleplay } from '@/app/actions/roleplay';

function makeFormData(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values: Record<string, string> = {
    sessionId: 'session-1',
    protocolScore: '8',
    interpretationScore: '8',
    languageScore: '8',
    serviceScore: '8',
    technicalScore: '8',
    criticalError: 'off',
    comments: '',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe('evaluateRoleplay score input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateAction.mockResolvedValue({
      user: { userId: 'admin-1', email: 'admin@example.com', role: 'admin' },
    });
  });

  it.each([
    ['blank', ''],
    ['malformed numeric text', '7points'],
    ['missing value', null],
  ])('rejects %s scores instead of treating them as zero', async (_label, value) => {
    const form = makeFormData();
    if (value === null) form.delete('languageScore');
    else form.set('languageScore', value);

    const result = await evaluateRoleplay(null, form);

    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('accepts an explicit zero as a valid dimension value at the validation boundary', async () => {
    const form = makeFormData({ languageScore: '0' });
    mocks.transaction.mockRejectedValue(new Error('stop after validation'));

    const result = await evaluateRoleplay(null, form);

    expect(result).not.toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
