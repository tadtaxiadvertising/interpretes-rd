'use server';

import prisma from '@/lib/prisma';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { validateAction } from '@/lib/auth/actions';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { qaV1StoredTotalMatches } from '@/lib/qa-v1-score-contract';

const prismaClient = prisma;

// Stored QA percentages have NUMERIC(5,2) precision. Reject extra places
// before Prisma can silently round a dimension after the score was computed.
const QAPercentage = z.coerce.number().finite().min(0).max(100).refine(
  value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
  { message: 'QA percentages support at most two decimal places' },
);

class QaPreconditionError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'VALIDATION_ERROR',
    readonly clientMessage: string,
  ) {
    super('QA submission precondition failed');
  }
}

const QAEvaluationSchema = z.object({
  interpreterId: z.coerce.number().int().positive(),
  productionLogId: z.preprocess(
    (value) => value === '' || value === null ? null : value,
    z.coerce.number().int().positive().nullable(),
  ),
  protocolScore: QAPercentage,
  interpretationScore: QAPercentage,
  languageScore: QAPercentage,
  serviceScore: QAPercentage,
  technicalScore: QAPercentage,
  criticalError: z.boolean(),
  comments: z.string().trim().max(2_000),
});

export async function submitQAEvaluation(_prevState: unknown, formData: FormData) {
  const auth = await validateAction('admin');
  if ('error' in auth) {
    return { success: false, error: 'Unauthorized access. Permisos de Administrador requeridos.', code: auth.code };
  }

  const parsed = QAEvaluationSchema.safeParse({
    interpreterId: formData.get('interpreterId'),
    productionLogId: formData.get('productionLogId'),
    protocolScore: formData.get('protocolScore'),
    interpretationScore: formData.get('interpretationScore'),
    languageScore: formData.get('languageScore'),
    serviceScore: formData.get('serviceScore'),
    technicalScore: formData.get('technicalScore'),
    criticalError: formData.get('criticalError') === 'on' || formData.get('criticalError') === 'true',
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) {
    return { success: false, error: 'Validación fallida: revisa el intérprete, el log y los scores.', code: 'VALIDATION_ERROR' };
  }

  const data = parsed.data;
  const weightedTotal = data.protocolScore * 0.20 +
    data.interpretationScore * 0.40 +
    data.languageScore * 0.20 +
    data.serviceScore * 0.10 +
    data.technicalScore * 0.10;
  const expectedTotal = data.criticalError ? 0 : Math.round(weightedTotal * 100) / 100;

  const actionRequired = data.criticalError || expectedTotal < 70
    ? 'Advertencia / Coaching'
    : expectedTotal < 85 ? 'Feedback Requerido' : 'Ninguna';

  try {
    // All preconditions, INSERT and stored-total verification share one DB
    // transaction. An incompatible trigger must not commit a misleading score.
    const saved = await prismaClient.$transaction(async tx => {
      const interpreter = await tx.interpreter.findUnique({
        where: { id: data.interpreterId },
        select: { id: true },
      });
      if (!interpreter) {
        throw new QaPreconditionError('NOT_FOUND', 'Intérprete no encontrado.');
      }

      if (data.productionLogId !== null) {
        const productionLog = await tx.productionLog.findUnique({
          where: { id: data.productionLogId },
          select: { id: true, interpreterId: true },
        });
        if (!productionLog) {
          throw new QaPreconditionError('NOT_FOUND', 'Registro de producción no encontrado.');
        }
        if (productionLog.interpreterId !== data.interpreterId) {
          throw new QaPreconditionError(
            'VALIDATION_ERROR',
            'El registro de producción no pertenece al intérprete seleccionado.',
          );
        }
      }

      const created = await tx.qAScore.create({
        data: {
          interpreterId: data.interpreterId,
          productionLogId: data.productionLogId,
          auditDate: new Date(),
          auditor: auth.user.email || 'System Admin',
          protocolScore: data.protocolScore,
          interpretationScore: data.interpretationScore,
          languageScore: data.languageScore,
          serviceScore: data.serviceScore,
          technicalScore: data.technicalScore,
          totalScore: expectedTotal,
          criticalError: data.criticalError,
          comentarios: data.comments,
          accionRequerida: actionRequired,
        },
        select: { id: true, totalScore: true },
      });

      if (!qaV1StoredTotalMatches(created.totalScore, expectedTotal)) {
        throw new Error('QA stored score contract mismatch');
      }
      return created;
    });

    // A post-commit cache failure must not claim the QA insert failed and
    // prompt an operator to retry a transaction that already committed.
    try {
      revalidatePath('/qa');
      revalidatePath('/admin');
    } catch (cacheError) {
      console.warn('QA saved but cache refresh failed:', safeServerErrorCategory(cacheError));
    }

    return {
      success: true,
      message: `Evaluación guardada con éxito. (Score: ${Number(saved.totalScore).toFixed(2)}%)`,
    };
  } catch (error) {
    if (error instanceof QaPreconditionError) {
      return { success: false, error: error.clientMessage, code: error.code };
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'Este registro de producción ya tiene una evaluación QA.', code: 'CONFLICT' };
    }
    console.error('QA evaluation failed:', safeServerErrorCategory(error));
    return { success: false, error: 'No fue posible guardar la evaluación QA.', code: 'INTERNAL_ERROR' };
  }
}
