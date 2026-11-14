import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { InterpreterSchema } from '@/lib/validators';
import { withSecurity } from '@/lib/api-security';
import { guardApiAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/api-responses';
import { corsHeaders } from '@/lib/cors';
import { z } from 'zod';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export async function OPTIONS(request: Request) {
  return NextResponse.json(
    {},
    { headers: corsHeaders(request, 'GET, POST, PUT, DELETE, OPTIONS') }
  );
}

export const GET = withSecurity(async (request: NextRequest) => {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return privateAdminResponse(denied);

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
    return privateAdminJson({ success: false, error: 'Invalid query parameters' }, { status: 400 });
  }

  const whereClause: Record<string, unknown> = {};
  if (parsed.data.status) {
    whereClause.status = parsed.data.status;
  }
  if (parsed.data.search) {
    whereClause.OR = [
      { name: { contains: parsed.data.search, mode: 'insensitive' } },
      { externalId: { contains: parsed.data.search, mode: 'insensitive' } },
      { emailCorporativo: { contains: parsed.data.search, mode: 'insensitive' } },
    ];
  }

  const interpreters = await prisma.interpreter.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: parsed.data.limit,
    skip: parsed.data.offset,
  });

  return privateAdminJson(interpreters);
}, {
  query: z.object({
    status: z.string().optional(),
    search: z.string().optional(),
    limit: z.string().optional(),
    offset: z.string().optional()
  })
});

export const POST = withSecurity(async (request: NextRequest) => {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return privateAdminResponse(denied);

  const body = await parseJsonBody(request, InterpreterSchema);
  const { password, ...interpreterData } = body;

  if (password && !interpreterData.emailCorporativo) {
    return privateAdminJson(
      { success: false, error: 'Email corporativo is required when creating an account with a password.' },
      { status: 400 }
    );
  }

  console.info('[API_INTERPRETERS_POST] Creating interpreter record');
  const newInterpreter = await prisma.interpreter.create({
    data: interpreterData as never,
  });
  console.info('[API_INTERPRETERS_POST] Interpreter record created');

  // 2. If password provided, create Auth user and UserProfile
  if (password) {
    console.info('[API_INTERPRETERS_POST] Provisioning Auth user');
    const { upsertConfirmedAuthUser } = await import('@/lib/supabase/auth-users');
    let authUser = null;

    try {
      authUser = await upsertConfirmedAuthUser({
        email: interpreterData.emailCorporativo!,
        password,
        displayName: interpreterData.name,
      });
    } catch (authError) {
      console.error('[API_INTERPRETERS_POST] Auth creation failed:', safeServerErrorCategory(authError));
      return privateAdminJson(
        { success: false, error: 'Interpreter record created, but account provisioning failed. Contact support.', interpreterId: newInterpreter.id },
        { status: 400 }
      );
    }

    if (!authUser) {
      console.error('[API_INTERPRETERS_POST] ❌ Auth creation failed: no user returned');
      return privateAdminJson(
        { success: false, error: 'Interpreter record created, but account provisioning failed. Contact support.', interpreterId: newInterpreter.id },
        { status: 400 }
      );
    }

    console.info('[API_INTERPRETERS_POST] Linking Auth profile');
    try {
      await prisma.userProfile.upsert({
      where: { id: authUser.id },
      update: {
        email: interpreterData.emailCorporativo!,
        displayName: interpreterData.name,
        interpreterId: newInterpreter.id
      },
      create: {
        id: authUser.id,
        email: interpreterData.emailCorporativo!,
        displayName: interpreterData.name,
        role: 'interpreter',
        interpreterId: newInterpreter.id
      }
      });
    } catch (profileError) {
      console.error('[API_INTERPRETERS_POST] Auth profile linking failed:', safeServerErrorCategory(profileError));
      return privateAdminJson(
        {
          success: false,
          error: 'Interpreter and Auth records created, but profile linking failed. Contact support before retrying.',
          interpreterId: newInterpreter.id,
        },
        { status: 500 }
      );
    }
    console.info('[API_INTERPRETERS_POST] UserProfile upserted successfully');
  }

  return privateAdminJson({ success: true, data: newInterpreter }, { status: 201 });
}, {
  body: InterpreterSchema
});
