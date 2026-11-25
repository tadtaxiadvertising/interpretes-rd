import { NextRequest } from 'next/server';
import { guardApiAuth } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { readOperationalNotificationDiagnostics } from '@/lib/notifications/operational-notification-diagnostics';
import { readNotificationDiagnostics } from '@/lib/notifications/notification-diagnostics';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = await guardApiAuth(req, 'admin');
  if (denied) {
    denied.headers.set('Cache-Control', 'private, no-store');
    denied.headers.set('Vary', 'Cookie, Authorization');
    return denied;
  }
  const limit = applyRateLimit(req, RATE_LIMITS.sessionAccess);
  if (!limit.success) return privateRoleplayResponse({ success: false }, {
    status: 429, headers: createRateLimitHeaders(limit),
  });
  try {
    const report = await readNotificationDiagnostics();
    const operational = await readOperationalNotificationDiagnostics();
    return privateRoleplayResponse({ success: true, report, operational }, { headers: createRateLimitHeaders(limit) });
  } catch (error) {
    console.warn('Notification diagnostics unavailable:', safeServerErrorCategory(error));
    return privateRoleplayResponse({ success: false }, { status: 503 });
  }
}
