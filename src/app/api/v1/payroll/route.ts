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
  const interpreterId = searchParams.get('interpreterId');

  const whereClause: Record<string, unknown> = {};
  if (status) {
    whereClause.status = status;
  }
  if (interpreterId) {
    whereClause.interpreterId = parseInt(interpreterId, 10);
  }

  const records = await prisma.payrollRecord.findMany({
    where: whereClause,
    include: {
      interpreter: {
        select: { name: true, externalId: true, metodoPago: true }
      }
    },
    orderBy: { periodStart: 'desc' },
  });

  return NextResponse.json(records);
}, {
  query: z.object({
    status: z.string().optional(),
    interpreterId: z.string().optional()
  })
});
