import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { privateAdminJson } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

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
export async function POST(_request: NextRequest) {
  try {
    const { userId, user } = await auth();
    if (!userId || !user) {
      return privateAdminJson(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
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
export async function GET(_request: NextRequest) {
  try {
    const { userId, user } = await auth();
    if (!userId || !user) {
      return privateAdminJson(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
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
