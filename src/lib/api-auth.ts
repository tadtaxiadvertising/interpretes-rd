import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import prisma from '@/lib/prisma';
import { resolveUserRoleByEmail } from '@/lib/admin-identity';
import { getCurrentActor, type CurrentActor } from '@/lib/auth/current-actor';
import type { UserRole } from '@/lib/types';

/**
 * API AUTHENTICATION / AUTHORIZATION LAYER
 * ============================================================
 * Implements the documented contract (docs/API_SPEC.md,
 * docs/ARCHITECTURE.md): every API request must be authenticated by a
 * verified Supabase `Authorization: Bearer <token>` OR an existing
 * authenticated session cookie (the browser UI uses cookies).
 *
 * Authentication only proves *who* the caller is. Per-route authorization
 * (role / ownership) must still be enforced explicitly via `role` or by the
 * route handler itself.
 * ============================================================
 */

export type ApiActor = {
  userId: string;
  email: string | null;
  role: UserRole;
  interpreterId: number | null;
  profileId: string | null;
};

export class ApiAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiAuthError';
  }
}

function getSupabaseAnonConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  return { url, key };
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token || null;
}

async function actorFromSupabaseUser(user: {
  id: string;
  email?: string | null;
}): Promise<ApiActor | null> {
  const userId = user.id;
  const email = user.email?.toLowerCase().trim() || null;
  if (!email) return null;

  const profile = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { id: true, role: true, interpreterId: true, email: true },
  });

  let role: UserRole = 'interpreter';
  let interpreterId: number | null = profile?.interpreterId ?? null;

  if (profile) {
    role = resolveUserRoleByEmail(profile.email, profile.role);
    interpreterId = role === 'admin' ? null : (profile.interpreterId ?? null);
  } else {
    role = resolveUserRoleByEmail(email, 'interpreter');
  }

  if (role !== 'admin' && !interpreterId) {
    const interpreter = await prisma.interpreter.findFirst({
      where: { emailCorporativo: email },
      select: { id: true },
    });
    interpreterId = interpreter?.id ?? null;
  }

  return {
    userId,
    email,
    role,
    interpreterId,
    profileId: profile?.id ?? null,
  };
}

/**
 * Verify a Supabase access token (Bearer) and resolve the application actor.
 * Uses the public anon key + `auth.getUser(jwt)` so it never needs the
 * service-role key. Returns null for any missing / invalid / expired token.
 */
export async function actorFromBearer(req: Request): Promise<ApiActor | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const { url, key } = getSupabaseAnonConfig();
  if (!url || !key) return null;

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return await actorFromSupabaseUser(data.user);
  } catch {
    return null;
  }
}

function actorFromCurrentActor(actor: CurrentActor): ApiActor {
  return {
    userId: actor.userId,
    email: actor.email,
    role: actor.role,
    interpreterId: actor.interpreterId,
    profileId: actor.profileId,
  };
}

/**
 * Resolve the caller: a verified Bearer token takes precedence, then the
 * authenticated session cookie (Supabase or Auth.js). Returns null when the
 * request is anonymous or the credential cannot be verified.
 */
export async function resolveApiActor(req: Request): Promise<ApiActor | null> {
  const bearerActor = await actorFromBearer(req);
  if (bearerActor) return bearerActor;

  try {
    const actor = await getCurrentActor();
    if (actor) return actorFromCurrentActor(actor);
  } catch {
    // No usable cookie session.
  }
  return null;
}

/**
 * Throw-safe guard for route handlers. Returns the authenticated actor or
 * throws `ApiAuthError` (401 when unauthenticated, 403 when the role is not
 * allowed). Wrap with `withApiAuth` to convert the error into a JSON response.
 */
export async function requireApiActor(
  req: Request,
  role?: UserRole | UserRole[]
): Promise<ApiActor> {
  const actor = await resolveApiActor(req);
  if (!actor) {
    throw new ApiAuthError(401, 'UNAUTHORIZED', 'Unauthorized');
  }
  if (role) {
    const allowed = Array.isArray(role) ? role : [role];
    if (!allowed.includes(actor.role)) {
      throw new ApiAuthError(403, 'FORBIDDEN', 'Forbidden');
    }
  }
  return actor;
}

type RouteHandler = (req: NextRequest, context: unknown) => Promise<NextResponse>;

/**
 * Non-throwing guard. Returns `null` when the request is authorized, or a
 * ready-to-return 401/403 JSON response when it is not. Use for a concise
 * inline guard at the top of an existing handler.
 */
export async function guardApiAuth(
  req: Request,
  role?: UserRole | UserRole[]
): Promise<NextResponse | null> {
  try {
    await requireApiActor(req, role);
    return null;
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    throw error;
  }
}

/**
 * Wrap an App Router handler with authentication (and optional role) checks.
 * Preserves the original handler signature, including dynamic `params` context.
 */
export function withApiAuth(
  handler: RouteHandler,
  options?: { role?: UserRole | UserRole[] }
): RouteHandler {
  return async (req: NextRequest, context: unknown): Promise<NextResponse> => {
    try {
      const actor = await requireApiActor(req, options?.role);
      (req as NextRequest & { actor?: ApiActor }).actor = actor;
      return await handler(req, context);
    } catch (error) {
      if (error instanceof ApiAuthError) {
        return NextResponse.json(
          { success: false, error: error.message, code: error.code },
          { status: error.status }
        );
      }
      throw error;
    }
  };
}
