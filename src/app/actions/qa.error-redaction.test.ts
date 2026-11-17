import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validateAction: vi.fn(),
  interpreterFindUnique: vi.fn(),
  productionLogFindUnique: vi.fn(),
  qaCreate: vi.fn(),
  profileFindUnique: vi.fn(),
  createNotification: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validateAction }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: m.interpreterFindUnique },
    productionLog: { findUnique: m.productionLogFindUnique },
    qAScore: { create: m.qaCreate },
    userProfile: { findUnique: m.profileFindUnique },
  },
}));
vi.mock('@/app/actions/notifications', () => ({ createNotification: m.createNotification }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));

import { submitQAEvaluation as submitQaForm } from './qa.actions';
import { submitQAEvaluation as submitQaInput } from './qa';

const credentials = 'postgresql://admin:PRIVATE_PASSWORD@internal-db.invalid/qa';
const scores = {
  interpreterId: 7,
  productionLogId: 22,
  protocolScore: 90,
  interpretationScore: 90,
  languageScore: 90,
  serviceScore: 90,
  technicalScore: 90,
  criticalError: false,
};
const input = { ...scores, comments: 'Synthetic test only' };

function qaFormData() {
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) {
    form.set(key, String(value));
  }
  return form;
}

describe('QA Server Actions credential-safe error boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validateAction.mockResolvedValue({
      user: { userId: 'admin-1', role: 'admin', email: 'admin@example.test' },
    });
    m.interpreterFindUnique.mockResolvedValue({ id: 7, emailCorporativo: 'interpreter@example.test' });
    m.productionLogFindUnique.mockResolvedValue({ id: 22, interpreterId: 7 });
    m.profileFindUnique.mockResolvedValue({ id: 'profile-1' });
    m.qaCreate.mockResolvedValue({ id: 'qa-1' });
    m.createNotification.mockResolvedValue(undefined);
  });

  it('does not access Prisma for an unauthorized form action', async () => {
    m.validateAction.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const result = await submitQaForm(undefined, qaFormData());
    expect(result).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.interpreterFindUnique).not.toHaveBeenCalled();
    expect(m.qaCreate).not.toHaveBeenCalled();
  });

  it('redacts a database exception from form QA submission logs and response', async () => {
    m.qaCreate.mockRejectedValueOnce(new Error(credentials));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaForm(undefined, qaFormData());
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(log).toHaveBeenCalledWith('QA evaluation failed:', 'Error');
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
      expect(m.revalidatePath).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('redacts a database exception from object QA submission logs and response', async () => {
    m.qaCreate.mockRejectedValueOnce(new Error(credentials));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaInput(input);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(log).toHaveBeenCalledWith('QA Submission Error:', 'Error');
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
    } finally { log.mockRestore(); }
  });

  it('keeps an already-saved QA evaluation successful when notification delivery fails privately', async () => {
    m.createNotification.mockRejectedValueOnce(new Error(credentials));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaInput(input);
      expect(result).toMatchObject({ success: true });
      expect(m.qaCreate).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('Notification failed but QA saved:', 'Error');
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
      expect(m.revalidatePath).toHaveBeenCalledWith('/qa');
    } finally { log.mockRestore(); }
  });

  it('rejects an unauthorized object QA action before reading production records', async () => {
    m.validateAction.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const result = await submitQaInput(input);
    expect(result).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.productionLogFindUnique).not.toHaveBeenCalled();
    expect(m.qaCreate).not.toHaveBeenCalled();
  });
});
