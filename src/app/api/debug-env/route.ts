import { NextResponse } from 'next/server';
import { guardApiAuth } from '@/lib/api-auth';

export async function GET(request: Request) {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return denied;

  return NextResponse.json({
    databaseUrl: process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@') || 'MISSING',
    nodeEnv: process.env.NODE_ENV,
  });
}
