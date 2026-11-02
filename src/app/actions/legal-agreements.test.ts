import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { approveLegalAgreementDraft, publishLegalAgreementDraft, recordCurrentLegalAcceptance } from './legal-agreements';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    legalAgreementVersion: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';

describe('legal agreement administration', () => {
  it('does not publish a draft without a recorded legal review', async () => {
    (validateAction as any).mockResolvedValue({ user: { email: 'publisher@example.com', userId: 'publisher-1' } });
    (prisma.legalAgreementVersion.findFirst as any).mockResolvedValue({
      id: 'draft-1',
      content: '# Acuerdo',
      contentHash: createHash('sha256').update('# Acuerdo', 'utf8').digest('hex'),
      legalReviewedAt: null,
      legalReviewedBy: null,
    });

    const result = await publishLegalAgreementDraft('draft-1');

    expect(result).toMatchObject({ success: false, code: 'LEGAL_REVIEW_REQUIRED' });
    expect(prisma.legalAgreementVersion.updateMany).not.toHaveBeenCalled();
  });

  it('requires a different administrator to publish than the legal reviewer', async () => {
    (validateAction as any).mockResolvedValue({ user: { email: 'reviewer@example.com', userId: 'reviewer-1' } });
    (prisma.legalAgreementVersion.findFirst as any).mockResolvedValue({
      id: 'draft-1',
      content: '# Acuerdo',
      contentHash: createHash('sha256').update('# Acuerdo', 'utf8').digest('hex'),
      legalReviewedAt: new Date(),
      legalReviewedBy: 'reviewer-1',
    });

    const result = await publishLegalAgreementDraft('draft-1');

    expect(result).toMatchObject({ success: false, code: 'SEPARATION_OF_DUTIES_REQUIRED' });
    expect(prisma.legalAgreementVersion.updateMany).not.toHaveBeenCalled();
  });

  it('records legal review only for a valid, unchanged draft', async () => {
    (validateAction as any).mockResolvedValue({ user: { email: 'reviewer@example.com', userId: 'reviewer-1' } });
    const content = '# Acuerdo';
    const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
    (prisma.legalAgreementVersion.findFirst as any).mockResolvedValue({ id: 'draft-1', version: 'v1', title: 'Contrato', content, contentHash });
    (prisma.legalAgreementVersion.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await approveLegalAgreementDraft('draft-1');

    expect(result).toMatchObject({ success: true });
    expect(prisma.legalAgreementVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'draft-1',
        agreementKey: 'freelance-services',
        status: 'DRAFT',
        version: 'v1',
        title: 'Contrato',
        contentHash,
      },
      data: {
        legalReviewedAt: expect.any(Date),
        legalReviewedBy: 'reviewer-1',
        legalReviewHash: expect.any(String),
      },
    });
  });
});

describe('recordCurrentLegalAcceptance', () => {
  it('stores both stable user and interpreter identities with signer evidence', async () => {
    const content = '# Acuerdo vigente';
    const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
    const create = vi.fn();
    const tx = {
      legalAgreementVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'agreement-v2',
          content,
          contentHash,
        }),
      },
      legalAgreementAcceptance: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    };

    const agreement = await recordCurrentLegalAcceptance(tx, {
      userId: 'auth-user-1',
      interpreterId: 42,
      email: 'interpreter@example.com',
      userAgent: 'Test Browser',
      source: 'onboarding',
    });

    expect(agreement.id).toBe('agreement-v2');
    expect(tx.legalAgreementAcceptance.findFirst).toHaveBeenCalledWith({
      where: {
        agreementVersionId: 'agreement-v2',
        OR: [{ userId: 'auth-user-1' }, { interpreterId: 42 }],
      },
      select: { id: true, contentHash: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        agreementVersionId: 'agreement-v2',
        userId: 'auth-user-1',
        interpreterId: 42,
        signerEmail: 'interpreter@example.com',
        contentHash,
        source: 'onboarding',
        userAgent: 'Test Browser',
      },
    });
  });

  it('rejects an existing acceptance whose hash does not match the published agreement', async () => {
    const content = '# Acuerdo vigente';
    const tx = {
      legalAgreementVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'agreement-v2',
          content,
          contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
        }),
      },
      legalAgreementAcceptance: {
        findFirst: vi.fn().mockResolvedValue({ id: 'acceptance-1', contentHash: 'tampered' }),
        create: vi.fn(),
      },
    };

    await expect(recordCurrentLegalAcceptance(tx, {
      userId: 'auth-user-1',
      interpreterId: 42,
      email: 'interpreter@example.com',
    })).rejects.toThrow('LEGAL_ACCEPTANCE_INTEGRITY_ERROR');
    expect(tx.legalAgreementAcceptance.create).not.toHaveBeenCalled();
  });
});
