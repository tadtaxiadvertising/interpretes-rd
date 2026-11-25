import prisma from '@/lib/prisma';
import { emailDeliveryMode, pilotRecipient } from './pilot-recipient';
import { runtimeMailConfigured } from './preferred-provider-runtime';
import { readEmailDatabaseReadiness } from './database-readiness';
import { discoverEmailEvents } from './recruitment-batch-discovery';
import { runEmailBatch, emptyBatch, type BatchReport } from './recruitment-batch';
import { enqueueRecruitmentEmail } from './recruitment-delivery-ledger';
import { processQueuedRecruitmentEmail } from './recruitment-dispatch-server';

let running = false;
let nextRunAt = 0;

/** Internal bounded batch entrypoint. No route, timer or automatic invocation.
 * Per-process cooldown protects a single runtime; atomic ledger claims
 * prevent duplicate delivery of an event across runtimes.
 */
export async function processRecruitmentEmailBatch(): Promise<BatchReport> {
  if (process.env.OPERATIONAL_EMAIL_BATCH_ENABLED !== 'true'
    || process.env.OPERATIONAL_EMAIL_DISPATCH_ENABLED !== 'true'
    || process.env.OPERATIONAL_EMAIL_BINDING_ENABLED !== 'true'
    || !await runtimeMailConfigured(prisma, process.env)) return emptyBatch('disabled');
  const pilot = pilotRecipient(process.env);
  if (pilot === false || emailDeliveryMode(process.env) === 'disabled') return emptyBatch('disabled');
  const cutover = process.env.OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE;
  if (!cutover || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cutover)) return emptyBatch('disabled');
  const date = new Date(cutover);
  const now = new Date();
  if (!Number.isFinite(date.getTime()) || date > now || date.toISOString() !== cutover.replace('Z', '.000Z')) return emptyBatch('disabled');
  if (running || Date.now() < nextRunAt) return emptyBatch('busy');
  running = true;
  nextRunAt = Date.now() + 60000;
  try {
    if ((await readEmailDatabaseReadiness(prisma)).status !== 'ready') return emptyBatch('unavailable');
    return await runEmailBatch(true, {
      discover: async () => (await discoverEmailEvents(prisma, date, now, pilot)).slice(0, pilot ? 1 : 3),
      enqueue: id => enqueueRecruitmentEmail(prisma, id),
      process: processQueuedRecruitmentEmail,
    });
  } finally {
    running = false;
  }
}
