import { guardApiAuth } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { getAdminLeaderboard } from '@/lib/ranking/calculate';

/**
 * Ranking includes interpreter names, production minutes and private QA
 * scores. Resolve the same API actor as the middleware (explicit Bearer
 * takes precedence), and never cache or log sensitive provider diagnostics.
 */
export async function GET(request: Request) {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) {
    denied.headers.set('Cache-Control', 'private, no-store');
    denied.headers.set('Vary', 'Cookie, Authorization');
    return denied;
  }

  try {
    const leaderboard = await getAdminLeaderboard();
    return privateRoleplayResponse(
      { success: true, data: leaderboard },
      { headers: { Vary: 'Authorization' } },
    );
  } catch {
    // Never log raw Prisma/network exceptions; they may contain DSNs or PII.
    console.error('[ADMIN_RANKING] Failed to calculate leaderboard');
    return privateRoleplayResponse(
      { success: false, error: 'No fue posible calcular el ranking administrativo.' },
      { status: 500, headers: { Vary: 'Authorization' } },
    );
  }
}
