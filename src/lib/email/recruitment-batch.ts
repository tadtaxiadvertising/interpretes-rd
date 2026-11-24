import type { DispatchResult } from './recruitment-dispatch';
import { EMAIL_BATCH_LIMIT } from './recruitment-batch-discovery';

export type BatchReport = {
  status: 'disabled' | 'busy' | 'completed' | 'unavailable' | 'review_required';
  examined: number;
  accepted: number;
  deferred: number;
  cancelled: number;
  uncertain: number;
};

export interface BatchDependencies {
  discover: () => Promise<string[]>;
  enqueue: (id: string) => Promise<'queued' | 'duplicate' | 'ineligible'>;
  process: (id: string) => Promise<DispatchResult>;
}

export function emptyBatch(status: BatchReport['status']): BatchReport {
  return { status, examined: 0, accepted: 0, deferred: 0, cancelled: 0, uncertain: 0 };
}

/** Sequential processing, no retries, no recipient data in returned reports.
 * Persistent event claims remain the cross-process duplicate guard.
 */
export async function runEmailBatch(enabled: boolean, deps: BatchDependencies): Promise<BatchReport> {
  if (!enabled) return emptyBatch('disabled');
  const report = emptyBatch('completed');
  try {
    const ids = [...new Set(await deps.discover())].slice(0, EMAIL_BATCH_LIMIT);
    for (const id of ids) {
      report.examined++;
      const queued = await deps.enqueue(id);
      if (queued === 'ineligible') { report.deferred++; continue; }
      const result = await deps.process(id);
      if (result === 'accepted') report.accepted++;
      else if (result === 'cancelled') report.cancelled++;
      else if (result === 'unconfirmed' || result === 'reconciliation_required') {
        report.uncertain++;
        report.status = 'review_required';
        break;
      } else if (result === 'disabled') {
        report.deferred++;
        report.status = 'disabled';
        break;
      } else report.deferred++;
    }
    return report;
  } catch {
    // Stop immediately; an interrupted write may require reconciliation.
    return { ...report, status: 'unavailable' };
  }
}
