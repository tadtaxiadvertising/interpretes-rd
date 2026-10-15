import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * DB DIAGNOSTIC ROUTE
 * Only for troubleshooting production connection issues.
 * Returns a list of registered RBAC emails.
 */
export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    // 1. Test connection
    await prisma.$connect();
    
    // 2. Fetch lean list of users
    const users = await prisma.rbacUser.findMany({
      select: {
        email: true,
        role: true,
        name: true,
      }
    });

    return NextResponse.json({
      status: 'success',
      database: 'connected',
      userCount: users.length,
      users: users,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[DB-DIAGNOSTIC] Error:', error);
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown database error',
      error: String(error)
    }, { status: 500 });
  }
}
