import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { RecruitmentCandidateSchema } from '@/lib/validators';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
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
      whereClause.status = status;
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

    return NextResponse.json(candidates, {
      headers: {
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      },
    });
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
    const newCandidate = await prisma.recruitmentCandidate.create({
      data,
    });

    return NextResponse.json(newCandidate, { 
      status: 201,
      headers: {
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      },
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
