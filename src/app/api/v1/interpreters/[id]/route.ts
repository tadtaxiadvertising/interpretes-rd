import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { deleteInterpreterDatabaseRecords, InterpreterNotFoundError, InterpreterHasHistoricalRecordsError } from '@/lib/interpreters/delete-interpreter';
import { InterpreterPatchSchema } from '@/lib/api-schemas';
import { apiError, numericIdParamSchema, parseJsonBody } from '@/lib/api-responses';
import { privateAdminResponse, privateAdminJson } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id: interpreterId } = numericIdParamSchema.parse(await params);

    // Fail closed before modifying PostgreSQL when the Auth admin client cannot
    // initialize. This is a configuration preflight, not an Auth network probe.
    try {
      const { supabaseAdmin } = await import('@/lib/supabase/admin');
      void supabaseAdmin.auth;
    } catch (adminError: unknown) {
      console.warn('Supabase Admin initialization failed:', safeServerErrorCategory(adminError));
      return privateAdminJson(
        { success: false, error: 'Authentication administration is unavailable. No interpreter records were deleted.' },
        { status: 503 }
      );
    }

    const { authUserId } = await prisma.$transaction((tx: any) => deleteInterpreterDatabaseRecords(tx, interpreterId));

    if (authUserId) {
      try {
        const { supabaseAdmin } = await import('@/lib/supabase/admin');
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
        if (authError) {
          console.warn('Auth user revocation unconfirmed:', safeServerErrorCategory(authError));
          return privateAdminJson({
            success: false,
            code: 'AUTH_REVOCATION_UNCONFIRMED',
            error: 'Local interpreter records were deleted, but Auth revocation could not be confirmed. Do not repeat deletion; request an administrator review.',
          }, { status: 409 });
        }
      } catch (err: unknown) {
        // The provider may have completed the operation before its response
        // was lost. A repeat delete cannot resolve that uncertainty.
        console.warn('Auth user revocation status unknown:', safeServerErrorCategory(err));
        return privateAdminJson({
          success: false,
          code: 'AUTH_REVOCATION_UNCONFIRMED',
          error: 'Local interpreter records were deleted, but Auth revocation could not be confirmed. Do not repeat deletion; request an administrator review.',
        }, { status: 409 });
      }
    }

    // This runs after database commit and external Auth processing.
    // It cannot turn a completed deletion into an apparent failure.
    try {
      revalidateInterpreterProfileRecords(interpreterId);
    } catch (cacheError) {
      console.warn('Interpreter deletion cache refresh failed:', safeServerErrorCategory(cacheError));
    }
    return privateAdminJson({ success: true });

  } catch (error) {
    // Only a typed missing-record error is idempotent; provider messages are not.
    if (error instanceof InterpreterNotFoundError) {
      return privateAdminJson({ success: true });
    }
    if (error instanceof InterpreterHasHistoricalRecordsError) {
      return privateAdminJson(
        { success: false, error: 'Cannot delete an interpreter with historical records. Deactivate the account instead.' },
        { status: 409 }
      );
    }
    console.error('Error deleting interpreter:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({ error, fallback: 'Error deleting interpreter', exposeMessage: false }));
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id: interpreterId } = numericIdParamSchema.parse(await params);
    const body = await parseJsonBody(request, InterpreterPatchSchema);
    const { password, ...updateData } = body;

    // An empty PATCH should not bump updatedAt or write a UserProfile.
    if (!password && Object.keys(updateData).length === 0) {
      return privateAdminJson(
        { success: false, error: 'At least one field must be provided.' },
        { status: 400 }
      );
    }

    // 1. If password provided, update Supabase Auth
    if (password) {
      const interpreter = await prisma.interpreter.findUnique({
        where: { id: interpreterId },
        include: { userProfile: true }
      });

      if (!interpreter) {
        return privateAdminJson(
          { success: false, error: 'Interpreter not found.' },
          { status: 404 }
        );
      }
      const { userProfile, ...interpreterRecord } = interpreter;
      if (!userProfile) {
        return privateAdminJson(
          { success: false, error: 'Cannot change password without a linked authentication account. Contact support.' },
          { status: 409 }
        );
      }
      const { supabaseAdmin, ADMIN_UNAVAILABLE_MESSAGE, isAdminUnavailableError } = await import('@/lib/supabase/admin');
      try {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
          userProfile.id,
          { password, email_confirm: true }
        );
        if (authError) throw authError;
      } catch (err: unknown) {
        if (isAdminUnavailableError(err)) {
          return privateAdminJson(
            { success: false, error: ADMIN_UNAVAILABLE_MESSAGE },
            { status: 503 }
          );
        }
        throw err;
      }

      // A password-only operation is complete once Supabase Auth succeeds.
      // Avoid a no-op PostgreSQL transaction that could fail after the password
      // was changed, reporting a false failure to the administrator.
      if (Object.keys(updateData).length === 0) {
        return privateAdminJson({ success: true, data: interpreterRecord });
      }
    }

    // 2. Persist both PostgreSQL updates atomically. A failed profile write
    // must roll back the interpreter update instead of leaving inconsistent data.
    // Supabase Auth updates above remain external to this DB transaction.
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.interpreter.update({
        where: { id: interpreterId },
        data: updateData,
      });

      // Sync only profile fields explicitly edited in this PATCH. Previously,
      // any operational update could overwrite an unchanged profile email with
      // the interpreter's corporate email, even if those addresses intentionally
      // differed or had not yet completed Auth email verification.
      const profileUpdates: { displayName?: string; email?: string } = {};
      if (updateData.name !== undefined) {
        profileUpdates.displayName = saved.name;
      }
      if (typeof updateData.emailCorporativo === 'string') {
        profileUpdates.email = updateData.emailCorporativo;
      }

      if (Object.keys(profileUpdates).length > 0) {
        await tx.userProfile.updateMany({
          where: { interpreterId },
          data: profileUpdates,
        });
      }

      return saved;
    });

    revalidateInterpreterProfileRecords(interpreterId);
    return privateAdminJson({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating interpreter:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({ error, fallback: 'Error updating interpreter', exposeMessage: false }));
  }
}
