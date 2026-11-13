import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { hasCompleteRoleplaySelfAssessment } from '@/lib/roleplay/self-assessment';
import { getSignedAudioUrl } from '@/lib/roleplay';

const db = prisma;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = applyRateLimit(req, RATE_LIMITS.sessionAccess);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429, headers: createRateLimitHeaders(rateLimitResult) }
      );
    }

    const { id } = await params;
    const identity = await resolveCurrentIdentity();
    if (!identity) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const session = await db.roleplaySession.findUnique({
      where: { id },
      select: {
        id: true,
        baseAudioUrl: true,
        baseAudioPath: true,
        recordedAudioUrl: true,
        status: true,
        evaluatorId: true,
        qaScoreId: true,
        interpreterId: true,
        recruitmentCandidateId: true,
        currentScenarioIndex: true,
        access: { select: { tokenHash: true, usedAt: true, validatedAt: true } },
        scenarios: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            order: true,
            title: true,
            baseAudioUrl: true,
            durationLimitSec: true,
            scriptPrompt: true,
            // Expected keys are evaluator-only material. Do not even retrieve
            // them for candidates/interpreters, not merely hide them in the UI.
            expectedKeys: identity.role === 'admin',
            responses: {
              select: {
                sourceAudioUrl: true,
                sourceAudioPath: true,
                processedAudioPath: true,
                durationSec: true,
                selfScore: true,
                selfNotes: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const sessionCookie = req.cookies.get('roleplay_session')?.value ?? null;
    const hasAccess = checkSessionAccess(identity, session, sessionCookie);
    if (!hasAccess) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    let baseAudioUrl: string | null = session.baseAudioUrl;
    let recordedAudioUrl: string | null = session.recordedAudioUrl;
    let scenarios = session.scenarios;

    if (identity.role !== 'admin' && session.recruitmentCandidateId) {
      const hasValidToken = session.access?.validatedAt && !session.access.usedAt;
      if (!hasValidToken) {
        baseAudioUrl = null;
        recordedAudioUrl = null;
        scenarios = scenarios.map((s) => ({ ...s, baseAudioUrl: '' }));
      }
    }

    // New sessions retain the canonical Storage path separately from the legacy URL.
    // Mint a fresh short-lived URL on every authorized read so recordings do not
    // stop playing when the original seven-day confirmation URL expires.
    if (baseAudioUrl && session.baseAudioPath) {
      try {
        baseAudioUrl = await getSignedAudioUrl(session.baseAudioPath, 60 * 60);
      } catch (error) {
        console.error('Roleplay base audio playback URL could not be refreshed:', error instanceof Error ? error.message : 'Unknown storage error');
        baseAudioUrl = null;
      }
    }

    // Explicitly whitelist the candidate-facing scenario payload as defense in
    // depth for mocks, legacy query adapters, and future changes to the select.
    if (identity.role !== 'admin') {
      scenarios = scenarios.map((scenario) => {
        const safeScenario = { ...scenario };
        Reflect.deleteProperty(safeScenario, 'expectedKeys');
        return safeScenario;
      });
    }

    // Persist canonical Storage paths and mint short-lived playback URLs on
    // demand. The legacy sourceAudioUrl may be a seven-day signed URL and must
    // not become the permanent source of truth for candidate/admin playback.
    const playbackScenarios = await Promise.all(scenarios.map(async (scenario) => ({
      ...scenario,
      responses: await Promise.all(scenario.responses.map(async ({
        sourceAudioPath,
        processedAudioPath,
        ...response
      }) => {
        const playbackPath = processedAudioPath ?? sourceAudioPath;
        if (!playbackPath) return response;
        try {
          return { ...response, sourceAudioUrl: await getSignedAudioUrl(playbackPath, 60 * 60) };
        } catch (error) {
          console.error(
            'Roleplay response playback URL could not be refreshed:',
            error instanceof Error ? error.message : 'Unknown storage error',
          );
          return { ...response, sourceAudioUrl: null };
        }
      })),
    })));

    return NextResponse.json(
      {
        success: true,
        data: {
          id: session.id,
          baseAudioUrl,
          recordedAudioUrl,
          status: session.status,
          canCompleteSelfAssessment:
            session.status === 'SUBMITTED' &&
            !session.evaluatorId &&
            !session.qaScoreId &&
            session.scenarios.some((scenario) => {
              const response = scenario.responses[0];
              return Boolean(response?.sourceAudioUrl) &&
                !hasCompleteRoleplaySelfAssessment(response?.selfScore);
            }),
          currentScenarioIndex: session.currentScenarioIndex,
          scenarios: playbackScenarios,
        },
      },
      { headers: { ...createRateLimitHeaders(rateLimitResult), 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Get Session Error:', message);
    // Internal exception messages may contain database details or private URLs.
    // Log server-side only; never send exception text to candidate/interpreter clients.
    return NextResponse.json(
      { success: false, error: 'No fue posible cargar la sesión. Inténtalo nuevamente.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

function checkSessionAccess(
  identity: Awaited<ReturnType<typeof resolveCurrentIdentity>> | null,
  session: {
    id?: string;
    interpreterId: number | null;
    recruitmentCandidateId: number | null;
    status: string;
  },
  sessionCookie: string | null
): boolean {
  if (!identity) return false;
  if (identity.role === 'admin') return true;

  // Recruitment sessions belong exclusively to their candidate, even when
  // legacy rows still carry a provisional interpreterId.
  if (session.recruitmentCandidateId !== null) {
    if (identity.role !== 'candidate' || identity.candidateId !== session.recruitmentCandidateId) return false;
    if (sessionCookie !== session.id) return false;
    const candidateAccessibleStates = ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'];
    return candidateAccessibleStates.includes(session.status);
  }

  return session.interpreterId !== null
    && identity.role === 'interpreter'
    && identity.interpreterId === session.interpreterId;
}
