import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createHash } from 'crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';

const db = prisma;

const StartRoleplaySchema = z.object({
  token: z.string().trim().min(1, 'Token required'),
});

export async function POST(req: NextRequest) {
  try {
    let token: string;
    try {
      const parsed = StartRoleplaySchema.safeParse(await req.json());
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: 'Token required' }, { status: 400 });
      }
      token = parsed.data.token;
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const access = await db.roleplayAccess.findUnique({
      where: { tokenHash },
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

    const validInviteStates = ['DRAFT', 'INVITED'];
    if (!validInviteStates.includes(access.session.status)) {
      return NextResponse.json({ success: false, error: 'Session no longer available' }, { status: 400 });
    }

    // Compare-and-set prevents a concurrent terminal transition being overwritten.
    const transition = await db.roleplaySession.updateMany({
      where: { id: access.sessionId, status: access.session.status },
      data: { status: 'STARTED' },
    });

    if (transition.count === 0) {
      const latestSession = await db.roleplaySession.findUnique({
        where: { id: access.sessionId },
        select: { status: true },
      });

      // A concurrent request may have started the same session; only resume active states.
      if (!latestSession || !['STARTED', 'IN_PROGRESS'].includes(latestSession.status)) {
        return NextResponse.json(
          { success: false, error: 'Session no longer available' },
          { status: 409 },
        );
      }
    }

    // Mark as started (not consumed yet), only after the session transition is safe.
    await db.roleplayAccess.update({
      where: { id: access.id },
      data: { startedAt: new Date() },
    });

    const cookieStore = await cookies();
    cookieStore.set('roleplay_session', access.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return NextResponse.json({
      success: true,
      data: {
        sessionId: access.session.id,
        baseAudioUrl: access.session.baseAudioUrl,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Start Roleplay Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
