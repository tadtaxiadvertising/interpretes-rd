import { NextRequest } from 'next/server';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import prisma from '@/lib/prisma';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';

const db = prisma;

const STARTABLE_STATES = ['DRAFT', 'INVITED'];
const RESUMABLE_STATES = ['STARTED', 'IN_PROGRESS'];

export async function POST(
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
    const session = await db.roleplaySession.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        interpreterId: true,
        recruitmentCandidateId: true,
      },
    });

    if (!session) {
      return privateRoleplayResponse({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const sessionCookie = req.cookies.get('roleplay_session')?.value ?? null;
    if (!isSessionOwner(identity, session, sessionCookie)) {
      return privateRoleplayResponse({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Candidate selection Roleplay is part of recruitment and must not be
    // blocked by the operational onboarding required after hiring.
    if (
      identity.role !== 'admin' &&
      identity.role !== 'candidate' &&
      identity.eligibility?.needsOnboarding
    ) {
      return privateRoleplayResponse(
        { success: false, error: 'Complete interpreter onboarding before starting Roleplay.' },
        { status: 403 }
      );
    }

    // A stale session cookie must not keep a rejected, withdrawn, hired or
    // otherwise advanced candidate application eligible for new roleplay work.
    if (session.recruitmentCandidateId && identity.role !== 'admin') {
      const application = await db.recruitmentApplication.findUnique({
        where: { candidateId: session.recruitmentCandidateId },
        select: { status: true },
      });
      const startableApplicationStatuses: readonly string[] = [
        'ROLEPLAY_PENDING',
        'ROLEPLAY_IN_PROGRESS',
        'ROLEPLAY_REVIEW',
      ];
      if (!application || !startableApplicationStatuses.includes(application.status)) {
        return privateRoleplayResponse(
          { success: false, error: 'Application is not eligible for Roleplay.' },
          { status: 409 }
        );
      }
    }

    // A stale active-state read must not authorize restarting a cancelled,
    // expired or submitted session. Recheck before returning a resume token.
    if (RESUMABLE_STATES.includes(session.status)) {
      const latest = await db.roleplaySession.findUnique({
        where: { id: session.id },
        select: { id: true, status: true },
      });
      if (!latest || !RESUMABLE_STATES.includes(latest.status)) {
        return privateRoleplayResponse(
          { success: false, error: 'Session no longer available' },
          { status: 409 },
        );
      }
      return privateRoleplayResponse(
        { success: true, data: { sessionId: latest.id, status: latest.status, resumed: true } },
        { headers: createRateLimitHeaders(rateLimitResult) }
      );
    }

    if (!STARTABLE_STATES.includes(session.status)) {
      return privateRoleplayResponse({ success: false, error: 'Session no longer available' }, { status: 409 });
    }

    // Compare-and-set the state we just validated. Without the status predicate,
    // a concurrent submit/evaluation could be overwritten back to STARTED.
    const transition = await db.roleplaySession.updateMany({
      where: { id: session.id, status: session.status },
      data: { status: 'STARTED' },
    });

    if (transition.count === 0) {
      // Another request changed the state after our initial read. Resume only
      // if that request started the same attempt; never regress terminal states.
      const latest = await db.roleplaySession.findUnique({
        where: { id: session.id },
        select: { id: true, status: true },
      });

      if (latest && RESUMABLE_STATES.includes(latest.status)) {
        return privateRoleplayResponse(
          { success: true, data: { sessionId: latest.id, status: latest.status, resumed: true } },
          { headers: createRateLimitHeaders(rateLimitResult) }
        );
      }

      return privateRoleplayResponse(
        { success: false, error: 'Session no longer available' },
        { status: 409 }
      );
    }

    await db.roleplayAccess.updateMany({
      where: { sessionId: session.id, startedAt: null },
      data: { startedAt: new Date() },
    });

    return privateRoleplayResponse(
      { success: true, data: { sessionId: session.id, status: 'STARTED', resumed: false } },
      { headers: createRateLimitHeaders(rateLimitResult) }
    );
  } catch (error: unknown) {
    // Raw Prisma/Storage messages and attacker-supplied Error.name can leak
    // secrets to centralized logs. Emit only a fixed error category.
    console.error('Start Session Error:', error instanceof Error ? 'Error' : 'UnknownError');
    // Never send database/storage exception text to a candidate or interpreter.
    return privateRoleplayResponse(
      { success: false, error: 'No fue posible iniciar el roleplay. Inténtalo nuevamente.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

function isSessionOwner(
  identity: Awaited<ReturnType<typeof resolveCurrentIdentity>>,
  session: { id: string; interpreterId: number | null; recruitmentCandidateId: number | null; status: string },
  sessionCookie: string | null
): boolean {
  if (!identity) return false;
  if (identity.role === 'admin') return true;
  // Recruitment ownership takes precedence over any legacy provisional
  // interpreterId attached to the same row.
  if (session.recruitmentCandidateId !== null) {
    if (identity.role !== 'candidate' || identity.candidateId !== session.recruitmentCandidateId) return false;
    if (sessionCookie !== session.id) return false;
    // Only allow starting/resuming if session is in a valid pre-submission state
    const startableStates = ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS'];
    return startableStates.includes(session.status);
  }
  return session.interpreterId !== null
    && identity.role === 'interpreter'
    && identity.interpreterId === session.interpreterId;
}
