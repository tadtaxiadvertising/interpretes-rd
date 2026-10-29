import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { QAScoreSchema } from '@/lib/validators';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { z } from 'zod';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, 'GET, POST, OPTIONS') });
}

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

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
      return NextResponse.json({ success: false, error: 'Invalid query parameters' }, { status: 400, headers: corsHeaders(request) });
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

    return NextResponse.json(scores, {
      headers: corsHeaders(request),
    });
  } catch (error) {
    console.error('Error fetching QA scores:', error);
    const message = error instanceof Error ? error.message : 'Error fetching QA scores';
    return apiError({ error, fallback: message });
  }
}

export async function POST(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const data = { ...(await parseJsonBody(request, QAScoreSchema)) };

    // FÓRMULA DE CALIDAD (QA Scorecard)
    // Total Score = (Protocol * 0.20) + (Interpretación * 0.40) + (Idioma * 0.20) + (Servicio * 0.10) + (Técnico * 0.10)
    const protocol = data.protocolScore || 0;
    const interpretation = data.interpretationScore || 0;
    const language = data.languageScore || 0;
    const service = data.serviceScore || 0;
    const technical = data.technicalScore || 0;

    let totalScore = (protocol * 0.20) + 
                     (interpretation * 0.40) + 
                     (language * 0.20) + 
                     (service * 0.10) + 
                     (technical * 0.10);

    // REGLA CRÍTICA DE AUTO-FAIL
    // Si criticalError === true, el totalScore se fuerza a 0.00 y accionRequerida a "Advertencia"
    if (data.criticalError === true) {
      totalScore = 0.00;
      data.accionRequerida = 'Advertencia';
    }

    data.totalScore = Math.round(totalScore * 100) / 100;

    const newScore = await prisma.qAScore.create({
      data: data,
    });

    return NextResponse.json(newScore, { 
      status: 201,
      headers: corsHeaders(request),
    });
  } catch (error) {
    console.error('🔴 QA API ERROR:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return apiError({ error, fallback: message });
  }
}

