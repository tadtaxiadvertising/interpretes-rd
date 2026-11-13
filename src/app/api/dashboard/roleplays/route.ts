import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';

const db = prisma;

export async function GET() {
  try {
    const auth = await validateAction('interpreter');
    if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: 403 });

    const interpreterId = auth.profile?.interpreterId;
    if (!interpreterId) {
      return NextResponse.json({ success: false, error: 'No interpreter profile found' }, { status: 404 });
    }

    // Legacy recruitment sessions can still contain a provisional interpreterId.
    // Candidate-owned sessions must never appear in the interpreter dashboard,
    // matching the ownership rule of GET /api/roleplay/session/[id].
    const sessions = await db.roleplaySession.findMany({
      where: { interpreterId, recruitmentCandidateId: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        submittedAt: true,
        evaluatedAt: true,
        qaScore: {
          select: { totalScore: true, criticalError: true, accionRequerida: true },
        },
      },
    });

    // Explicit response DTO prevents accidental disclosure if the ORM query
    // grows later (e.g. signed audio URLs, reviewer IDs or candidate details).
    const data = sessions.map((session) => ({
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      submittedAt: session.submittedAt,
      evaluatedAt: session.evaluatedAt,
      qaScore: session.qaScore ? {
        totalScore: session.qaScore.totalScore,
        criticalError: session.qaScore.criticalError,
        accionRequerida: session.qaScore.accionRequerida,
      } : null,
    }));
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
    );
  } catch (error: unknown) {
    console.error('Get My Roleplays Error:', error);
    return NextResponse.json(
      { success: false, error: 'No fue posible recuperar tus roleplays.' },
      { status: 500 }
    );
  }
}