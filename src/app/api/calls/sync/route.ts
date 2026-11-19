import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { actorFromBearer, type ApiActor } from '@/lib/api-auth';
import { privateAdminJson } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

/**
 * The legacy sync endpoint is cookie-bound. An explicit Authorization header
 * must not silently authorize a different user through that cookie.
 * Verify an explicit bearer before ANY legacy diagnostic reads. This helper
 * does not enable the disabled historical synchronization endpoint.
 */
async function verifyExplicitSyncBearer(
  request: NextRequest,
  cookieUserId: string,
): Promise<{ allowed: boolean; interpreterId: number | null }> {
  if (!request.headers.has('authorization')) {
    return { allowed: true, interpreterId: null };
  }
  let bearer: ApiActor | null = null;
  try {
    bearer = await actorFromBearer(request);
  } catch {
    // If the provider fails, fail closed rather than use cookie fallback.
  }
  if (!bearer || bearer.userId !== cookieUserId ||
      bearer.role !== 'interpreter' || !bearer.interpreterId) {
    return { allowed: false, interpreterId: null };
  }
  return { allowed: true, interpreterId: bearer.interpreterId };
}

/**
 * Do not restore the historical POST synchronization by iterating over
 * CallSession.isSettled = false.
 *
 * A session that has not been payroll-settled is NOT proof that its minutes
 * were omitted from a daily ProductionLog. endCall() already writes the
 * per-call ledger and daily totals atomically; replaying older sessions by
 * adding minutes again can double-count production and payroll.
 *
 * The separate /api/v1/sync route was retired for the same reason.
 * Future reconciliation must be ledger-based, idempotent and reviewed.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, user } = await auth();
    if (!userId || !user) {
      return privateAdminJson(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const credential = await verifyExplicitSyncBearer(request, userId);
    if (!credential.allowed) {
      return privateAdminJson({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Fail before any database read/write; a quick dashboard retry or
    // concurrent requests must never mutate historical financial records.
    return privateAdminJson({
      success: false,
      code: 'LEGACY_CALL_SYNC_PAUSED',
      error: 'La sincronización histórica automática está pausada para evitar duplicar minutos. Solicita una conciliación revisada.',
    }, { status: 409 });
  } catch (error) {
    console.error('Call sync POST failed:', safeServerErrorCategory(error));
    return privateAdminJson(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * Keep a bounded, read-only legacy candidate count for diagnostics.
 * isSettled=false does NOT prove a CallSession lacks a production-ledger row;
 * the count cannot be used for automatic corrections.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, user } = await auth();
    if (!userId || !user) {
      return privateAdminJson(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const credential = await verifyExplicitSyncBearer(request, userId);
    if (!credential.allowed) {
      return privateAdminJson({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const profile = await prisma.userProfile.findUnique({
      where: { id: userId },
      select: { interpreterId: true },
    });
    if (!profile?.interpreterId) {
      return privateAdminJson(
        { success: false, error: 'Interpreter profile not found' },
        { status: 404 },
      );
    }
    // Do not treat the same Auth user ID with an incompatible interpreter
    // assignment as the cookie owner's production records.
    if (credential.interpreterId !== null &&
        credential.interpreterId !== profile.interpreterId) {
      return privateAdminJson({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const orphanedCount = await prisma.callSession.count({
      where: {
        interpreterId: profile.interpreterId,
        endedAt: { not: null },
        durationSeconds: { gt: 0 },
        isSettled: false,
      },
    });

    return privateAdminJson({
      success: true,
      // Backward-compatible field: this is only a candidate count,
      // NOT a verified number of missing production entries.
      orphanedSessions: orphanedCount,
      reconciliationVerified: false,
      synchronizationDisabled: true,
    });
  } catch (error) {
    console.error('Call sync GET failed:', safeServerErrorCategory(error));
    return privateAdminJson(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
