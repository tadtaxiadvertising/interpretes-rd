'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { z } from 'zod';

const db = prisma;

const RequeueInputSchema = z.object({
  jobId: z.string().min(1).max(128),
});

export interface RequeueRoleplayAudioJobResult {
  success: boolean;
  error?: string;
  code?: 'UNAUTHORIZED' | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR';
  jobId?: string;
}

/**
 * Requeue a FAILED Roleplay audio conversion job.
 *
 * Only FAILED jobs can be requeued. The transition is guarded by a
 * compare-and-set on `status = 'FAILED'`, so concurrent calls cannot
 * double-enqueue the same job; the second caller receives CONFLICT.
 */
export async function requeueFailedRoleplayAudioJob(
  rawInput: unknown,
): Promise<RequeueRoleplayAudioJobResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) {
    return { success: false, error: auth.error, code: 'UNAUTHORIZED' };
  }

  const parsed = RequeueInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: 'Invalid job id', code: 'VALIDATION_ERROR' };
  }
  const { jobId } = parsed.data;

  try {
    const job = await db.roleplayAudioJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, scenarioId: true, sourceAudioPath: true },
    });
    if (!job) {
      return { success: false, error: 'Audio job not found', code: 'NOT_FOUND' };
    }
    if (job.status !== 'FAILED') {
      return {
        success: false,
        error: `Only FAILED jobs can be requeued (current status: ${job.status})`,
        code: 'CONFLICT',
      };
    }

    const requeued = await db.$transaction(async (tx) => {
      const jobUpdate = await tx.roleplayAudioJob.updateMany({
        where: { id: jobId, status: 'FAILED' },
        data: {
          status: 'PENDING',
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          completedAt: null,
        },
      });
      if (jobUpdate.count !== 1) return false;

      // Mirror the job state on the response so the UI stops showing FAILED.
      // processedAudioPath is left untouched: a prior successful MP3 (if any)
      // remains referenceable until the new conversion commits its own path.
      await tx.roleplayResponse.updateMany({
        where: { scenarioId: job.scenarioId, sourceAudioPath: job.sourceAudioPath },
        data: { audioStatus: 'UPLOADED', processingError: null },
      });

      return true;
    });

    if (!requeued) {
      return { success: false, error: 'Job state changed during requeue; retry', code: 'CONFLICT' };
    }

    return { success: true, jobId };
  } catch (error) {
    console.error('Requeue Roleplay audio job error:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Failed to requeue audio job', code: 'INTERNAL_ERROR' };
  }
}
