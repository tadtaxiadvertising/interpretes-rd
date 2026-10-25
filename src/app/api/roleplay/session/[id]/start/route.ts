import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';

const db = prisma;

const STARTABLE_STATES = ['DRAFT', 'INVITED', 'PENDING'];
const RESUMABLE_STATES = ['STARTED', 'IN_PROGRESS'];

export async function POST(
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
    if (identity.role !== 'admin' && identity.eligibility?.needsOnboarding) {
      return NextResponse.json(
        { success: false, error: 'Complete onboarding before starting Roleplay.' },
        { status: 403 }
      );
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
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const sessionCookie = req.cookies.get('roleplay_session')?.value ?? null;
    if (!isSessionOwner(identity, session, sessionCookie)) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Idempotent: an attempt already in progress stays in progress.
    if (RESUMABLE_STATES.includes(session.status)) {
      return NextResponse.json(
        { success: true, data: { sessionId: session.id, status: session.status, resumed: true } },
        { headers: createRateLimitHeaders(rateLimitResult) }
      );
    }

    if (!STARTABLE_STATES.includes(session.status)) {
      return NextResponse.json({ success: false, error: 'Session no longer available' }, { status: 409 });
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
        return NextResponse.json(
          { success: true, data: { sessionId: latest.id, status: latest.status, resumed: true } },
          { headers: createRateLimitHeaders(rateLimitResult) }
        );
      }

      return NextResponse.json(
        { success: false, error: 'Session no longer available' },
        { status: 409 }
      );
    }

    await db.roleplayAccess.updateMany({
      where: { sessionId: session.id, startedAt: null },
      data: { startedAt: new Date() },
    });

    return NextResponse.json(
      { success: true, data: { sessionId: session.id, status: 'STARTED', resumed: false } },
      { headers: createRateLimitHeaders(rateLimitResult) }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Start Session Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function isSessionOwner(
  identity: Awaited<ReturnType<typeof resolveCurrentIdentity>>,
  session: { id: string; interpreterId: number | null; recruitmentCandidateId: number | null },
  sessionCookie: string | null
): boolean {
  if (!identity) return false;
  if (identity.role === 'admin') return true;
  if (session.interpreterId && identity.interpreterId === session.interpreterId) return true;
  if (session.recruitmentCandidateId) return sessionCookie === session.id;
  return false;
}
