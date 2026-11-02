import type { User } from '@supabase/supabase-js';
import {
  supabaseAdmin,
  isAdminUnavailableError,
} from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

type SupabaseAdminClient = SupabaseClient;

/**
 * Repair an existing auth user — NEVER creates a new one.
 * Updates an already-authenticated credential after a separate local RBAC password check.
 * It never deletes or recreates an identity. Null/empty identities require manual repair.
 */
export async function repairAuthUser(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<User | null> {
  try {
    const email = normalizeAuthEmail(params.email);
    const existingUser = await findAuthUserByEmail(supabaseAdmin, email);

    // User must already exist in Supabase Auth — no auto-creation
    if (!existingUser) {
      console.log(`[AUTH-USERS] repairAuthUser: user ${email} does not exist — no repair possible`);
      return null;
    }

    const userMetadata = {
      ...(existingUser?.user_metadata ?? {}),
      display_name: params.displayName,
    };

    // Missing identities require an audited Supabase-side repair. Never delete/recreate
    // an account during login: the UUID may be referenced by profiles and business data.
    if (!existingUser.identities || existingUser.identities.length === 0) {
      throw new Error(
        'La cuenta de autenticación requiere reparación administrativa. No se modificó ni eliminó el usuario.'
      );
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      existingUser.id,
      {
        password: params.password,
        email_confirm: true,
        user_metadata: userMetadata,
      }
    );

    if (error) throw error;
    return data.user;
  } catch (error: unknown) {
    if (isAdminUnavailableError(error)) {
      throw error;
    }
    throw error;
  }
}

export function normalizeAuthEmail(email: string) {
  return email.toLowerCase().trim();
}

export async function findAuthUserByEmail(
  supabaseAdmin: SupabaseAdminClient,
  email: string
): Promise<User | null> {
  const normalizedEmail = normalizeAuthEmail(email);
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) throw error;

    const authUser = data.users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail
    );

    if (authUser) return authUser;
    if (!data.nextPage || data.users.length === 0) return null;

    page = data.nextPage;
  }
}

/**
 * Confirm an existing Supabase Auth user's email.
 */
export async function confirmAuthUserEmail(email: string): Promise<User | null> {
  try {
    const existingUser = await findAuthUserByEmail(supabaseAdmin, email);

    if (!existingUser) return null;
    if (existingUser.email_confirmed_at) return existingUser;

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      existingUser.id,
      { email_confirm: true }
    );

    if (error) throw error;
    return data.user;
  } catch (error: unknown) {
    if (isAdminUnavailableError(error)) {
      throw error;
    }
    throw error;
  }
}

/**
 * Invite a recruitment applicant into Supabase Auth without asking them to
 * create an interpreter account or choosing a password before the application.
 * Existing Auth identities are returned unchanged; this function never resets
 * credentials or deletes/recreates a user.
 */
export async function inviteCandidateAuthUser(params: {
  email: string;
  displayName: string;
  redirectTo: string;
}): Promise<{ user: User; invited: boolean }> {
  const email = normalizeAuthEmail(params.email);
  const existingUser = await findAuthUserByEmail(supabaseAdmin, email);
  if (existingUser) return { user: existingUser, invited: false };

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: params.displayName, account_type: 'candidate' },
    redirectTo: params.redirectTo,
  });

  if (error) {
    // Handle the race where a parallel submission/invite created the user.
    const racedUser = await findAuthUserByEmail(supabaseAdmin, email).catch(() => null);
    if (racedUser) return { user: racedUser, invited: false };
    throw error;
  }
  if (!data.user) throw new Error('Supabase did not return the invited applicant identity.');
  return { user: data.user, invited: true };
}

/**
 * Create a new Supabase Auth user with a confirmed email.
 * Existing accounts are rejected so a public registration request cannot reset
 * an existing user's password. Account recovery belongs in a verified recovery flow.
 * Malformed identities are preserved for an audited administrative repair.
 */
export async function upsertConfirmedAuthUser(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<User | null> {
  try {
    const email = normalizeAuthEmail(params.email);
    const existingUser = await findAuthUserByEmail(supabaseAdmin, email);
    const userMetadata = {
      ...(existingUser?.user_metadata ?? {}),
      display_name: params.displayName,
    };

    // Public registration must never reset an existing account's password.
    // Existing users must use login or the dedicated, verified password-recovery flow.
    if (existingUser) {
      throw new Error(
        'An account with this email already exists. Sign in or use password recovery instead.'
      );
    }

    // ── NEW USER ──────────────────────────────────────────────
    // Only reachable when exisingUser is null — creates a brand new auth user.
    // This is INTENTIONAL for admin flows; login repair uses repairAuthUser().
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: params.password,
      email_confirm: true,
      user_metadata: userMetadata,
    });

    if (error) throw error;
    return data.user;
  } catch (error: unknown) {
    if (isAdminUnavailableError(error)) {
      throw error;
    }
    throw error;
  }
}