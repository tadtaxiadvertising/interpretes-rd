
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';

const db = prisma;

export async function GET(req: Request) {
  try {
    const auth = await validateAction('interpreter');
    if ('error' in auth) return privateRoleplayResponse({ success: false, error: auth.error }, { status: 403 });

    const interpreterId = auth.profile?.interpreterId;
    // This dashboard intentionally requires a browser cookie identity.
    // A caller that also supplies Authorization must prove the SAME
    // interpreter. Do not let an unrelated explicit Bearer read cookie-owned
    // roleplay metadata, including scores and assessment status.
    if (req.headers.has('authorization')) {
      let bearer: Awaited<ReturnType<typeof actorFromBearer>> = null;
      try {
        bearer = await actorFromBearer(req);
      } catch {
        // An invalid/unavailable Bearer must never fall back to cookies.
      }
      if (!bearer || bearer.role !== 'interpreter' ||
          bearer.userId !== auth.user.userId ||
          bearer.interpreterId !== interpreterId) {
        return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    if (!interpreterId) {
      return privateRoleplayResponse({ success: false, error: 'No interpreter profile found' }, { status: 404 });
    }

    // Legacy recruitment sessions can still contain a provisional interpreterId.
    // Candidate-owned sessions must never appear in the interpreter dashboard,
    // matching the ownership rule of GET /api/roleplay/session/[id].
    const sessions = await db.roleplaySession.findMany({
      where: { interpreterId, recruitmentCandidateId: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        submittedAt: true,
        evaluatedAt: true,
        qaScore: {
          select: { totalScore: true, criticalError: true, accionRequerida: true },
        },
      },
    });

    // Explicit response DTO prevents accidental disclosure if the ORM query
    // grows later (e.g. signed audio URLs, reviewer IDs or candidate details).
    const data = sessions.map((session) => ({
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      submittedAt: session.submittedAt,
      evaluatedAt: session.evaluatedAt,
      qaScore: session.qaScore ? {
        totalScore: session.qaScore.totalScore,
        criticalError: session.qaScore.criticalError,
        accionRequerida: session.qaScore.accionRequerida,
      } : null,
    }));
    return privateRoleplayResponse(
      { success: true, data },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
    );
  } catch (error: unknown) {
    console.error('Get My Roleplays Error:', safeServerErrorCategory(error));
    return privateRoleplayResponse(
      { success: false, error: 'No fue posible recuperar tus roleplays.' },
      { status: 500 }
    );
  }
}