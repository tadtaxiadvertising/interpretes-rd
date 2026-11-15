import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/auth/cron-auth';

/**
 * Shift reminder delivery has not been implemented. The old handler selected
 * interpreter personal data, logged names/emails and returned IDs in a
 * "remindersSent" array even though no email or notification was sent.
 *
 * Fail explicitly rather than claiming dispatch, and do not query personal
 * records until a real, verified delivery provider exists.
 */
export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req.headers.get('authorization'))) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return NextResponse.json(
    {
      success: false,
      code: 'SHIFT_REMINDERS_NOT_CONFIGURED',
      error: 'Shift reminder delivery is not configured.',
      remindersSent: [],
    },
    { status: 501, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
