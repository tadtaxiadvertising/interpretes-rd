import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';

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
        recordedAudioUrl: true,
        status: true,
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
            expectedKeys: true,
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

    return NextResponse.json(
      {
        success: true,
        data: {
          id: session.id,
          baseAudioUrl,
          recordedAudioUrl,
          status: session.status,
          currentScenarioIndex: session.currentScenarioIndex,
          scenarios,
        },
      },
      { headers: createRateLimitHeaders(rateLimitResult) }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Get Session Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
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

  // Interpreter sessions are strictly bound to the resolved interpreter id.
  if (session.interpreterId && identity.interpreterId === session.interpreterId) return true;

  // Candidate sessions require the opaque server-issued session cookie created
  // by the invite/start flow. An authenticated user alone is not sufficient.
  if (session.recruitmentCandidateId) {
    return sessionCookie === session.id && ['STARTED', 'IN_PROGRESS'].includes(session.status);
  }

  return false;
}
