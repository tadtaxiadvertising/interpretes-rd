import { NextResponse } from 'next/server';
import { emailDeliveryMode } from '@/lib/email/pilot-recipient';
import { authorizeEmailScheduler } from '@/lib/email/scheduler-auth';
import { processRecruitmentEmailBatch } from '@/lib/email/recruitment-batch-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function response(body: object, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization' } });
}

/** /api/cron is excluded from browser-session middleware. This route must
 * authenticate independently before invoking any database or SMTP operation.
 * No request payload, recipient, or event ID is accepted.
 */
export async function POST(request: Request) {
  if (!authorizeEmailScheduler(request.headers.get('authorization'), process.env.OPERATIONAL_EMAIL_SCHEDULER_SECRET)) {
    return response({ status: 'unauthorized' }, 401);
  }
  if (process.env.OPERATIONAL_EMAIL_SCHEDULER_ENABLED !== 'true' || emailDeliveryMode(process.env) !== 'general') return response({ status: 'disabled' }, 503);
  try {
    const report = await processRecruitmentEmailBatch();
    const status = report.status === 'completed' ? 200 : report.status === 'busy' ? 429 : 503;
    return response(report, status);
  } catch {
    return response({ status: 'unavailable' }, 503);
  }
}
