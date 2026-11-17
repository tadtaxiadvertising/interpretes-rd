import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

// Additive API. The historical /api/v1/qa/pending endpoint returns recent
// CallSession rows and cannot establish whether a call was audited: QAScore
// links to ProductionLog instead. Do not silently change that old contract.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_DB_ID = 2_147_483_647;

function positiveId(raw: string | null): number | null {
  if (raw === null || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= MAX_DB_ID ? value : null;
}

function readCursor(raw: string | null): { date: Date; id: number } | null {
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2}):([1-9]\d*)$/.exec(raw);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) return null;
  const id = positiveId(match[2]);
  return id === null ? null : { date, id };
}

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const params = new URL(request.url).searchParams;
    const rawLimit = params.get('limit');
    const limit = rawLimit === null ? DEFAULT_LIMIT : positiveId(rawLimit);
    const rawInterpreterId = params.get('interpreterId');
    const interpreterId = rawInterpreterId === null ? null : positiveId(rawInterpreterId);
    const rawCursor = params.get('cursor');
    const cursor = rawCursor === null ? null : readCursor(rawCursor);
    if (limit === null || limit > MAX_LIMIT ||
        (rawInterpreterId !== null && interpreterId === null) ||
        (rawCursor !== null && cursor === null)) {
      return privateAdminJson(
        { success: false, error: 'Invalid pagination or interpreter filter' },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    // Keyset pagination uses (date DESC, id DESC). Unlike an offset, new
    // entries at the top do not cause previously shown rows to be repeated.
    // Audit linkage and eligibility are still re-evaluated on every page.
    const where: Prisma.ProductionLogWhereInput = {
      interpreterId: interpreterId ?? { not: null },
      qaScore: { is: null },
      ...(cursor ? {
        OR: [
          { date: { lt: cursor.date } },
          { date: cursor.date, id: { lt: cursor.id } },
        ],
      } : {}),
    };
    const rows = await prisma.productionLog.findMany({
      where,
      select: { id: true, interpreterId: true, date: true, status: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? `${last.date.toISOString().slice(0, 10)}:${last.id}`
      : null;

    return privateAdminJson({
      success: true,
      data: page.map(row => ({
        id: row.id,
        interpreterId: row.interpreterId,
        date: row.date.toISOString().slice(0, 10),
        status: row.status,
      })),
      nextCursor,
      hasMore,
    }, { headers: corsHeaders(request) });
  } catch (error) {
    console.error('Error fetching unreviewed production logs:', safeServerErrorCategory(error));
    return privateAdminJson(
      { success: false, error: 'Unable to fetch unreviewed production logs' },
      { status: 500, headers: corsHeaders(request) },
    );
  }
}
