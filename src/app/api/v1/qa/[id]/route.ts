import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { QAScorePatchSchema } from '@/lib/api-schemas';
import { apiError, numericIdParamSchema, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';

const METHODS = 'GET, PATCH, DELETE, OPTIONS';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, METHODS) });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const { id } = numericIdParamSchema.parse(await params);

    const score = await prisma.qAScore.findUnique({
      where: { id },
      include: {
        interpreter: true,
        productionLog: true,
      }
    });

    if (!score) {
      return NextResponse.json({ success: false, error: 'Scorecard not found' }, { status: 404 });
    }

    return NextResponse.json(score, {
      headers: corsHeaders(request, METHODS),
    });
  } catch (error) {
    console.error('Error fetching scorecard:', error);
    const message = error instanceof Error ? error.message : 'Error fetching scorecard';
    return apiError({ error, fallback: message });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const { id } = numericIdParamSchema.parse(await params);

    const body = await parseJsonBody(request, QAScorePatchSchema);
    
    // Rule D: Partial validation
    const validationResult = { success: true as const, data: body };
    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: [] },
        { status: 400 }
      );
    }

    const existingScore = await prisma.qAScore.findUnique({ where: { id } });
    if (!existingScore) {
      return NextResponse.json({ success: false, error: 'Scorecard not found' }, { status: 404 });
    }

    const updateData = { ...validationResult.data };

    // FÓRMULA DE CALIDAD (QA Scorecard) - Re-calculate if components changed
    // Rule C: Safely cast Prisma Decimals to number
    const protocol = Number(updateData.protocolScore ?? existingScore.protocolScore ?? 0);
    const interpretation = Number(updateData.interpretationScore ?? existingScore.interpretationScore ?? 0);
    const language = Number(updateData.languageScore ?? existingScore.languageScore ?? 0);
    const service = Number(updateData.serviceScore ?? existingScore.serviceScore ?? 0);
    const technical = Number(updateData.technicalScore ?? existingScore.technicalScore ?? 0);

    let totalScore = (protocol * 0.20) + 
                     (interpretation * 0.40) + 
                     (language * 0.20) + 
                     (service * 0.10) + 
                     (technical * 0.10);


    // REGLA CRÍTICA DE AUTO-FAIL
    const isCritical = updateData.criticalError ?? existingScore.criticalError;
    if (isCritical === true) {
      totalScore = 0.00;
      updateData.accionRequerida = 'Advertencia';
    }

    updateData.totalScore = Math.round(totalScore * 100) / 100;

    const updatedScore = await prisma.qAScore.update({
      where: { id },
      data: updateData as any,
    });

    return NextResponse.json(updatedScore, {
      headers: corsHeaders(request, METHODS),
    });
  } catch (error) {
    console.error('🔴 QA PATCH ERROR:', error);
    const message = error instanceof Error ? error.message : 'Error updating scorecard';
    return apiError({ error, fallback: message });
  }
}


export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const { id } = numericIdParamSchema.parse(await params);

    await prisma.qAScore.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: 'Scorecard deleted successfully' }, {
      headers: corsHeaders(request, METHODS),
    });
  } catch (error) {
    console.error('Error deleting scorecard:', error);
    const isPrismaError = error && typeof error === 'object' && 'code' in error;
    if (isPrismaError && error.code === 'P2025') {
      return NextResponse.json({ success: false, error: 'Scorecard not found' }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : 'Error deleting scorecard';
    return apiError({ error, fallback: message });
  }
}
