import { NextRequest, NextResponse } from 'next/server';
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

    const updated = await db.roleplaySession.update({
      where: { id: session.id },
      data: { status: 'STARTED' },
      select: { id: true, status: true },
    });

    await db.roleplayAccess.updateMany({
      where: { sessionId: session.id, startedAt: null },
      data: { startedAt: new Date() },
    });

    return NextResponse.json(
      { success: true, data: { sessionId: updated.id, status: updated.status, resumed: false } },
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
  session: { id: string; interpreterId: number | null; recruitmentCandidateId: number | null; status: string },
  sessionCookie: string | null
): boolean {
  if (!identity) return false;
  if (identity.role === 'admin') return true;
  if (session.interpreterId && identity.interpreterId === session.interpreterId) return true;
  if (session.recruitmentCandidateId) {
    if (sessionCookie !== session.id) return false;
    // Only allow starting/resuming if session is in a valid pre-submission state
    const startableStates = ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS'];
    return startableStates.includes(session.status);
  }
  return false;
}
