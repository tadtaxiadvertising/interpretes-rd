import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { convertAndStoreMp3 } from '@/lib/roleplay-audio-conversion';
import { findMissingWorkerEnvVars } from '@/lib/roleplay-audio-worker-config';
import { markResponseProcessingIfLeaseOwned } from '@/lib/roleplay-audio-worker-lease';
import { safeRoleplayAudioJobError } from '@/lib/roleplay-audio-worker-errors';
import {
  ROLEPLAY_WORKER_BASE_POLL_MS,
  nextRoleplayWorkerIdleDelayMs,
  shouldRunRoleplayWorkerStaleCleanup,
} from '@/lib/roleplay-audio-worker-polling';

interface ClaimedAudioJob {
  id: string;
  sessionId: string;
  scenarioId: string;
  sourceAudioPath: string;
  attempts: number;
  maxAttempts: number;
}

// Always include a process-unique suffix. A shared configured prefix must never
// let two replicas impersonate one another when fencing a reclaimed lease.
const workerPrefix = (process.env.ROLEPLAY_AUDIO_WORKER_ID || 'roleplay-audio').slice(0, 60);
const workerId = `${workerPrefix}-${randomUUID()}`;
// Initial and steady-state polling intervals are defined in the shared,
 // tested idle policy: frequent after activity, slower while idle.
// A worker that disappears mid-conversion is considered stale after this many
// minutes. Five minutes is safely above the 300-second conversion ceiling while
// still recovering a crashed worker within a single deploy window.
const STALE_LOCK_MINUTES = 5;
let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function failExhaustedStaleJobs(): Promise<void> {
  await prisma.$executeRaw`
    WITH exhausted AS (
      UPDATE public.roleplay_audio_jobs
      SET status = 'FAILED',
          locked_at = NULL,
          locked_by = NULL,
          -- Never copy earlier unredacted provider errors to responses.
          last_error = 'Worker lease expired after maximum attempts',
          updated_at = NOW()
      WHERE status = 'PROCESSING'
        AND locked_at < NOW() - (${STALE_LOCK_MINUTES} * INTERVAL '1 minute')
        AND attempts >= max_attempts
      RETURNING scenario_id, source_audio_path, last_error
    )
    UPDATE public.roleplay_responses AS response
    SET audio_status = 'FAILED',
        processing_error = LEFT(exhausted.last_error, 500)
    FROM exhausted
    WHERE response.scenario_id = exhausted.scenario_id
      AND response.source_audio_path = exhausted.source_audio_path
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
            AND locked_at < NOW() - (${STALE_LOCK_MINUTES} * INTERVAL '1 minute')
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
  let leaseLost = false;
  let heartbeatInFlight = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatInFlight || leaseLost) return;
    heartbeatInFlight = true;
    try {
      const renewed = await prisma.roleplayAudioJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
        data: { lockedAt: new Date() },
      });
      if (renewed.count !== 1) leaseLost = true;
    } catch (error) {
      // A failed heartbeat means ownership can no longer be proven. Do not
      // commit output from this worker; a later claim may safely retry it.
      leaseLost = true;
      console.error(
        '[ROLEPLAY AUDIO WORKER] Lease renewal failed:',
        error instanceof Error ? 'Error' : 'UnknownError',
      );
    } finally {
      heartbeatInFlight = false;
    }
  }, 60_000);
  heartbeat.unref();

  try {
    const responsePrepared = await prisma.$transaction((tx) =>
      markResponseProcessingIfLeaseOwned({
        renewOwnedLease: async () => {
          const renewed = await tx.roleplayAudioJob.updateMany({
            where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
            data: { lockedAt: new Date() },
          });
          return renewed.count === 1;
        },
        markResponseProcessing: async () => {
          const response = await tx.roleplayResponse.updateMany({
            where: { scenarioId: job.scenarioId, sourceAudioPath: job.sourceAudioPath },
            data: { audioStatus: 'PROCESSING', processingError: null },
          });
          return response.count;
        },
      }),
    );
    if (!responsePrepared) {
      throw new Error('Audio conversion lease was lost before processing started');
    }

    const processedAudioPath = await convertAndStoreMp3(
      job.sessionId,
      job.scenarioId,
      job.sourceAudioPath,
    );
    if (leaseLost) throw new Error('Audio conversion lease was lost before completion');

    // The job lease and response become complete atomically. A stale worker
    // cannot publish READY after another worker has reclaimed its job.
    const committed = await prisma.$transaction(async (tx) => {
      const completed = await tx.roleplayAudioJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      if (completed.count !== 1) return false;

      const response = await tx.roleplayResponse.updateMany({
        where: { scenarioId: job.scenarioId, sourceAudioPath: job.sourceAudioPath },
        data: {
          processedAudioPath,
          audioStatus: 'READY',
          processingError: null,
        },
      });
      if (response.count !== 1) {
        throw new Error('The source response disappeared before conversion could be committed');
      }
      return true;
    });
    if (!committed) {
      throw new Error('Audio conversion lease was lost before the job could be committed');
    }

    console.info('[ROLEPLAY AUDIO WORKER] Audio conversion job completed');
  } finally {
    clearInterval(heartbeat);
  }
}

async function recordJobFailure(job: ClaimedAudioJob, error: unknown): Promise<void> {
  const message = safeRoleplayAudioJobError(error);
  const shouldRetry = job.attempts < job.maxAttempts;
  const backoffSeconds = Math.min(300, 15 * (2 ** Math.max(0, job.attempts - 1)));

  const updated = await prisma.$transaction(async (tx) => {
    const jobUpdate = await tx.roleplayAudioJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: shouldRetry ? 'PENDING' : 'FAILED',
        availableAt: shouldRetry ? new Date(Date.now() + backoffSeconds * 1_000) : undefined,
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
    });
    if (jobUpdate.count !== 1) return false;

    // A response remains PROCESSING while a retry is pending. Mark it FAILED
    // only when the final attempt is exhausted and this worker still owns the job.
    if (!shouldRetry) {
      await tx.roleplayResponse.updateMany({
        where: { scenarioId: job.scenarioId, sourceAudioPath: job.sourceAudioPath },
        data: { audioStatus: 'FAILED', processingError: message.slice(0, 500) },
      });
    }
    return true;
  });
  if (!updated) {
    console.warn('[ROLEPLAY AUDIO WORKER] Failure update skipped: job lease not owned');
    return;
  }

  console.error(
    `[ROLEPLAY AUDIO WORKER] Conversion failed (attempt ${job.attempts}/${job.maxAttempts}); ${shouldRetry ? `retry in ${backoffSeconds}s` : 'retries exhausted'}:`,
    message,
  );
}

async function run(): Promise<void> {
  console.info('[ROLEPLAY AUDIO WORKER] Started; concurrency=1');
  let consecutiveEmptyPolls = 0;
  let lastSuccessfulCleanupMs: number | null = null;

  while (!stopping) {
    try {
      // Lease cleanup needs periodic checks, not a DB UPDATE every 10s
      // while an idle worker waits for a new audio job.
      if (shouldRunRoleplayWorkerStaleCleanup(Date.now(), lastSuccessfulCleanupMs)) {
        await failExhaustedStaleJobs();
        lastSuccessfulCleanupMs = Date.now();
      }
      const job = await claimNextJob();
      if (!job) {
        consecutiveEmptyPolls++;
        await sleep(nextRoleplayWorkerIdleDelayMs(consecutiveEmptyPolls));
        continue;
      }

      consecutiveEmptyPolls = 0;
      try {
        await processJob(job);
      } catch (error) {
        await recordJobFailure(job, error);
      }
    } catch (error) {
      consecutiveEmptyPolls = 0;
      console.error(
        '[ROLEPLAY AUDIO WORKER] Queue polling failed:',
        error instanceof Error ? 'Error' : 'UnknownError',
      );
      await sleep(ROLEPLAY_WORKER_BASE_POLL_MS);
    }
  }
}

const missingEnvVars = findMissingWorkerEnvVars();
if (missingEnvVars.length > 0) {
  console.error(
    `[ROLEPLAY AUDIO WORKER] Missing required environment variables: ${missingEnvVars.join(', ')}`,
  );
  process.exit(1);
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
    console.error('[ROLEPLAY AUDIO WORKER] Fatal error:', error instanceof Error ? 'Error' : 'UnknownError');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
