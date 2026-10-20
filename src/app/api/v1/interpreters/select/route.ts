import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const interpreters = await prisma.interpreter.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(interpreters);
  } catch (error) {
    console.error('Error fetching interpreters for select:', error);
    return NextResponse.json([], { status: 500 });
  }
}
