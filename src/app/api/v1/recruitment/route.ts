import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { RecruitmentCandidateSchema } from '@/lib/validators';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth, resolveApiActor } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { isCanonicalStatus } from '@/lib/recruitment/status-display';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, 'GET, POST, OPTIONS') });
}

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const whereClause: Record<string, unknown> = {};
    if (status) {
      // Filters on the canonical application status. Invalid values are
      // rejected up front instead of surfacing as a Prisma enum error.
      if (!isCanonicalStatus(status)) {
        return NextResponse.json(
          { success: false, error: `Unknown application status: ${status}` },
          { status: 400, headers: corsHeaders(request) }
        );
      }
      whereClause.applications = { some: { status } };
    }
    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { telefono: { contains: search, mode: 'insensitive' } },
      ];
    }

    const candidates = await prisma.recruitmentCandidate.findMany({
      where: whereClause,
      orderBy: { fechaPostulacion: 'desc' },
    });

    return NextResponse.json(candidates, { headers: corsHeaders(request) });
  } catch (error) {
    console.error('Error fetching candidates:', error);
    const message = error instanceof Error ? error.message : 'Error fetching candidates';
    return apiError({ error, fallback: message });
  }
}

export async function POST(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const data = await parseJsonBody(request, RecruitmentCandidateSchema);
    // The guard already proved the caller is an admin; resolve the actor for
    // the audit trail (best-effort, never blocks the write).
    const actor = await resolveApiActor(request).catch(() => null);

    // Admin registration ("New Application") must produce the same persisted
    // shape as the public funnel: candidate + APPLIED application + event.
    const newCandidate = await prisma.$transaction(async (tx) => {
      const candidate = await tx.recruitmentCandidate.create({ data });
      const application = await tx.recruitmentApplication.create({
        data: {
          candidateId: candidate.id,
          status: 'APPLIED',
          currentStep: 'APPLICATION',
          lastActivityAt: new Date(),
        },
        select: { id: true },
      });
      await tx.recruitmentEvent.create({
        data: {
          applicationId: application.id,
          eventType: 'APPLICATION_CREATED',
          toStatus: 'APPLIED',
          actorType: 'admin',
          actorId: actor?.userId ?? 'admin',
          metadata: { source: 'Admin Portal' },
        },
      });
      return candidate;
    });

    return NextResponse.json(newCandidate, {
      status: 201,
      headers: corsHeaders(request),
    });
  } catch (error) {
    console.error('Error creating candidate:', error);
    const isPrismaError = error && typeof error === 'object' && 'code' in error;
    if (isPrismaError && error.code === 'P2002') {
      return NextResponse.json(
        { success: false, error: 'Candidate with this email already exists.' },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : 'Error creating candidate';
    return apiError({ error, fallback: message });
  }
}
