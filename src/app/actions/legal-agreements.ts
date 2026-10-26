'use server';

import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const AGREEMENT_KEY = 'freelance-services';

const DraftSchema = z.object({
  id: z.string().optional(),
  version: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'La versión solo puede contener letras, números, punto, guion y guion bajo'),
  title: z.string().trim().min(3).max(180),
  content: z.string().trim().min(100).max(100000),
});

export type PublishedAgreement = {
  id: string;
  version: string;
  title: string;
  content: string;
  contentHash: string;
  publishedAt: Date | null;
};

function hashContent(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function getPublishedLegalAgreement(): Promise<
  { success: true; data: PublishedAgreement } | { success: false; error: string; code: string }
> {
  const auth = await validateAction();
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const agreement = await prisma.legalAgreementVersion.findFirst({
      where: { agreementKey: AGREEMENT_KEY, status: 'PUBLISHED', publishedAt: { not: null } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, version: true, title: true, content: true, contentHash: true, publishedAt: true },
    });
    if (!agreement) return { success: false, error: 'No hay un acuerdo publicado. Contacta al administrador.', code: 'NOT_FOUND' };
    if (hashContent(agreement.content) !== agreement.contentHash) {
      console.error('[LEGAL] Published agreement hash mismatch', agreement.id);
      return { success: false, error: 'No se pudo verificar la integridad del acuerdo publicado.', code: 'INTEGRITY_ERROR' };
    }
    return { success: true, data: agreement };
  } catch (error) {
    console.error('[LEGAL] getPublishedLegalAgreement failed', error);
    return { success: false, error: 'No se pudo cargar el acuerdo vigente.', code: 'INTERNAL_ERROR' };
  }
}

export async function getLegalAgreementAdminData() {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false as const, error: auth.error, code: auth.code };
  try {
    const [published, drafts, acceptances] = await Promise.all([
      prisma.legalAgreementVersion.findFirst({
        where: { agreementKey: AGREEMENT_KEY, status: 'PUBLISHED', publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, version: true, title: true, content: true, contentHash: true, publishedAt: true },
      }),
      prisma.legalAgreementVersion.findMany({
        where: { agreementKey: AGREEMENT_KEY, status: 'DRAFT' },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, version: true, title: true, content: true, updatedAt: true },
      }),
      prisma.legalAgreementAcceptance.count({ where: { agreementVersion: { agreementKey: AGREEMENT_KEY } } }),
    ]);
    return { success: true as const, data: { published, drafts, acceptances } };
  } catch (error) {
    console.error('[LEGAL] admin data failed', error);
    return { success: false as const, error: 'No se pudieron cargar los acuerdos.', code: 'INTERNAL_ERROR' };
  }
}

export async function saveLegalAgreementDraft(raw: unknown) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false as const, error: auth.error, code: auth.code };
  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) return { success: false as const, error: 'Revisa la versión, el título y el contenido (mínimo 100 caracteres).', code: 'VALIDATION_ERROR' };
  const input = parsed.data;
  try {
    if (input.id) {
      const updated = await prisma.legalAgreementVersion.updateMany({
        where: { id: input.id, agreementKey: AGREEMENT_KEY, status: 'DRAFT' },
        data: { version: input.version, title: input.title, content: input.content, contentHash: hashContent(input.content), updatedAt: new Date() },
      });
      if (updated.count !== 1) return { success: false as const, error: 'Solo se pueden editar borradores. Los acuerdos publicados son inmutables.', code: 'CONFLICT' };
    } else {
      await prisma.legalAgreementVersion.create({
        data: {
          agreementKey: AGREEMENT_KEY,
          version: input.version,
          title: input.title,
          content: input.content,
          contentHash: hashContent(input.content),
          status: 'DRAFT',
          createdBy: auth.user.email || auth.user.userId,
        },
      });
    }
    revalidatePath('/admin/legal-agreements');
    return { success: true as const };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { success: false as const, error: 'Ya existe un acuerdo con esa versión.', code: 'CONFLICT' };
    }
    console.error('[LEGAL] save draft failed', error);
    return { success: false as const, error: 'No se pudo guardar el borrador.', code: 'INTERNAL_ERROR' };
  }
}

export async function publishLegalAgreementDraft(id: string) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false as const, error: auth.error, code: auth.code };
  if (!id || id.length > 100) return { success: false as const, error: 'Borrador inválido.', code: 'VALIDATION_ERROR' };
  try {
    const draft = await prisma.legalAgreementVersion.findFirst({
      where: { id, agreementKey: AGREEMENT_KEY, status: 'DRAFT' },
      select: { id: true, content: true, contentHash: true },
    });
    if (!draft) return { success: false as const, error: 'El borrador no existe o ya fue publicado.', code: 'CONFLICT' };
    const digest = hashContent(draft.content);
    if (digest !== draft.contentHash) return { success: false as const, error: 'El contenido del borrador no pasó la verificación de integridad.', code: 'INTEGRITY_ERROR' };
    const result = await prisma.legalAgreementVersion.updateMany({
      where: { id, agreementKey: AGREEMENT_KEY, status: 'DRAFT', contentHash: digest },
      data: { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: auth.user.email || auth.user.userId },
    });
    if (result.count !== 1) return { success: false as const, error: 'Otro proceso publicó o modificó este borrador. Recarga e inténtalo de nuevo.', code: 'CONFLICT' };
    revalidatePath('/admin/legal-agreements');
    revalidatePath('/dashboard');
    return { success: true as const };
  } catch (error) {
    console.error('[LEGAL] publish draft failed', error);
    return { success: false as const, error: 'No se pudo publicar el acuerdo.', code: 'INTERNAL_ERROR' };
  }
}

export async function hasCurrentLegalAcceptance(identity: { userId?: string | null; interpreterId?: number | null }) {
  const current = await prisma.legalAgreementVersion.findFirst({
    where: { agreementKey: AGREEMENT_KEY, status: 'PUBLISHED', publishedAt: { not: null } },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, contentHash: true },
  });
  if (!current) return false;
  const where = identity.userId
    ? { agreementVersionId: current.id, userId: identity.userId }
    : identity.interpreterId
      ? { agreementVersionId: current.id, interpreterId: identity.interpreterId }
      : null;
  if (!where) return false;
  const acceptance = await prisma.legalAgreementAcceptance.findFirst({
    where,
    select: { id: true, contentHash: true },
  });
  return !!acceptance && acceptance.contentHash === current.contentHash;
}

export async function recordCurrentLegalAcceptance(tx: any, identity: {
  userId?: string | null;
  interpreterId?: number | null;
  email: string;
}) {
  const current = await tx.legalAgreementVersion.findFirst({
    where: { agreementKey: AGREEMENT_KEY, status: 'PUBLISHED', publishedAt: { not: null } },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, content: true, contentHash: true },
  });
  if (!current) throw new Error('No published legal agreement');
  if (hashContent(current.content) !== current.contentHash) throw new Error('Published legal agreement integrity check failed');
  const identityWhere = identity.userId
    ? { agreementVersionId: current.id, userId: identity.userId }
    : identity.interpreterId
      ? { agreementVersionId: current.id, interpreterId: identity.interpreterId }
      : null;
  if (!identityWhere) throw new Error('No stable signer identity');
  const existing = await tx.legalAgreementAcceptance.findFirst({ where: identityWhere, select: { id: true } });
  if (!existing) {
    await tx.legalAgreementAcceptance.create({
      data: {
        agreementVersionId: current.id,
        userId: identity.userId ?? null,
        interpreterId: identity.interpreterId ?? null,
        signerEmail: identity.email,
        contentHash: current.contentHash,
        source: 'onboarding',
      },
    });
  }
  return current;
}
