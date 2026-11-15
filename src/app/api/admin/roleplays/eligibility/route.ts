import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { blockingAssignmentStatuses, interpreterAssignmentBatchScope } from '@/lib/roleplay-assignment-ownership';

/**
 * Advisory, read-only preview for a mass assignment. POST remains the
 * authoritative gate: counts can change between preview and submission.
 */
export async function GET(req: Request) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) {
      return privateRoleplayResponse(
        { success: false, error: auth.error },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    // Edge verifies an explicit Bearer independently of the browser cookie.
    // Reject identity confusion before querying interpreter assignments.
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
        return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const interpreters = await prisma.interpreter.findMany({
      where: { status: 'Activo' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (interpreters.length === 0) {
      return privateRoleplayResponse(
        { success: true, data: { activeCount: 0, eligibleCount: 0, skippedCount: 0 } },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const existing = await prisma.roleplaySession.findMany({
      where: {
        ...interpreterAssignmentBatchScope(interpreters.map((interpreter) => interpreter.id)),
        status: { in: blockingAssignmentStatuses(true) },
      },
      select: { interpreterId: true },
    });
    const blockedIds = new Set(
      existing.map((session) => session.interpreterId).filter((id): id is number => id !== null),
    );
    const skippedCount = interpreters.filter((interpreter) => blockedIds.has(interpreter.id)).length;

    return privateRoleplayResponse(
      {
        success: true,
        data: {
          activeCount: interpreters.length,
          eligibleCount: interpreters.length - skippedCount,
          skippedCount,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Get Roleplay Eligibility Error:', safeServerErrorCategory(error));
    return privateRoleplayResponse(
      { success: false, error: 'No fue posible calcular la elegibilidad de intérpretes.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
