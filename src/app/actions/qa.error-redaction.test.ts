import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validateAction: vi.fn(),
  interpreterFindUnique: vi.fn(),
  productionLogFindUnique: vi.fn(),
  qaCreate: vi.fn(),
  qaFindUnique: vi.fn(),
  transaction: vi.fn(),
  profileFindUnique: vi.fn(),
  createNotification: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validateAction }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: m.interpreterFindUnique },
    productionLog: { findUnique: m.productionLogFindUnique },
    qAScore: { create: m.qaCreate, findUnique: m.qaFindUnique },
    $transaction: m.transaction,
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
    m.qaFindUnique.mockResolvedValue({ totalScore: 90 });
    m.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        interpreter: { findUnique: m.interpreterFindUnique },
        productionLog: { findUnique: m.productionLogFindUnique },
        qAScore: { create: m.qaCreate, findUnique: m.qaFindUnique },
      }));
    m.createNotification.mockResolvedValue(undefined);
  });

  it('does not access Prisma for an unauthorized form action', async () => {
    m.validateAction.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const result = await submitQaForm(undefined, qaFormData());
    expect(result).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.interpreterFindUnique).not.toHaveBeenCalled();
    expect(m.qaCreate).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('saves a verified form score atomically, after checking interpreter and production ownership', async () => {
    const result = await submitQaForm(undefined, qaFormData());
    expect(result).toMatchObject({ success: true, message: expect.stringContaining('90.00%') });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.interpreterFindUnique).toHaveBeenCalledWith({
      where: { id: 7 }, select: { id: true },
    });
    expect(m.productionLogFindUnique).toHaveBeenCalledWith({
      where: { id: 22 }, select: { id: true, interpreterId: true },
    });
    expect(m.qaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        totalScore: 90, interpreterId: 7, productionLogId: 22,
        accionRequerida: 'Ninguna',
      }),
      select: { id: true },
    });
    expect(m.qaFindUnique).toHaveBeenCalledWith({
      where: { id: 'qa-1' }, select: { totalScore: true },
    });
    expect(m.revalidatePath).toHaveBeenCalledWith('/qa');
    expect(m.revalidatePath).toHaveBeenCalledWith('/admin');
  });

  it('rejects an interpreter that does not exist before creating the QA record', async () => {
    m.interpreterFindUnique.mockResolvedValueOnce(null);
    const result = await submitQaForm(undefined, qaFormData());
    expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(m.qaCreate).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects production logs owned by a different interpreter inside the transaction', async () => {
    m.productionLogFindUnique.mockResolvedValueOnce({ id: 22, interpreterId: 99 });
    const result = await submitQaForm(undefined, qaFormData());
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.qaCreate).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('trusts the post-trigger read rather than an outdated INSERT RETURNING total', async () => {
    m.qaCreate.mockResolvedValueOnce({ id: 'qa-1', totalScore: 26 });
    m.qaFindUnique.mockResolvedValueOnce({ totalScore: 90 });
    const result = await submitQaForm(undefined, qaFormData());
    expect(result).toMatchObject({ success: true, message: expect.stringContaining('90.00%') });
  });

  it('fails closed if a post-trigger read cannot find the inserted score', async () => {
    m.qaFindUnique.mockResolvedValueOnce(null);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaForm(undefined, qaFormData());
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.revalidatePath).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('rejects a trigger-overridden result rather than confirming a misleading score', async () => {
    m.qaFindUnique.mockResolvedValueOnce({ totalScore: 26 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaForm(undefined, qaFormData());
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.transaction).toHaveBeenCalledTimes(1);
      expect(m.revalidatePath).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('QA evaluation failed:', 'Error');
    } finally { log.mockRestore(); }
  });

  it('rejects even a one-cent persisted score drift', async () => {
    m.qaFindUnique.mockResolvedValueOnce({ totalScore: 90.01 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaForm(undefined, qaFormData());
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.revalidatePath).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('rejects a critical-error override when a database trigger ignores it', async () => {
    const data = qaFormData();
    data.set('criticalError', 'on');
    m.qaFindUnique.mockResolvedValueOnce({ totalScore: 90 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaForm(undefined, data);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.qaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ criticalError: true, totalScore: 0 }),
        select: { id: true },
      });
    } finally { log.mockRestore(); }
  });

  it.each(['', ' ', '\\t'])('rejects a blank QA dimension instead of coercing %j to zero', async (value) => {
    const data = qaFormData();
    data.set('protocolScore', value);
    const result = await submitQaForm(undefined, data);
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.qaCreate).not.toHaveBeenCalled();
  });

  it('rejects scores with more precision than PostgreSQL NUMERIC(5,2) stores', async () => {
    const data = qaFormData();
    data.set('interpretationScore', '90.005');
    const result = await submitQaForm(undefined, data);
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.qaCreate).not.toHaveBeenCalled();
  });

  it('accepts no optional production log without querying an unrelated call', async () => {
    const data = qaFormData();
    data.set('productionLogId', '');
    const result = await submitQaForm(undefined, data);
    expect(result).toMatchObject({ success: true });
    expect(m.productionLogFindUnique).not.toHaveBeenCalled();
    expect(m.qaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ productionLogId: null }),
      select: { id: true },
    });
  });

  it('reports success when post-commit cache refresh fails, preventing duplicate submissions', async () => {
    m.revalidatePath.mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_TOKEN'); });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await submitQaForm(undefined, qaFormData());
      expect(result).toMatchObject({ success: true });
      expect(m.qaCreate).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('QA saved but cache refresh failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally { log.mockRestore(); }
  });

  it('refreshes /admin even when /qa cache invalidation fails after form commit', async () => {
    m.revalidatePath.mockImplementationOnce(() => { throw new Error(credentials); });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await submitQaForm(undefined, qaFormData());
      expect(result).toMatchObject({ success: true });
      expect(m.revalidatePath).toHaveBeenNthCalledWith(1, '/qa');
      expect(m.revalidatePath).toHaveBeenNthCalledWith(2, '/admin');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { log.mockRestore(); }
  });

  it('refreshes /dashboard even when /qa cache invalidation fails after object commit', async () => {
    m.revalidatePath.mockImplementationOnce(() => { throw new Error(credentials); });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await submitQaInput(input);
      expect(result).toMatchObject({ success: true });
      expect(m.revalidatePath).toHaveBeenNthCalledWith(1, '/qa');
      expect(m.revalidatePath).toHaveBeenNthCalledWith(2, '/dashboard');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { log.mockRestore(); }
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

  it('does not silently ignore a notification action that returns a failed delivery result', async () => {
    m.createNotification.mockResolvedValueOnce({
      success: false, code: 'INTERNAL_ERROR', error: 'PRIVATE_PASSWORD',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await submitQaInput(input);
      expect(result).toMatchObject({ success: true });
      expect(m.qaCreate).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('QA saved but notification not delivered');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
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

  it('uses exact canonical weighted cents when submitting the administrator QA form', async () => {
    const data = qaFormData();
    for (const [key, value] of Object.entries({
      protocolScore: '6.49', interpretationScore: '31.72',
      languageScore: '90.83', serviceScore: '46.41', technicalScore: '34.62',
    })) data.set(key, value);
    m.qaFindUnique.mockResolvedValueOnce({ totalScore: 40.26 });
    const result = await submitQaForm(undefined, data);
    expect(result).toMatchObject({
      success: true, message: expect.stringContaining('40.26%'),
    });
    expect(m.qaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalScore: 40.26 }),
      select: { id: true },
    });
  });

  it('uses the exact stored cent total when submitting the secondary QA action', async () => {
    m.qaFindUnique.mockResolvedValueOnce({ totalScore: 58.69 });
    const result = await submitQaInput({
      ...input,
      protocolScore: 68.88, interpretationScore: 50.85,
      languageScore: 51.56, serviceScore: 99.91, technicalScore: 42.66,
    });
    expect(result).toMatchObject({ success: true });
    expect(m.qaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalScore: 58.69 }),
      select: { id: true },
    });
    expect(m.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('58.7%') }),
    );
  });

  it('validates object QA ownership and stored score inside one transaction', async () => {
    const result = await submitQaInput(input);
    expect(result).toMatchObject({ success: true, data: { id: 'qa-1' } });
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.productionLogFindUnique).toHaveBeenCalledWith({
      where: { id: 22 }, select: { id: true, interpreterId: true },
    });
    expect(m.qaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalScore: 90, productionLogId: 22 }),
      select: { id: true },
    });
    expect(m.qaFindUnique).toHaveBeenCalledWith({
      where: { id: 'qa-1' }, select: { totalScore: true },
    });
    expect(m.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('90.0%') }),
    );
  });

  it('does not create an object QA score for a log owned by a different interpreter', async () => {
    m.productionLogFindUnique.mockResolvedValueOnce({ id: 22, interpreterId: 99 });
    const result = await submitQaInput(input);
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.qaCreate).not.toHaveBeenCalled();
    expect(m.createNotification).not.toHaveBeenCalled();
  });

  it('returns a controlled object QA error when production lookup fails', async () => {
    m.productionLogFindUnique.mockRejectedValueOnce(new Error(credentials));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaInput(input);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.qaCreate).not.toHaveBeenCalled();
      expect(JSON.stringify([result, log.mock.calls])).not.toContain('PRIVATE_PASSWORD');
    } finally { log.mockRestore(); }
  });

  it('rejects an object QA score altered by an AFTER INSERT trigger by one cent', async () => {
    m.qaFindUnique.mockResolvedValueOnce({ totalScore: 90.01 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaInput(input);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.createNotification).not.toHaveBeenCalled();
      expect(m.revalidatePath).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('rejects a critical error if an incompatible trigger stores a nonzero total', async () => {
    m.qaFindUnique.mockResolvedValueOnce({ totalScore: 90 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitQaInput({ ...input, criticalError: true });
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.qaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ criticalError: true, totalScore: 0 }),
        select: { id: true },
      });
      expect(m.createNotification).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('rejects score dimensions whose precision exceeds two decimals', async () => {
    const result = await submitQaInput({ ...input, protocolScore: 80.005 });
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('does not falsely report unsaved QA when cache revalidation fails after commit', async () => {
    m.revalidatePath.mockImplementationOnce(() => { throw new Error(credentials); });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await submitQaInput(input);
      expect(result).toMatchObject({ success: true, data: { id: 'qa-1' } });
      expect(m.qaCreate).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('QA saved but cache refresh failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PASSWORD');
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
