import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { InterpreterSchema } from '@/lib/validators';
import { withSecurity } from '@/lib/api-security';
import { guardApiAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/api-responses';
import { corsHeaders } from '@/lib/cors';
import { z } from 'zod';

export async function OPTIONS(request: Request) {
  return NextResponse.json(
    {},
    { headers: corsHeaders(request, 'GET, POST, PUT, DELETE, OPTIONS') }
  );
}

export const GET = withSecurity(async (request: NextRequest) => {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return denied;

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
    return NextResponse.json({ success: false, error: 'Invalid query parameters' }, { status: 400 });
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

  return NextResponse.json(interpreters);
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
  if (denied) return denied;

  const body = await parseJsonBody(request, InterpreterSchema);
  const { password, ...interpreterData } = body;

  if (password && !interpreterData.emailCorporativo) {
    return NextResponse.json(
      { success: false, error: 'Email corporativo is required when creating an account with a password.' },
      { status: 400 }
    );
  }

  console.log(`[API_INTERPRETERS_POST] Step 1: Creating interpreter record for ${interpreterData.emailCorporativo}`);
  const newInterpreter = await prisma.interpreter.create({
    data: interpreterData as never,
  });
  console.log(`[API_INTERPRETERS_POST] Interpreter created with ID: ${newInterpreter.id}`);

  // 2. If password provided, create Auth user and UserProfile
  if (password) {
    console.log(`[API_INTERPRETERS_POST] Step 2: Creating Auth user for ${interpreterData.emailCorporativo}`);
    const { upsertConfirmedAuthUser } = await import('@/lib/supabase/auth-users');
    let authUser = null;

    try {
      authUser = await upsertConfirmedAuthUser({
        email: interpreterData.emailCorporativo!,
        password,
        displayName: interpreterData.name,
      });
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : 'Unknown auth error';
      console.error(`[API_INTERPRETERS_POST] ❌ Auth creation failed: ${message}`);
      return NextResponse.json(
        { success: false, error: `Interpreter record created (ID: ${newInterpreter.id}), but Auth creation failed: ${message}` },
        { status: 400 }
      );
    }

    if (!authUser) {
      console.error('[API_INTERPRETERS_POST] ❌ Auth creation failed: no user returned');
      return NextResponse.json(
        { success: false, error: `Interpreter record created (ID: ${newInterpreter.id}), but Auth creation failed.` },
        { status: 400 }
      );
    }

    console.log(`[API_INTERPRETERS_POST] Step 3: Upserting UserProfile for Auth ID: ${authUser.id}`);
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
    console.log('[API_INTERPRETERS_POST] ✅ UserProfile upserted successfully');
  }

  return NextResponse.json({ success: true, data: newInterpreter }, { status: 201 });
}, {
  body: InterpreterSchema
});
