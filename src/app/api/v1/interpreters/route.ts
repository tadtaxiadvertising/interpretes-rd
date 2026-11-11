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

  // Create the Auth identity first. If this fails, no orphan interpreter
  // record is written to PostgreSQL.
  let authUser: { id: string } | null = null;
  if (password) {
    try {
      const { upsertConfirmedAuthUser } = await import('@/lib/supabase/auth-users');
      authUser = await upsertConfirmedAuthUser({
        email: interpreterData.emailCorporativo!,
        password,
        displayName: interpreterData.name,
      });
      if (!authUser) {
        return NextResponse.json(
          { success: false, error: 'No se pudo crear la identidad de autenticación.' },
          { status: 503 }
        );
      }
    } catch (authError) {
      console.error(
        '[API_INTERPRETERS_POST] Auth creation failed:',
        authError instanceof Error ? authError.message : 'Unknown auth error',
      );
      return NextResponse.json(
        { success: false, error: 'No se pudo crear la identidad de autenticación.' },
        { status: 400 }
      );
    }
  }

  let newInterpreter: Awaited<ReturnType<typeof prisma.interpreter.create>>;
  try {
    // Keep the interpreter and its profile atomic. A failed profile write
    // rolls back the interpreter row instead of leaving an unusable account.
    newInterpreter = await prisma.$transaction(async (tx) => {
      const interpreter = await tx.interpreter.create({
        data: interpreterData as never,
      });

      if (authUser) {
        await tx.userProfile.upsert({
          where: { id: authUser.id },
          update: {
            email: interpreterData.emailCorporativo!,
            displayName: interpreterData.name,
            interpreterId: interpreter.id,
          },
          create: {
            id: authUser.id,
            email: interpreterData.emailCorporativo!,
            displayName: interpreterData.name,
            role: 'interpreter',
            interpreterId: interpreter.id,
          },
        });
      }

      return interpreter;
    });
  } catch (databaseError) {
    // upsertConfirmedAuthUser rejects existing identities, so authUser is
    // guaranteed to be newly created by this request and safe to compensate.
    if (authUser) {
      try {
        const { supabaseAdmin } = await import('@/lib/supabase/admin');
        const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
        if (cleanupError) {
          console.error(
            '[API_INTERPRETERS_POST] Auth compensation failed for identity:',
            authUser.id,
            cleanupError.message,
          );
        }
      } catch (cleanupError) {
        console.error(
          '[API_INTERPRETERS_POST] Auth compensation could not run for identity:',
          authUser.id,
          cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error',
        );
      }
    }

    console.error(
      '[API_INTERPRETERS_POST] Database transaction failed:',
      databaseError instanceof Error ? databaseError.message : 'Unknown database error',
    );
    return NextResponse.json(
      { success: false, error: 'No se pudo crear el intérprete. No se guardaron cambios parciales.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, data: newInterpreter }, { status: 201 });
}, {
  body: InterpreterSchema
});
