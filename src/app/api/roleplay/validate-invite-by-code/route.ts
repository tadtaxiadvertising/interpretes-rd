import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { setRoleplaySessionCookie } from '@/lib/roleplay/session-cookie';

const db = prisma;

// Invitation entry is validate + start: opening a still-available link binds
// the browser to the session and moves it out of the pre-start states. A
// session already in progress is resumed. Consumption (usedAt) stays a
// separate, later step and is never triggered by validation.
const ENTERABLE_STATES = ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS'];

export async function POST(req: NextRequest) {
  // Apply rate limiting
  const rateLimitResult = applyRateLimit(req, RATE_LIMITS.inviteValidation);
  
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { 
        status: 429,
        headers: createRateLimitHeaders(rateLimitResult)
      }
    );
  }

  try {
    const { inviteCode } = await req.json();
    
    if (!inviteCode) {
      return NextResponse.json({ success: false, error: 'Invite code required' }, { status: 400 });
    }

    const access = await db.roleplayAccess.findUnique({
      where: { inviteCode: inviteCode.toUpperCase() },
      include: { session: true },
    });

    if (!access) {
      return NextResponse.json({ success: false, error: 'Invalid or expired invitation' }, { status: 404 });
    }

    if (access.usedAt) {
      return NextResponse.json({ success: false, error: 'Invitation already used' }, { status: 400 });
    }

    if (access.expiresAt < new Date()) {
      return NextResponse.json({ success: false, error: 'Invitation expired' }, { status: 400 });
    }

    if (!ENTERABLE_STATES.includes(access.session.status)) {
      return NextResponse.json({ success: false, error: 'Session no longer available' }, { status: 400 });
    }

    // Bind the browser to this session (opaque server-issued credential).
    await setRoleplaySessionCookie(access.session.id);

    // Validate + start. Never consumes the invitation.
    await db.roleplayAccess.update({
      where: { id: access.id },
      data: { validatedAt: new Date() },
    });

    if (['DRAFT', 'INVITED'].includes(access.session.status)) {
      await db.roleplaySession.update({
        where: { id: access.sessionId },
        data: { status: 'STARTED' },
      });
      await db.roleplayAccess.updateMany({
        where: { sessionId: access.sessionId, startedAt: null },
        data: { startedAt: new Date() },
      });
    }

    return NextResponse.json(
      { 
        success: true, 
        data: { 
          sessionId: access.session.id,
          baseAudioUrl: access.session.baseAudioUrl,
        } 
      },
      { headers: createRateLimitHeaders(rateLimitResult) }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Validate Invite By Code Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}