import { NextRequest } from 'next/server';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import prisma from '@/lib/prisma';
import { createHash } from 'crypto';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { canBindRoleplayInvitation } from '@/lib/roleplay/invite-ownership';
import { setRoleplaySessionCookie } from '@/lib/roleplay/session-cookie';
import { z } from 'zod';

const db = prisma;

const ValidateInviteSchema = z.object({
  token: z.string().trim().min(1, 'Token required').max(512),
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
    return privateRoleplayResponse(
      { success: false, error: 'Too many requests. Please try again later.' },
      { 
        status: 429,
        headers: createRateLimitHeaders(rateLimitResult)
      }
    );
  }

  try {
    let token: string;
    try {
      const parsed = ValidateInviteSchema.safeParse(await req.json());
      if (!parsed.success) {
        return privateRoleplayResponse({ success: false, error: 'Token required' }, { status: 400 });
      }
      token = parsed.data.token;
    } catch {
      return privateRoleplayResponse({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    // A leaked invitation token must not start another person's evaluation.
    // Authenticate before looking up tokens, preventing anonymous enumeration.
    const identity = await resolveCurrentIdentity();
    if (!identity) {
      return privateRoleplayResponse(
        { success: false, error: 'Not authenticated' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const access = await db.roleplayAccess.findUnique({
      where: { tokenHash },
      include: { session: true },
    });

    if (!access) {
      return privateRoleplayResponse({ success: false, error: 'Invalid or expired invitation' }, { status: 404 });
    }

    if (!canBindRoleplayInvitation(identity, access.session)) {
      return privateRoleplayResponse(
        { success: false, error: 'Access denied' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    if (access.usedAt) {
      return privateRoleplayResponse({ success: false, error: 'Invitation already used' }, { status: 400 });
    }

    if (access.expiresAt < new Date()) {
      return privateRoleplayResponse({ success: false, error: 'Invitation expired' }, { status: 400 });
    }

    if (!ENTERABLE_STATES.includes(access.session.status)) {
      return privateRoleplayResponse({ success: false, error: 'Session no longer available' }, { status: 400 });
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
          return privateRoleplayResponse(
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
    } else {
      // A stale access lookup must never rebind a cookie after this attempt
      // was submitted, cancelled or evaluated by another request.
      const latest = await db.roleplaySession.findUnique({
        where: { id: access.sessionId },
        select: { status: true },
      });
      if (!latest || !['STARTED', 'IN_PROGRESS'].includes(latest.status)) {
        return privateRoleplayResponse(
          { success: false, error: 'Session no longer available' },
          { status: 409 },
        );
      }
    }

    // Validate + bind only after the guarded transition succeeds. Never consumes
    // the invitation; usedAt remains owned by the later completion flow.
    await db.roleplayAccess.update({
      where: { id: access.id },
      data: { validatedAt: new Date() },
    });
    await setRoleplaySessionCookie(access.session.id);

    return privateRoleplayResponse(
      { 
        success: true, 
        data: { 
          sessionId: access.session.id,
          baseAudioUrl: access.session.baseAudioUrl,
        } 
      },
      { headers: { ...createRateLimitHeaders(rateLimitResult), 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
    );
  } catch (error: unknown) {
    // Never write raw exception messages: drivers may include tokens,
    // connection strings or private invitation metadata in their errors.
    console.error('Validate Invite Error:', error instanceof Error ? 'Error' : 'UnknownError');
    // Tokens and database exception details must not be reflected to the caller.
    return privateRoleplayResponse(
      { success: false, error: 'No fue posible validar la invitación. Inténtalo nuevamente.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}