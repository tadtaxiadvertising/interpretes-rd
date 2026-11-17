import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { numericIdParamSchema } from '@/lib/api-responses';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

/**
 * Administrative status history contains interpreter identity and activity
 * metadata. Resolve the same principal as the API middleware, honoring an
 * explicit Bearer over a different cookie; never cache or log raw failures.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(req, 'admin');
    if (denied) return privateAdminResponse(denied);

    const parsed = numericIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return privateAdminJson(
        { success: false, error: 'Invalid interpreter ID' },
        { status: 400 },
      );
    }
    const interpreterId = parsed.data.id;
    const limitRaw = new URL(req.url).searchParams.get('limit');
    // Reject NaN, negative values, fractions and 0; do not permit arbitrary
    // count inflation or a malformed limit to reach Prisma.
    if (limitRaw !== null && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limitRaw)) {
      return privateAdminJson(
        { success: false, error: 'Invalid history limit (1-100)' },
        { status: 400 },
      );
    }
    const limit = limitRaw === null ? 20 : Number(limitRaw);

    const interpreter = await prisma.interpreter.findUnique({
      where: { id: interpreterId },
      select: { id: true, name: true, realtimeStatus: true },
    });
    if (!interpreter) {
      return privateAdminJson(
        { success: false, error: 'Interpreter not found' },
        { status: 404 },
      );
    }

    const logs = await prisma.interpreterStatusLog.findMany({
      where: { interpreterId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        previousStatus: true,
        newStatus: true,
        reason: true,
        changedBy: true,
        metadata: true,
        createdAt: true,
      },
    });

    return privateAdminJson({
      success: true,
      interpreter: {
        id: interpreter.id,
        name: interpreter.name,
        currentStatus: interpreter.realtimeStatus,
      },
      logs,
    });
  } catch (error) {
    console.error('[StatusHistory] Error:', safeServerErrorCategory(error));
    return privateAdminJson(
      { success: false, error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
