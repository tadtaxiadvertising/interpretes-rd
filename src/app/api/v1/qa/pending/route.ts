import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    // In a real scenario, this would filter calls that haven't been audited
    // For now, we fetch the most recent completed calls
    const pendingCalls = await prisma.callSession.findMany({
      where: {
        endedAt: { not: null },
      },
      include: { 
        interpreter: {
          select: { name: true, campaign: true }
        } 
      },
      orderBy: { startedAt: 'desc' },
      take: 5
    });

    return NextResponse.json(pendingCalls, {
      headers: corsHeaders(request),
    });
  } catch (error) {
    console.error('Error fetching pending audits:', error);
    const message = error instanceof Error ? error.message : 'Error fetching pending audits';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
