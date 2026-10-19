import { NextRequest, NextResponse } from 'next/server';
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
    if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: 403 });

    const { id } = await params;
    if (!id || !id.trim()) {
      return NextResponse.json({ success: false, error: 'Missing session ID' }, { status: 400 });
    }

    const session = await db.roleplaySession.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    if (session.status === 'CANCELLED') {
      // Idempotent retry: already in the target state.
      return NextResponse.json({ success: true, data: { sessionId: session.id, status: 'CANCELLED' } });
    }

    if (session.status === 'EXPIRED') {
      return NextResponse.json(
        { success: false, error: 'Session has expired and cannot be cancelled' },
        { status: 409 }
      );
    }

    const updated = await db.roleplaySession.update({
      where: { id },
      data: { status: 'CANCELLED' },
      select: { id: true, status: true },
    });

    return NextResponse.json({ success: true, data: { sessionId: updated.id, status: updated.status } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Cancel Roleplay API Error:', message);
    return NextResponse.json({ success: false, error: 'Failed to cancel roleplay' }, { status: 500 });
  }
}
