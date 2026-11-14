import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { RecruitmentCandidateSchema } from '@/lib/validators';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth, resolveApiActor } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { isCanonicalStatus } from '@/lib/recruitment/status-display';
import { z } from 'zod';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

function secureAdminRecruitmentResponse(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store');
  const dims = (response.headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const required of ['Authorization', 'Cookie', 'Origin']) {
    if (!dims.some(value => value.toLowerCase() === required.toLowerCase())) dims.push(required);
  }
  response.headers.set('Vary', dims.join(', '));
  return response;
}

function privateAdminJson(body: unknown, init?: ResponseInit): NextResponse {
  return secureAdminRecruitmentResponse(NextResponse.json(body, init));
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, 'GET, POST, OPTIONS') });
}

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return secureAdminRecruitmentResponse(denied);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const limitRaw = searchParams.get('limit');
    const offsetRaw = searchParams.get('offset');

    const querySchema = z.object({
      status: z.string().optional(),
      search: z.string().trim().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    });
    const parsed = querySchema.safeParse({
      status: status ?? undefined,
      search: search ?? undefined,
      limit: limitRaw ?? undefined,
      offset: offsetRaw ?? undefined,
    });
    if (!parsed.success) {
      return privateAdminJson({ success: false, error: 'Invalid query parameters' }, { status: 400, headers: corsHeaders(request) });
    }

    const whereClause: Record<string, unknown> = {};
    if (parsed.data.status) {
      if (!isCanonicalStatus(parsed.data.status)) {
        return privateAdminJson(
          { success: false, error: `Unknown application status: ${parsed.data.status}` },
          { status: 400, headers: corsHeaders(request) }
        );
      }
      whereClause.applications = { some: { status: parsed.data.status } };
    }
    if (parsed.data.search) {
      whereClause.OR = [
        { name: { contains: parsed.data.search, mode: 'insensitive' } },
        { email: { contains: parsed.data.search, mode: 'insensitive' } },
        { telefono: { contains: parsed.data.search, mode: 'insensitive' } },
      ];
    }

    const candidates = await prisma.recruitmentCandidate.findMany({
      where: whereClause,
      orderBy: { fechaPostulacion: 'desc' },
      take: parsed.data.limit,
      skip: parsed.data.offset,
    });

    return privateAdminJson(candidates, { headers: corsHeaders(request) });
  } catch (error) {
    console.error('Error fetching candidates:', safeServerErrorCategory(error));
    return secureAdminRecruitmentResponse(apiError({ error, fallback: 'Unable to fetch candidates', exposeMessage: false }));
  }
}

export async function POST(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return secureAdminRecruitmentResponse(denied);

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

    return privateAdminJson(newCandidate, {
      status: 201,
      headers: corsHeaders(request),
    });
  } catch (error) {
    console.error('Error creating candidate:', safeServerErrorCategory(error));
    const isPrismaError = error && typeof error === 'object' && 'code' in error;
    if (isPrismaError && error.code === 'P2002') {
      return privateAdminJson(
        { success: false, error: 'Candidate with this email already exists.' },
        { status: 409 }
      );
    }
    return secureAdminRecruitmentResponse(apiError({ error, fallback: 'Unable to create candidate', exposeMessage: false }));
  }
}
