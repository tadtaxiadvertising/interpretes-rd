'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { revalidatePath } from 'next/cache';
import { createNotification } from './notifications';
import { z } from 'zod';

const db = prisma;

// Zod schema for QA evaluation input validation
const QAEvaluationSchema = z.object({
  productionLogId: z.number().int().positive(),
  interpreterId: z.number().int().positive(),
  protocolScore: z.number().min(0).max(100),
  interpretationScore: z.number().min(0).max(100),
  languageScore: z.number().min(0).max(100),
  serviceScore: z.number().min(0).max(100),
  technicalScore: z.number().min(0).max(100),
  criticalError: z.boolean(),
  comments: z.string().trim().max(2_000).optional(),
});

export type QAScoreInput = z.infer<typeof QAEvaluationSchema>;

export async function submitQAEvaluation(rawInput: QAScoreInput) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  // Validate input with Zod
  const parseResult = QAEvaluationSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  const productionLog = await db.productionLog.findUnique({
    where: { id: input.productionLogId },
    select: { id: true, interpreterId: true },
  });
  if (!productionLog) {
    return { success: false, error: 'Production log not found', code: 'NOT_FOUND' };
  }
  if (productionLog.interpreterId !== input.interpreterId) {
    return { success: false, error: 'Production log does not belong to the selected interpreter', code: 'VALIDATION_ERROR' };
  }

  // Note: Total score calculation is handled by database trigger trg_calculate_qa_total
  // We still calculate it here for the notification, but the DB is the source of truth.
  let totalScore = 0;
  if (input.criticalError) {
    totalScore = 0;
  } else {
    totalScore = 
      (input.protocolScore * 0.20) +
      (input.interpretationScore * 0.40) +
      (input.languageScore * 0.20) +
      (input.serviceScore * 0.10) +
      (input.technicalScore * 0.10);
  }

  // Determine Action Required based on score
  let actionRequired = 'Ninguna';
  if (input.criticalError || totalScore < 70) {
    actionRequired = 'Advertencia / Coaching';
  } else if (totalScore < 85) {
    actionRequired = 'Feedback Requerido';
  }

  const auditorEmail = auth.user.email || 'System';
  
  try {
    const data = await db.qAScore.create({
      data: {
        productionLogId: input.productionLogId,
        interpreterId: input.interpreterId,
        auditDate: new Date(),
        auditor: auditorEmail,
        protocolScore: input.protocolScore,
        interpretationScore: input.interpretationScore,
        languageScore: input.languageScore,
        serviceScore: input.serviceScore,
        technicalScore: input.technicalScore,
        criticalError: input.criticalError,
        comentarios: input.comments,
        accionRequerida: actionRequired
      },
      select: { id: true }
    });

    // Notify Interpreter
    try {
      // 1. Get the interpreter via Prisma
      const interpreter = await db.interpreter.findUnique({
        where: { id: input.interpreterId },
        select: { emailCorporativo: true }
      });

      if (interpreter?.emailCorporativo) {
        // 2. Find the auth user linked to this email via Prisma
        const profile = await db.userProfile.findUnique({
          where: { email: interpreter.emailCorporativo },
          select: { id: true }
        });

        if (profile) {
          await createNotification({
            userId: profile.id,
            title: 'Evaluación QA Lista',
            message: `Tu puntaje de sesión: ${totalScore.toFixed(1)}%. Acción: ${actionRequired}`,
            type: totalScore >= 85 ? 'success' : (totalScore >= 70 ? 'info' : 'warning'),
            link: '/dashboard/earnings'
          });
        }
      }
    } catch (notifyErr: unknown) {
      const message = notifyErr instanceof Error ? notifyErr.message : 'Unknown error';
      console.error('Notification failed but QA saved:', message);
    }

    revalidatePath('/qa');
    revalidatePath(`/dashboard`);
    
    return { success: true, data };
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'This production log already has a QA evaluation', code: 'CONFLICT' };
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('QA Submission Error:', message);
    return { success: false, error: 'Unable to save QA evaluation', code: 'INTERNAL_ERROR' };
  }
}

