import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const { validateAction, findFirst, updateMany } = vi.hoisted(() => ({
  validateAction: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction }));
vi.mock('@/lib/prisma', () => ({
  default: { legalAgreementVersion: { findFirst, updateMany } },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { publishLegalAgreementDraft } from '../legal-agreements';

const body = 'Contenido contractual de prueba suficientemente extenso para validar la publicación del acuerdo legal.';
const version = '2026.11.02';
const title = 'Contrato de servicios';
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const reviewDigest = () => digest(JSON.stringify([version, title, body]));

function makeDraft() {
  return {
    id: 'draft-1',
    version,
    title,
    content: body,
    contentHash: digest(body),
    legalReviewedAt: new Date('2026-11-02T10:00:00.000Z'),
    legalReviewedBy: 'admin-1',
    legalReviewHash: reviewDigest(),
  };
}

describe('publishLegalAgreementDraft — single administrator workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAction.mockResolvedValue({
      user: { userId: 'admin-1', email: 'admin@example.com', role: 'admin' },
      profile: { userId: 'admin-1', email: 'admin@example.com', role: 'admin' },
    });
    findFirst.mockResolvedValue(makeDraft());
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('allows the same authenticated admin who reviewed the draft to publish it', async () => {
    const result = await publishLegalAgreementDraft('draft-1');

    expect(result).toEqual({ success: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'draft-1', legalReviewedBy: 'admin-1' }),
      data: expect.objectContaining({ status: 'PUBLISHED', publishedBy: 'admin@example.com' }),
    }));
  });

  it('blocks publication if the content changed after legal review', async () => {
    findFirst.mockResolvedValueOnce({ ...makeDraft(), content: 'Contenido alterado después de la revisión.' });

    const result = await publishLegalAgreementDraft('draft-1');

    expect(result).toMatchObject({ success: false, code: 'LEGAL_REVIEW_REQUIRED' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('still requires a recorded legal review', async () => {
    findFirst.mockResolvedValueOnce({ ...makeDraft(), legalReviewedAt: null, legalReviewedBy: null, legalReviewHash: null });

    const result = await publishLegalAgreementDraft('draft-1');

    expect(result).toMatchObject({ success: false, code: 'LEGAL_REVIEW_REQUIRED' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('continues to enforce administrator authorization', async () => {
    validateAction.mockResolvedValueOnce({ error: 'Access denied', code: 'UNAUTHORIZED' });

    const result = await publishLegalAgreementDraft('draft-1');

    expect(result).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
