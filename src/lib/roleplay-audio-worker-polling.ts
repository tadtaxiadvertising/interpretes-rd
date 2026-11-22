import { setTimeout as delay } from 'node:timers/promises';

/**
 * Audio worker queue polling policy.
 *
 * The worker has no real-time wake-up channel: keep 10-second checks for the
 * first minute of inactivity, then reduce idle DB traffic to one claim query
 * every 30 seconds. Keep stale-lease cleanup on its own 60-second cadence.
 * Both schedules reset after real work; this is process-local, not a new cron.
 */
export const ROLEPLAY_WORKER_BASE_POLL_MS = 10_000;
export const ROLEPLAY_WORKER_IDLE_POLL_MS = 30_000;
export const ROLEPLAY_WORKER_IDLE_GRACE_POLLS = 6;
export const ROLEPLAY_WORKER_STALE_CLEANUP_MS = 60_000;

export function nextRoleplayWorkerIdleDelayMs(consecutiveEmptyPolls: number): number {
  return consecutiveEmptyPolls <= ROLEPLAY_WORKER_IDLE_GRACE_POLLS
    ? ROLEPLAY_WORKER_BASE_POLL_MS : ROLEPLAY_WORKER_IDLE_POLL_MS;
}

/** Runs on startup, then at most once per interval after a successful cleanup. */
export function shouldRunRoleplayWorkerStaleCleanup(
  nowMs: number,
  lastSuccessfulCleanupMs: number | null,
): boolean {
  return lastSuccessfulCleanupMs === null ||
    nowMs - lastSuccessfulCleanupMs >= ROLEPLAY_WORKER_STALE_CLEANUP_MS;
}

/**
 * Wait for the next poll but wake immediately when the worker receives a stop
 * signal. The shutdown signal must NOT abort an already-running audio job:
 * only this idle timer listens for it.
 */
export async function waitForRoleplayWorkerPoll(
  ms: number,
  shutdownSignal: AbortSignal,
): Promise<void> {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('INVALID_WORKER_POLL_DELAY');
  try {
    await delay(ms, undefined, { signal: shutdownSignal });
  } catch (error) {
    // A normal shutdown cancels only the timer and is not a queue error.
    if (shutdownSignal.aborted && error instanceof Error && error.name === 'AbortError') return;
    throw error;
  }
}
