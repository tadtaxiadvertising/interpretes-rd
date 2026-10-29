import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { setRoleplaySessionCookie } from '@/lib/roleplay/session-cookie';
import { z } from 'zod';

const db = prisma;

const ValidateInviteByCodeSchema = z.object({
  inviteCode: z.string().trim().min(1, 'Invite code required'),
});

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
    let inviteCode: string;
    try {
      const parsed = ValidateInviteByCodeSchema.safeParse(await req.json());
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: 'Invite code required' }, { status: 400 });
      }
      inviteCode = parsed.data.inviteCode;
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
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

    // Compare-and-set the transition: the session may have become terminal
    // after the invitation lookup. Never overwrite a submitted/evaluated state.
    if (['DRAFT', 'INVITED'].includes(access.session.status)) {
      const transition = await db.roleplaySession.updateMany({
        where: { id: access.sessionId, status: access.session.status },
        data: { status: 'STARTED' },
      });

      if (transition.count === 0) {
        // Another request may have started this same session. Resume only if
        // the latest persisted state is still resumable; reject terminal states.
        const latest = await db.roleplaySession.findUnique({
          where: { id: access.sessionId },
          select: { status: true },
        });
        if (!latest || !['STARTED', 'IN_PROGRESS'].includes(latest.status)) {
          return NextResponse.json(
            { success: false, error: 'Session no longer available' },
            { status: 409 }
          );
        }
      } else {
        await db.roleplayAccess.updateMany({
          where: { sessionId: access.sessionId, startedAt: null },
          data: { startedAt: new Date() },
        });
      }
    }

    // Validate + bind only after the guarded transition succeeds. Never consumes
    // the invitation; usedAt remains owned by the later completion flow.
    await db.roleplayAccess.update({
      where: { id: access.id },
      data: { validatedAt: new Date() },
    });
    await setRoleplaySessionCookie(access.session.id);

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