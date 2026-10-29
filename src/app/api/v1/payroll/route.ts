import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { withSecurity } from '@/lib/api-security';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { z } from 'zod';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, 'GET, OPTIONS') });
}

export const GET = withSecurity(async (request: NextRequest) => {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const interpreterIdRaw = searchParams.get('interpreterId');
  const limitRaw = searchParams.get('limit');
  const offsetRaw = searchParams.get('offset');

  const querySchema = z.object({
    status: z.string().optional(),
    interpreterId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  });
  const parsed = querySchema.safeParse({
    status: status ?? undefined,
    interpreterId: interpreterIdRaw ?? undefined,
    limit: limitRaw ?? undefined,
    offset: offsetRaw ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid query parameters' }, { status: 400 });
  }

  const whereClause: Record<string, unknown> = {};
  if (parsed.data.status) {
    whereClause.status = parsed.data.status;
  }
  if (parsed.data.interpreterId) {
    whereClause.interpreterId = parsed.data.interpreterId;
  }

  const records = await prisma.payrollRecord.findMany({
    where: whereClause,
    include: {
      interpreter: {
        select: { name: true, externalId: true, metodoPago: true }
      }
    },
    orderBy: { periodStart: 'desc' },
    take: parsed.data.limit,
    skip: parsed.data.offset,
  });

  return NextResponse.json(records);
}, {
  query: z.object({
    status: z.string().optional(),
    interpreterId: z.string().optional(),
    limit: z.string().optional(),
    offset: z.string().optional()
  })
});
