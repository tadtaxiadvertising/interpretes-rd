import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { recordCurrentLegalAcceptance } from './legal-agreements';

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
