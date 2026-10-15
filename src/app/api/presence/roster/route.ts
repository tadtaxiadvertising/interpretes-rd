import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await guardApiAuth(req, 'admin');
  if (denied) return denied;

  try {
    const interpreters = await prisma.interpreter.findMany({
      select: {
        id: true,
        name: true,
        externalId: true,
        realtimeStatus: true,
        statusReason: true,
        lastHeartbeat: true,
        statusChangedAt: true,
        lastActivity: true,
        lastOnlineAt: true,
        lastOfflineAt: true,
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(
      { interpreters },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (error) {
    console.error('[presence/roster] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch roster' },
      { status: 500 }
    );
  }
}
