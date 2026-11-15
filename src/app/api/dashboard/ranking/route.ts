import { resolveApiActor } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { getInterpreterMetrics, getLeaderboard } from '@/services/metrics/metrics-service';

/** Interpreter-only ranking; explicit API Bearer always takes precedence over cookies. */
export async function GET(request: Request) {
  const headers = { Vary: 'Authorization' };
  const actor = await resolveApiActor(request);
  if (!actor) {
    return privateRoleplayResponse(
      { success: false, error: 'Unauthorized' },
      { status: 401, headers },
    );
  }
  if (actor.role !== 'interpreter' || !actor.interpreterId) {
    return privateRoleplayResponse(
      { success: false, error: 'Only interpreters can access this endpoint' },
      { status: 403, headers },
    );
  }

  try {
    const metrics = await getInterpreterMetrics(actor.interpreterId);
    if (!metrics) {
      return privateRoleplayResponse(
        { success: false, error: 'Ranking data not available - metrics not calculated yet' },
        { status: 404, headers },
      );
    }

    // Preserve the explicitly published interpreter leaderboard. Do not
    // return other fields from the raw metrics or expose error diagnostics.
    const leaderboard = await getLeaderboard(undefined, 10);
    return privateRoleplayResponse({
      success: true,
      data: {
        ...metrics,
        leaderboard: leaderboard.map((entry, index) => ({
          position: index + 1,
          name: entry.name,
          minutes: entry.interpretedMinutes,
          qaScore: entry.qaScore,
        })),
        myPosition: metrics.rankingPosition,
        myMinutes: metrics.interpretedMinutes,
        myQaScore: metrics.qaScore,
      },
    }, { headers });
  } catch {
    // Prisma/network exceptions may contain connection strings and private
    // interpreter identifiers. Never send or log their raw contents.
    console.error('[INTERPRETER_RANKING] Failed to load ranking');
    return privateRoleplayResponse(
      { success: false, error: 'Internal server error' },
      { status: 500, headers },
    );
  }
}
