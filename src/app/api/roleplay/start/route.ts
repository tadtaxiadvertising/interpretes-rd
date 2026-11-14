import { NextRequest } from 'next/server';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import prisma from '@/lib/prisma';
import { createHash } from 'crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { canBindRoleplayInvitation } from '@/lib/roleplay/invite-ownership';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';

const db = prisma;

const StartRoleplaySchema = z.object({
  token: z.string().trim().min(1, 'Token required').max(512),
});

export async function POST(req: NextRequest) {
  const quota = applyRateLimit(req, {
    ...RATE_LIMITS.inviteValidation,
    keyPrefix: 'roleplay-legacy-start',
  });
  if (!quota.success) {
    return privateRoleplayResponse(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { ...createRateLimitHeaders(quota), 'Cache-Control': 'private, no-store' } },
    );
  }
  try {
    let token: string;
    try {
      const parsed = StartRoleplaySchema.safeParse(await req.json());
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

    const preStartStates = ['DRAFT', 'INVITED'];
    const resumableStates = ['STARTED', 'IN_PROGRESS'];
    if (![...preStartStates, ...resumableStates].includes(access.session.status)) {
      return privateRoleplayResponse({ success: false, error: 'Session no longer available' }, { status: 400 });
    }

    // If the start was committed but validation/cookie binding failed, a
    // subsequent authenticated request with the same unexpired, unused token
    // must be able to repair the invitation and resume without a new attempt.
    // Fresh attempts still require CAS to avoid regressing terminal states.
    if (preStartStates.includes(access.session.status)) {
      const transition = await db.roleplaySession.updateMany({
        where: { id: access.sessionId, status: access.session.status },
        data: { status: 'STARTED' },
      });

      if (transition.count === 0) {
        const latestSession = await db.roleplaySession.findUnique({
          where: { id: access.sessionId },
          select: { status: true },
        });

        // Another request may have started it; never regress a terminal state.
        if (!latestSession || !resumableStates.includes(latestSession.status)) {
          return privateRoleplayResponse(
            { success: false, error: 'Session no longer available' },
            { status: 409 },
          );
        }
      }
    } else {
      // A stale read cannot authorize a session cancelled or submitted
      // concurrently. Recheck active status before binding a new cookie.
      const latestSession = await db.roleplaySession.findUnique({
        where: { id: access.sessionId },
        select: { status: true },
      });
      if (!latestSession || !resumableStates.includes(latestSession.status)) {
        return privateRoleplayResponse(
          { success: false, error: 'Session no longer available' },
          { status: 409 },
        );
      }
    }

    // The session-read API withholds candidate audio until validatedAt exists.
    // Preserve the original start timestamp, even on idempotent resume.
    const validatedAt = new Date();
    await db.roleplayAccess.update({
      where: { id: access.id },
      data: { startedAt: access.startedAt ?? validatedAt, validatedAt },
    });

    const cookieStore = await cookies();
    cookieStore.set('roleplay_session', access.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return privateRoleplayResponse(
      {
        success: true,
        data: {
          sessionId: access.session.id,
          baseAudioUrl: access.session.baseAudioUrl,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
    );
  } catch (error: unknown) {
    // Never log exception messages or objects: drivers can embed tokens,
    // private audio URLs and database credentials in their error payloads.
    console.error('Start Roleplay Error:', error instanceof Error ? 'Error' : 'UnknownError');
    return privateRoleplayResponse(
      { success: false, error: 'No fue posible iniciar el roleplay. Inténtalo nuevamente.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
