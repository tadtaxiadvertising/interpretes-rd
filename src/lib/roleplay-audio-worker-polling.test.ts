// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ROLEPLAY_WORKER_BASE_POLL_MS,
  ROLEPLAY_WORKER_IDLE_GRACE_POLLS,
  ROLEPLAY_WORKER_IDLE_POLL_MS,
  ROLEPLAY_WORKER_STALE_CLEANUP_MS,
  nextRoleplayWorkerIdleDelayMs,
  shouldRunRoleplayWorkerStaleCleanup,
} from './roleplay-audio-worker-polling';

describe('Roleplay audio worker low-cost polling policy', () => {
  it('checks promptly for new work during the first six idle polls', () => {
    for (let count = 1; count <= ROLEPLAY_WORKER_IDLE_GRACE_POLLS; count++) {
      expect(nextRoleplayWorkerIdleDelayMs(count)).toBe(ROLEPLAY_WORKER_BASE_POLL_MS);
    }
  });

  it('backs off only after the idle grace period, without unbounded delays', () => {
    for (const count of [7, 8, 30, 100_000]) {
      expect(nextRoleplayWorkerIdleDelayMs(count)).toBe(ROLEPLAY_WORKER_IDLE_POLL_MS);
    }
    expect(ROLEPLAY_WORKER_IDLE_POLL_MS).toBeLessThanOrEqual(30_000);
  });

  it('runs stale-lease cleanup on startup and on the minute boundary, not every poll', () => {
    const initial = 1_800_000_000_000;
    expect(shouldRunRoleplayWorkerStaleCleanup(initial, null)).toBe(true);
    expect(shouldRunRoleplayWorkerStaleCleanup(initial + 10_000, initial)).toBe(false);
    expect(shouldRunRoleplayWorkerStaleCleanup(initial + 59_999, initial)).toBe(false);
    expect(shouldRunRoleplayWorkerStaleCleanup(initial + ROLEPLAY_WORKER_STALE_CLEANUP_MS, initial)).toBe(true);
    expect(shouldRunRoleplayWorkerStaleCleanup(initial + 120_000, initial + 60_000)).toBe(true);
  });

  it('does not mark a cleanup successful if it has not run', () => {
    // The caller updates lastSuccessfulCleanupMs only after await completes.
    expect(shouldRunRoleplayWorkerStaleCleanup(1_800_000_000_000, null)).toBe(true);
    expect(shouldRunRoleplayWorkerStaleCleanup(1_800_000_010_000, null)).toBe(true);
  });
});
