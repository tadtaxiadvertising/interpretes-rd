import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createHash } from 'crypto';
import { cookies } from 'next/headers';

const db = prisma;

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    
    if (!token) {
      return NextResponse.json({ success: false, error: 'Token required' }, { status: 400 });
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

    // Mark as started (not consumed yet)
    await db.roleplayAccess.update({
      where: { id: access.id },
      data: { startedAt: new Date() },
    });

    // Update session status to STARTED
    await db.roleplaySession.update({
      where: { id: access.sessionId },
      data: { status: 'STARTED' },
    });

    // Set session cookie for continued access
    const cookieStore = await cookies();
    cookieStore.set('roleplay_session', access.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
      path: '/',
    });

    return NextResponse.json({ 
      success: true, 
      data: { 
        sessionId: access.session.id,
        baseAudioUrl: access.session.baseAudioUrl,
      } 
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Start Roleplay Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}