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

  // Probe Auth BEFORE creating a local interpreter. The existing user
  // lookup inside upsertConfirmedAuthUser otherwise rejects an already-used
  // email only AFTER the local record has been committed. A matching email
  // must never be used to link, reset or overwrite an existing Auth identity.
  // This read-only preflight is not a cross-provider transaction: a concurrent
  // Auth registration can still happen after it; such failures remain partial.
  if (password) {
    try {
      const { supabaseAdmin } = await import('@/lib/supabase/admin');
      const { findAuthUserByEmail } = await import('@/lib/supabase/auth-users');
      void supabaseAdmin.auth;
      const existingAuthUser = await findAuthUserByEmail(
        supabaseAdmin,
        interpreterData.emailCorporativo!,
      );
      if (existingAuthUser) {
        return privateAdminJson({
          success: false,
          code: 'AUTH_ACCOUNT_ALREADY_EXISTS',
          error: 'An authentication account already uses this corporate email. Review the existing identity before creating an interpreter.',
        }, { status: 409 });
      }
    } catch (adminError) {
      // Failure to inspect the Auth directory must not cause a local orphan.
      // Report a generic response without logging provider error details.
      console.warn('[API_INTERPRETERS_POST] Auth admin preflight failed:', safeServerErrorCategory(adminError));
      return privateAdminJson(
        { success: false, error: 'Authentication administration is unavailable. No interpreter was created.' },
        { status: 503 }
      );
    }
  }

  // A retry after a partial Auth provisioning failure must not silently
  // create another interpreter. Check natural identifiers without returning
  // matched PII or assuming an existing record is safe to overwrite.
  // This is best-effort: the database's unique constraints still protect
  // exact-key races; case-variant concurrent inserts need a future schema
  // rollout with an audited case-insensitive uniqueness constraint.
  const existingInterpreter = await prisma.interpreter.findFirst({
    where: {
      OR: [
        { externalId: { equals: interpreterData.externalId, mode: 'insensitive' } },
        ...(interpreterData.emailCorporativo
          ? [{ emailCorporativo: {
              equals: interpreterData.emailCorporativo, mode: 'insensitive' as const,
            } }]
          : []),
      ],
    },
    select: { id: true },
  });
  if (existingInterpreter) {
    return privateAdminJson({
      success: false,
      code: 'INTERPRETER_ALREADY_EXISTS',
      error: 'An interpreter with this identifier or corporate email already exists. Review the existing record before retrying.',
    }, { status: 409 });
  }

  console.info('[API_INTERPRETERS_POST] Creating interpreter record');
  let newInterpreter: Awaited<ReturnType<typeof prisma.interpreter.create>>;
  try {
    newInterpreter = await prisma.interpreter.create({
      data: interpreterData as never,
    });
  } catch (error) {
    // The DB remains authoritative for concurrent submissions with exact
    // unique keys. Never resume or redo external Auth provisioning on P2002.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return privateAdminJson({
        success: false,
        code: 'INTERPRETER_ALREADY_EXISTS',
        error: 'An interpreter with this identifier or corporate email already exists. Review the existing record before retrying.',
      }, { status: 409 });
    }
    throw error;
  }
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
