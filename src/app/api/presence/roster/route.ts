import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await guardApiAuth(req, 'admin');
  if (denied) return privateAdminResponse(denied);

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

    return privateAdminJson({ interpreters });
  } catch (error) {
    // Prisma errors may include connection strings or interpreter data.
    console.error('[presence/roster] Error:', safeServerErrorCategory(error));
    return privateAdminJson(
      { error: 'Failed to fetch roster' },
      { status: 500 },
    );
  }
}
