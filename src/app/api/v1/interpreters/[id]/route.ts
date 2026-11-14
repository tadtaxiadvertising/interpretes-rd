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
        if (authError) console.warn('Auth user deletion failed:', safeServerErrorCategory(authError));
      } catch (err: unknown) {
        console.warn('Auth user deletion failed:', safeServerErrorCategory(err));
      }
    }

    revalidateInterpreterProfileRecords(interpreterId);
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

      await tx.userProfile.updateMany({
        where: { interpreterId },
        data: {
          displayName: saved.name,
          ...(saved.emailCorporativo ? { email: saved.emailCorporativo } : {}),
        },
      });

      return saved;
    });

    revalidateInterpreterProfileRecords(interpreterId);
    return privateAdminJson({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating interpreter:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({ error, fallback: 'Error updating interpreter', exposeMessage: false }));
  }
}
