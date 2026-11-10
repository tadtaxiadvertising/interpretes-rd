'use server';

import prisma from '@/lib/prisma';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { validateAction } from '@/lib/auth/actions';

const prismaClient = prisma;

const QAEvaluationSchema = z.object({
  interpreterId: z.coerce.number().int().positive(),
  productionLogId: z.preprocess(
    (value) => value === '' || value === null ? null : value,
    z.coerce.number().int().positive().nullable(),
  ),
  protocolScore: z.coerce.number().finite().min(0).max(100),
  interpretationScore: z.coerce.number().finite().min(0).max(100),
  languageScore: z.coerce.number().finite().min(0).max(100),
  serviceScore: z.coerce.number().finite().min(0).max(100),
  technicalScore: z.coerce.number().finite().min(0).max(100),
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
  try {
    const interpreter = await prismaClient.interpreter.findUnique({
      where: { id: data.interpreterId },
      select: { id: true },
    });
    if (!interpreter) {
      return { success: false, error: 'Intérprete no encontrado.', code: 'NOT_FOUND' };
    }

    if (data.productionLogId !== null) {
      const productionLog = await prismaClient.productionLog.findUnique({
        where: { id: data.productionLogId },
        select: { id: true, interpreterId: true },
      });
      if (!productionLog) {
        return { success: false, error: 'Registro de producción no encontrado.', code: 'NOT_FOUND' };
      }
      if (productionLog.interpreterId !== data.interpreterId) {
        return { success: false, error: 'El registro de producción no pertenece al intérprete seleccionado.', code: 'VALIDATION_ERROR' };
      }
    }

    const totalScore = data.criticalError
      ? 0
      : data.protocolScore * 0.20 +
        data.interpretationScore * 0.40 +
        data.languageScore * 0.20 +
        data.serviceScore * 0.10 +
        data.technicalScore * 0.10;

    const actionRequired = data.criticalError || totalScore < 70
      ? 'Advertencia / Coaching'
      : totalScore < 85 ? 'Feedback Requerido' : 'Ninguna';

    await prismaClient.qAScore.create({
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
        totalScore,
        criticalError: data.criticalError,
        comentarios: data.comments,
        accionRequerida: actionRequired,
      },
      select: { id: true },
    });

    revalidatePath('/qa');
    revalidatePath('/admin');
    return { success: true, message: `Evaluación guardada con éxito. (Score: ${totalScore.toFixed(2)}%)` };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'Este registro de producción ya tiene una evaluación QA.', code: 'CONFLICT' };
    }
    console.error('QA evaluation failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'No fue posible guardar la evaluación QA.', code: 'INTERNAL_ERROR' };
  }
}
