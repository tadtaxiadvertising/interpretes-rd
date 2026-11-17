import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';

/**
 * Backward-compatible retirement signal. This endpoint historically lists
 * completed calls, NOT unaudited QA records. Preserve its old payload only
 * for callers that have not migrated; point them to the accurate, paginated
 * ProductionLog endpoint without silently changing response shape.
 */
function legacyPendingHeaders(request: Request): Headers {
  const headers = new Headers(corsHeaders(request));
  headers.set('Deprecation', 'true');
  headers.set('Link', '</api/v1/qa/pending-production>; rel="alternate"');
  headers.set('X-QA-Data-Semantics', 'recent-completed-calls-not-audited-pending');
  return headers;
}

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    // In a real scenario, this would filter calls that haven't been audited
    // For now, we fetch the most recent completed calls
    const pendingCalls = await prisma.callSession.findMany({
      where: {
        endedAt: { not: null },
      },
      include: { 
        interpreter: {
          select: { name: true, campaign: true }
        } 
      },
      orderBy: { startedAt: 'desc' },
      take: 5
    });

    return privateAdminJson(pendingCalls, {
      headers: legacyPendingHeaders(request),
    });
  } catch (error) {
    console.error('Error fetching pending audits:', safeServerErrorCategory(error));
    return privateAdminJson({ error: 'Error fetching pending audits' }, { status: 500, headers: legacyPendingHeaders(request) });
  }
}
