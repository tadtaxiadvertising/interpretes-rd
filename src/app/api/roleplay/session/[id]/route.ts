import { NextRequest } from 'next/server';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import prisma from '@/lib/prisma';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { actorFromBearer } from '@/lib/api-auth';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { hasCompleteRoleplaySelfAssessment } from '@/lib/roleplay/self-assessment';
import { hasPersistedRoleplayRecording } from '@/lib/roleplay/recording-presence';
import { getSignedAudioUrl } from '@/lib/roleplay';
import { resolveInvitationBaseAudioUrl } from '@/lib/roleplay/invitation-base-audio';

const db = prisma;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = applyRateLimit(req, RATE_LIMITS.sessionAccess);
    if (!rateLimitResult.success) {
      return privateRoleplayResponse(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429, headers: createRateLimitHeaders(rateLimitResult) }
      );
    }

    const { id } = await params;
    const identity = await resolveCurrentIdentity();
    if (!identity) {
      return privateRoleplayResponse({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    // The browser session is the authoritative identity for this route.
    // An explicit Bearer must verify as the same user and role; otherwise a
    // request can cross identities (e.g. admin cookie + interpreter token).
    // Never fall back to cookie authorization for a rejected Bearer.
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer) {
        return privateRoleplayResponse({ success: false, error: 'Not authenticated' }, { status: 401 });
      }
      if (
        bearer.userId !== identity.userId ||
        bearer.role !== identity.role ||
        (identity.role === 'candidate' && bearer.candidateId !== identity.candidateId) ||
        (identity.role === 'interpreter' && bearer.interpreterId !== identity.interpreterId)
      ) {
        return privateRoleplayResponse({ success: false, error: 'Access denied' }, { status: 403 });
      }
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
        access: { select: { usedAt: true, validatedAt: true } },
        scenarios: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            order: true,
            title: true,
            baseAudioUrl: true,
            durationLimitSec: true,
            scriptPrompt: true,
            // Internal curation fields are never queried for participants.
            // The response redaction below additionally protects mocks and
            // future adapters that return more fields than selected.
            studioTurn: identity.role === 'admin',
            studioSpeaker: identity.role === 'admin',
            studioLanguage: identity.role === 'admin',
            sourceStartSec: identity.role === 'admin',
            sourceEndSec: identity.role === 'admin',
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
      return privateRoleplayResponse({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const sessionCookie = req.cookies.get('roleplay_session')?.value ?? null;
    const hasAccess = checkSessionAccess(identity, session, sessionCookie);
    if (!hasAccess) {
      return privateRoleplayResponse({ success: false, error: 'Access denied' }, { status: 403 });
    }

    let baseAudioUrl: string | null = session.baseAudioUrl;
    let mayExposeBaseAudio = true;
    let recordedAudioUrl: string | null = session.recordedAudioUrl;
    let scenarios = session.scenarios;

    if (identity.role !== 'admin' && session.recruitmentCandidateId) {
      const invitationValidated = Boolean(session.access?.validatedAt);
      const invitationConsumed = Boolean(session.access?.usedAt);
      if (!invitationValidated || invitationConsumed) {
        mayExposeBaseAudio = false;
        baseAudioUrl = null;
        recordedAudioUrl = null;
        scenarios = scenarios.map((scenario) => ({ ...scenario, baseAudioUrl: '' }));
      }
      if (!invitationValidated) {
        // A stale session cookie is not proof of a validated invitation.
        // Clear legacy response URLs AND canonical paths before URL signing.
        // In contrast, a *consumed* invite is the normal SUBMITTED state:
        // its owner must still be able to review their recording and repair
        // a missing self-assessment before QA claims the session.
        scenarios = scenarios.map((scenario) => ({
          ...scenario,
          responses: scenario.responses.map((response) => ({
            ...response,
            sourceAudioUrl: null,
            sourceAudioPath: null,
            processedAudioPath: null,
          })),
        }));
      }
    }

    // A session may have a canonical base object key but no legacy URL.
    // Reuse the same strict resolver as invitation entry, only AFTER ownership
    // checks and invitation redaction. Never re-sign hidden candidate audio.
    const supabaseProjectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    if (mayExposeBaseAudio) {
      baseAudioUrl = await resolveInvitationBaseAudioUrl(
        { baseAudioPath: session.baseAudioPath, baseAudioUrl },
        supabaseProjectUrl,
        getSignedAudioUrl,
      );
    }

    // Participant responses must not reveal evaluator keys or Audio Studio's
    // internal source timeline / speaker labels. Those fields are for admin
    // curation and QA, not for answering the scenario.
    if (identity.role !== 'admin') {
      scenarios = scenarios.map((scenario) => {
        const safeScenario = { ...scenario };
        for (const internal of [
          'expectedKeys', 'studioTurn', 'studioSpeaker', 'studioLanguage',
          'sourceStartSec', 'sourceEndSec',
        ] as const) {
          Reflect.deleteProperty(safeScenario, internal);
        }
        return safeScenario;
      });
    }

    // Persist canonical Storage paths and mint short-lived playback URLs on
    // demand. The legacy sourceAudioUrl may be a seven-day signed URL and must
    // not become the permanent source of truth for candidate/admin playback.
    const playbackScenarios = await Promise.all(scenarios.map(async (scenario) => {
      // The invitation resolver already fails closed for malformed or
      // signed first-party Storage URLs, including another bucket or encoded
      // object path. Reuse that policy after access and invitation redaction;
      // preserve only unrelated third-party legacy recordings.
      const scenarioBaseAudioUrl = (await resolveInvitationBaseAudioUrl(
        { baseAudioUrl: scenario.baseAudioUrl },
        supabaseProjectUrl,
        getSignedAudioUrl,
      )) ?? '';
      return {
      ...scenario,
      baseAudioUrl: scenarioBaseAudioUrl,
      responses: await Promise.all(scenario.responses.map(async ({
        sourceAudioPath,
        processedAudioPath,
        ...response
      }) => {
        const playbackPaths = [processedAudioPath, sourceAudioPath]
          .filter((path): path is string => Boolean(path));
        if (playbackPaths.length === 0) return response;
        // Converted MP3 can be missing while the original upload is intact.
        // Try signing only canonical paths already selected for this authorized
        // session. A failed signature must never return the persisted URL.
        for (const path of new Set(playbackPaths)) {
          try {
            return { ...response, sourceAudioUrl: await getSignedAudioUrl(path, 60 * 60) };
          } catch {
            // A failed or missing processed object may be recovered from source.
          }
        }
        console.error('Roleplay response playback URL could not be refreshed:', 'StorageError');
        return { ...response, sourceAudioUrl: null };
      })),
      };
    }));

    return privateRoleplayResponse(
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
            scenarios.some((scenario) => {
              const response = scenario.responses[0];
              return hasPersistedRoleplayRecording(response) &&
                !hasCompleteRoleplaySelfAssessment(response?.selfScore);
            }),
          currentScenarioIndex: session.currentScenarioIndex,
          scenarios: playbackScenarios,
        },
      },
      { headers: { ...createRateLimitHeaders(rateLimitResult), 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
    );
  } catch (error: unknown) {
    // Raw exception messages may contain private Storage URLs, tokens or
    // connection strings. Keep the public error generic and logs categorical.
    console.error('Get Session Error:', error instanceof Error ? 'Error' : 'UnknownError');
    // Internal exception messages may contain database details or private URLs.
    // Log server-side only; never send exception text to candidate/interpreter clients.
    return privateRoleplayResponse(
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

  // Cancellation/expiration revokes participant playback for BOTH roles.
  // Administrators retain read access for auditing and historical QA.
  if (session.status === 'CANCELLED' || session.status === 'EXPIRED') return false;

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
