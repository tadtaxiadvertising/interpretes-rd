'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { calculateCanonicalQaTotal } from '@/lib/qa-canonical-score';
import { revalidatePath } from 'next/cache';
import { createNotification } from './notifications';
import { z } from 'zod';

// QA dimensions use canonical percentages, stored as NUMERIC(5,2).
// A third decimal would otherwise be rounded by PostgreSQL after scoring.
const percentage = z.number().finite().min(0).max(100).refine(
  value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
  { message: 'QA percentages support at most two decimal places' },
);

const QAEvaluationSchema = z.object({
  productionLogId: z.number().int().positive(),
  interpreterId: z.number().int().positive(),
  protocolScore: percentage,
  interpretationScore: percentage,
  languageScore: percentage,
  serviceScore: percentage,
  technicalScore: percentage,
  criticalError: z.boolean(),
  comments: z.string().trim().max(2_000).optional(),
});

export type QAScoreInput = z.infer<typeof QAEvaluationSchema>;

class QaObjectPreconditionError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'VALIDATION_ERROR',
    readonly clientMessage: string,
  ) {
    super('QA production log precondition failed');
  }
}

function storedTotalMatches(stored: unknown, expected: number): boolean {
  if (stored === null || stored === undefined) return false;
  const actual = Number(stored);
  return Number.isFinite(actual) &&
    Math.round(actual * 100) === Math.round(expected * 100);
}

export async function submitQAEvaluation(rawInput: QAScoreInput) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsed = QAEvaluationSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parsed.data;

  const expectedTotal = calculateCanonicalQaTotal(input, input.criticalError);
  const actionRequired = input.criticalError || expectedTotal < 70
    ? 'Advertencia / Coaching'
    : expectedTotal < 85 ? 'Feedback Requerido' : 'Ninguna';

  let data: { id: number; totalScore: number };
  try {
    data = await prisma.$transaction(async tx => {
      // Keep ownership validation and insertion in the same transaction.
      const productionLog = await tx.productionLog.findUnique({
        where: { id: input.productionLogId },
        select: { id: true, interpreterId: true },
      });
      if (!productionLog) {
        throw new QaObjectPreconditionError('NOT_FOUND', 'Production log not found');
      }
      if (productionLog.interpreterId !== input.interpreterId) {
        throw new QaObjectPreconditionError(
          'VALIDATION_ERROR', 'Production log does not belong to the selected interpreter',
        );
      }

      const created = await tx.qAScore.create({
        data: {
          productionLogId: input.productionLogId,
          interpreterId: input.interpreterId,
          auditDate: new Date(),
          auditor: auth.user.email || 'System',
          protocolScore: input.protocolScore,
          interpretationScore: input.interpretationScore,
          languageScore: input.languageScore,
          serviceScore: input.serviceScore,
          technicalScore: input.technicalScore,
          totalScore: expectedTotal,
          criticalError: input.criticalError,
          comentarios: input.comments,
          accionRequerida: actionRequired,
        },
        select: { id: true },
      });

      // AFTER INSERT triggers can update total_score after INSERT RETURNING.
      // Re-read before commit, and roll back if the stored value disagrees.
      const persisted = await tx.qAScore.findUnique({
        where: { id: created.id },
        select: { totalScore: true },
      });
      if (!storedTotalMatches(persisted?.totalScore, expectedTotal)) {
        throw new Error('QA stored total mismatch');
      }
      return { id: created.id, totalScore: Number(persisted!.totalScore) };
    });
  } catch (error: unknown) {
    if (error instanceof QaObjectPreconditionError) {
      return { success: false, error: error.clientMessage, code: error.code };
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'This production log already has a QA evaluation', code: 'CONFLICT' };
    }
    console.error('QA Submission Error:', safeServerErrorCategory(error));
    return { success: false, error: 'Unable to save QA evaluation', code: 'INTERNAL_ERROR' };
  }

  // Sending notifications and refreshing caches happen AFTER COMMIT.
  // Their failures must never report a committed evaluation as unsaved.
  try {
    const interpreter = await prisma.interpreter.findUnique({
      where: { id: input.interpreterId },
      select: { emailCorporativo: true },
    });
    if (interpreter?.emailCorporativo) {
      const profile = await prisma.userProfile.findUnique({
        where: { email: interpreter.emailCorporativo },
        select: { id: true },
      });
      if (profile) {
        const confirmedScore = data.totalScore;
        await createNotification({
          userId: profile.id,
          title: 'Evaluación QA Lista',
          message: `Tu puntaje de sesión: ${confirmedScore.toFixed(1)}%. Acción: ${actionRequired}`,
          type: confirmedScore >= 85 ? 'success' : confirmedScore >= 70 ? 'info' : 'warning',
          link: '/dashboard/earnings',
        });
      }
    }
  } catch (notifyError: unknown) {
    console.error('Notification failed but QA saved:', safeServerErrorCategory(notifyError));
  }

  try {
    revalidatePath('/qa');
    revalidatePath('/dashboard');
  } catch (cacheError: unknown) {
    console.warn('QA saved but cache refresh failed:', safeServerErrorCategory(cacheError));
  }
  return { success: true, data: { id: data.id } };
}
