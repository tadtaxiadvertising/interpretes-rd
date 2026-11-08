import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { convertAndStoreMp3 } from '@/lib/roleplay-audio-conversion';

interface ClaimedAudioJob {
  id: string;
  sessionId: string;
  scenarioId: string;
  sourceAudioPath: string;
  attempts: number;
  maxAttempts: number;
}

const workerId = (process.env.ROLEPLAY_AUDIO_WORKER_ID || `roleplay-audio-${randomUUID()}`).slice(0, 100);
const POLL_INTERVAL_MS = 5_000;
const STALE_LOCK_MINUTES = 10;
let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function failExhaustedStaleJobs(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public.roleplay_audio_jobs
    SET status = 'FAILED',
        locked_at = NULL,
        locked_by = NULL,
        last_error = COALESCE(last_error, 'Worker lease expired after maximum attempts'),
        updated_at = NOW()
    WHERE status = 'PROCESSING'
      AND locked_at < NOW() - INTERVAL '10 minutes'
      AND attempts >= max_attempts
  `;
}

async function claimNextJob(): Promise<ClaimedAudioJob | null> {
  const jobs = await prisma.$queryRaw<ClaimedAudioJob[]>`
    WITH candidate AS (
      SELECT id
      FROM public.roleplay_audio_jobs
      WHERE attempts < max_attempts
        AND (
          (status = 'PENDING' AND available_at <= NOW())
          OR (
            status = 'PROCESSING'
            AND locked_at IS NOT NULL
            AND locked_at < NOW() - INTERVAL '10 minutes'
          )
        )
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE public.roleplay_audio_jobs AS job
    SET status = 'PROCESSING',
        attempts = job.attempts + 1,
        locked_at = NOW(),
        locked_by = ${workerId},
        updated_at = NOW()
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING
      job.id,
      job.session_id AS "sessionId",
      job.scenario_id AS "scenarioId",
      job.source_audio_path AS "sourceAudioPath",
      job.attempts,
      job.max_attempts AS "maxAttempts"
  `;

  return jobs[0] ?? null;
}

async function processJob(job: ClaimedAudioJob): Promise<void> {
  const response = await prisma.roleplayResponse.updateMany({
    where: { scenarioId: job.scenarioId, sourceAudioPath: job.sourceAudioPath },
    data: { audioStatus: 'PROCESSING', processingError: null },
  });
  if (response.count !== 1) {
    throw new Error('The source response no longer exists for this conversion job');
  }

  await convertAndStoreMp3(job.sessionId, job.scenarioId, job.sourceAudioPath);

  await prisma.roleplayAudioJob.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });

  console.info(`[ROLEPLAY AUDIO WORKER] Completed job ${job.id}`);
}

async function recordJobFailure(job: ClaimedAudioJob, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : 'Unknown conversion error').slice(0, 1_000);
  const shouldRetry = job.attempts < job.maxAttempts;
  const backoffSeconds = Math.min(300, 15 * (2 ** Math.max(0, job.attempts - 1)));

  await prisma.roleplayAudioJob.update({
    where: { id: job.id },
    data: {
      status: shouldRetry ? 'PENDING' : 'FAILED',
      availableAt: shouldRetry ? new Date(Date.now() + backoffSeconds * 1_000) : undefined,
      lockedAt: null,
      lockedBy: null,
      lastError: message,
    },
  });

  console.error(
    `[ROLEPLAY AUDIO WORKER] Job ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}); ${shouldRetry ? `retry in ${backoffSeconds}s` : 'retries exhausted'}:`,
    message,
  );
}

async function run(): Promise<void> {
  console.info(`[ROLEPLAY AUDIO WORKER] Started as ${workerId}; concurrency=1`);

  while (!stopping) {
    try {
      await failExhaustedStaleJobs();
      const job = await claimNextJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      try {
        await processJob(job);
      } catch (error) {
        await recordJobFailure(job, error);
      }
    } catch (error) {
      console.error(
        '[ROLEPLAY AUDIO WORKER] Queue polling failed:',
        error instanceof Error ? error.message : 'Unknown database error',
      );
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

process.on('SIGTERM', () => {
  stopping = true;
  console.info('[ROLEPLAY AUDIO WORKER] SIGTERM received; finishing current job');
});
process.on('SIGINT', () => {
  stopping = true;
  console.info('[ROLEPLAY AUDIO WORKER] SIGINT received; finishing current job');
});

run()
  .catch(error => {
    console.error('[ROLEPLAY AUDIO WORKER] Fatal error:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
