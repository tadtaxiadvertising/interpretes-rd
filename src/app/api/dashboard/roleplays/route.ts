import { NextRequest, NextResponse } from 'next/server';
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

    const sessions = await db.roleplaySession.findMany({
      where: { interpreterId },
      orderBy: { createdAt: 'desc' },
      include: {
        qaScore: { select: { id: true, totalScore: true, criticalError: true, accionRequerida: true } },
      },
    });

    return NextResponse.json({ success: true, data: sessions });
  } catch (error: unknown) {
    console.error('Get My Roleplays Error:', error);
    return NextResponse.json(
      { success: false, error: 'No fue posible recuperar tus roleplays.' },
      { status: 500 }
    );
  }
}