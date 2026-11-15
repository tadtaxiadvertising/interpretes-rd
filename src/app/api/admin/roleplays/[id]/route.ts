import { NextRequest } from 'next/server';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { actorFromBearer } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';

const db = prisma;

/**
 * Admin cancel action for a roleplay session.
 *
 * Cancelling is the documented escape hatch of the create-or-resume invariant
 * enforced by `POST /api/admin/roleplays`: a participant with a live or
 * already-evaluated session returns 409 there, and an explicit cancel (or an
 * admin-rejected candidate) frees the slot for a new attempt.
 *
 * Idempotent: cancelling an already CANCELLED session returns the same result.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
    // Edge verifies an explicit Supabase Bearer, but validateAction resolves
    // the browser cookie. Never allow those two credentials to authorize
    // different people when cancelling an existing participant's attempt.
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
        return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const { id } = await params;
    if (!id || !id.trim()) {
      return privateRoleplayResponse({ success: false, error: 'Missing session ID' }, { status: 400 });
    }

    const session = await db.roleplaySession.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!session) {
      return privateRoleplayResponse({ success: false, error: 'Session not found' }, { status: 404 });
    }

    if (session.status === 'CANCELLED') {
      // Idempotent retry: already in the target state.
      return privateRoleplayResponse({ success: true, data: { sessionId: session.id, status: 'CANCELLED' } });
    }

    if (session.status === 'EXPIRED') {
      return privateRoleplayResponse(
        { success: false, error: 'Session has expired and cannot be cancelled' },
        { status: 409 }
      );
    }

    // Compare-and-set avoids cancelling a session that changed status after
    // the initial read (e.g. a concurrent evaluation or expiry).
    const updated = await db.roleplaySession.updateMany({
      where: { id, status: session.status },
      data: { status: 'CANCELLED' },
    });
    if (updated.count !== 1) {
      return privateRoleplayResponse(
        { success: false, error: 'Session changed during cancellation; reload and retry' },
        { status: 409 }
      );
    }

    return privateRoleplayResponse({ success: true, data: { sessionId: id, status: 'CANCELLED' } });
  } catch (error: unknown) {
    // Database errors can contain connection strings, tokens or private paths.
    // Log a fixed classification rather than an exception message or object.
    console.error('Cancel Roleplay API Error:', error instanceof Error ? 'Error' : 'UnknownError');
    return privateRoleplayResponse({ success: false, error: 'Failed to cancel roleplay' }, { status: 500 });
  }
}
