import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { QAScoreSchema } from '@/lib/validators';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { z } from 'zod';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { normalizeQaV1Points, qaV1StoredTotalMatches } from '@/lib/qa-v1-score-contract';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, 'GET, POST, OPTIONS') });
}

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { searchParams } = new URL(request.url);
    const interpreterIdRaw = searchParams.get('interpreterId');
    const auditor = searchParams.get('auditor');
    const limitRaw = searchParams.get('limit');
    const offsetRaw = searchParams.get('offset');

    const querySchema = z.object({
      interpreterId: z.coerce.number().int().positive().optional(),
      auditor: z.string().trim().min(1).max(200).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    });
    const parsed = querySchema.safeParse({
      interpreterId: interpreterIdRaw ?? undefined,
      auditor: auditor ?? undefined,
      limit: limitRaw ?? undefined,
      offset: offsetRaw ?? undefined,
    });
    if (!parsed.success) {
      return privateAdminJson({ success: false, error: 'Invalid query parameters' }, { status: 400, headers: corsHeaders(request) });
    }

    const whereClause: Record<string, unknown> = {};
    if (parsed.data.interpreterId) {
      whereClause.interpreterId = parsed.data.interpreterId;
    }
    if (parsed.data.auditor) {
      whereClause.auditor = { contains: parsed.data.auditor, mode: 'insensitive' };
    }

    const scores = await prisma.qAScore.findMany({
      where: whereClause,
      include: {
        interpreter: {
          select: { name: true, externalId: true }
        }
      },
      orderBy: { auditDate: 'desc' },
      take: parsed.data.limit,
      skip: parsed.data.offset,
    });

    return privateAdminJson(scores, {
      headers: corsHeaders(request),
    });
  } catch (error) {
    console.error('Error fetching QA scores:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({ error, fallback: 'Unable to fetch QA scores', exposeMessage: false }));
  }
}

class QaLogContractError extends Error {
  constructor(public readonly status: 404 | 422) {
    super('Invalid QA production log');
  }
}

export async function POST(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const data = { ...(await parseJsonBody(request, QAScoreSchema)) };

    // The legacy v1 request uses ALREADY-WEIGHTED point caps 20/40/20/10/10.
    // The DB and canonical QA actions store dimension percentages from 0 to 100.
    // Convert once before persistence; do not multiply points by their weight again.
    const calculated = normalizeQaV1Points(data, data.criticalError);
    if (data.criticalError) data.accionRequerida = 'Advertencia';

    const newScore = await prisma.$transaction(async (tx) => {
      // Reject a QA score linked to another interpreter's production log.
      // Keep this check in the same transaction as INSERT.
      const log = await tx.productionLog.findUnique({
        where: { id: data.productionLogId },
        select: { id: true, interpreterId: true },
      });
      if (!log) throw new QaLogContractError(404);
      if (log.interpreterId !== data.interpreterId) throw new QaLogContractError(422);

      const created = await tx.qAScore.create({
        data: {
          ...data,
          ...calculated.dimensions,
          totalScore: calculated.totalScore,
        },
      });

      // AFTER INSERT triggers can update the score after INSERT RETURNING.
      // Read the final row inside the transaction before publishing a result.
      const stored = await tx.qAScore.findUnique({ where: { id: created.id } });
      if (!stored || !qaV1StoredTotalMatches(stored.totalScore, calculated.totalScore)) {
        throw new Error('QA database score contract mismatch');
      }
      return stored;
    });

    return privateAdminJson(newScore, {
      status: 201,
      headers: corsHeaders(request),
    });
  } catch (error) {
    if (error instanceof QaLogContractError) {
      return privateAdminJson(
        { success: false, error: error.status === 404 ? 'Production log not found' : 'Production log does not belong to the selected interpreter' },
        { status: error.status, headers: corsHeaders(request) },
      );
    }
    // The DB enforces one QAScore per ProductionLog. Concurrent submissions
    // cannot both win; expose the unique-constraint race as a safe conflict,
    // never as a generic server failure or an automatic overwrite.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return privateAdminJson(
        { success: false, code: 'QA_ALREADY_RECORDED', error: 'This production log already has a QA evaluation. Refresh before submitting again.' },
        { status: 409, headers: corsHeaders(request) },
      );
    }
    console.error('QA API ERROR:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({ error, fallback: 'Unable to create QA score', exposeMessage: false }));
  }
}
