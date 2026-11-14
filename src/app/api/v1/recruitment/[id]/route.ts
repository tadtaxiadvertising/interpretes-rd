import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { RecruitmentCandidatePatchSchema } from '@/lib/api-schemas';
import { apiError, numericIdParamSchema, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const METHODS = 'GET, PATCH, DELETE, OPTIONS';

function privateCandidateResponse(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store');
  const vary = (response.headers.get('Vary') || '').split(',').map(v => v.trim()).filter(Boolean);
  for (const required of ['Authorization', 'Cookie', 'Origin']) {
    if (!vary.some(v => v.toLowerCase() === required.toLowerCase())) vary.push(required);
  }
  response.headers.set('Vary', vary.join(', '));
  return response;
}

function privateCandidateJson(body: unknown, init?: ResponseInit): NextResponse {
  return privateCandidateResponse(NextResponse.json(body, init));
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, METHODS) });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateCandidateResponse(denied);

    const { id } = numericIdParamSchema.parse(await params);

    const candidate = await prisma.recruitmentCandidate.findUnique({
      where: { id },
    });

    if (!candidate) {
      return privateCandidateJson({ success: false, error: 'Candidate not found' }, { status: 404 });
    }

    return privateCandidateJson(candidate, { headers: corsHeaders(request, METHODS) });
  } catch (error) {
    console.error('Error fetching candidate:', safeServerErrorCategory(error));
    return privateCandidateResponse(apiError({ error, fallback: 'Unable to fetch candidate', exposeMessage: false }));
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateCandidateResponse(denied);

    const { id } = numericIdParamSchema.parse(await params);

    const body = await parseJsonBody(request, RecruitmentCandidatePatchSchema);
    
    // Partial validation
    const validationResult = { success: true as const, data: body };
    if (!validationResult.success) {
      return privateCandidateJson(
        { success: false, error: 'Validation failed', details: [] },
        { status: 400 }
      );
    }

    const updatedCandidate = await prisma.recruitmentCandidate.update({
      where: { id },
      data: validationResult.data,
    });

    return privateCandidateJson(updatedCandidate, { headers: corsHeaders(request, METHODS) });
  } catch (error) {
    console.error('Error updating candidate:', safeServerErrorCategory(error));
    const isPrismaError = error && typeof error === 'object' && 'code' in error;
    if (isPrismaError && error.code === 'P2025') {
      return privateCandidateJson({ success: false, error: 'Candidate not found' }, { status: 404 });
    }
    return privateCandidateResponse(apiError({ error, fallback: 'Unable to update candidate', exposeMessage: false }));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateCandidateResponse(denied);

    const { id } = numericIdParamSchema.parse(await params);

    await prisma.recruitmentCandidate.delete({
      where: { id },
    });

    return privateCandidateJson({ success: true, message: 'Candidate deleted successfully' }, {
      headers: corsHeaders(request, METHODS),
    });
  } catch (error) {
    console.error('Error deleting candidate:', safeServerErrorCategory(error));
    const isPrismaError = error && typeof error === 'object' && 'code' in error;
    if (isPrismaError && error.code === 'P2025') {
      return privateCandidateJson({ success: false, error: 'Candidate not found' }, { status: 404 });
    }
    return privateCandidateResponse(apiError({ error, fallback: 'Unable to delete candidate', exposeMessage: false }));
  }
}
