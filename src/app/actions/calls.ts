'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import type { ActionResult } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { CallSession, Prisma } from '@prisma/client';
import { z } from 'zod';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const db = prisma;

class EndCallFinancialConflict extends Error {}
class EndCallTimingError extends Error {}

/**
 * ACTION: Start Call Session
 */
export async function startCall(): Promise<ActionResult<{ sessionId: number; startedAt: string }>> {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {

    // 1. Get profile and check active calls in a single lean query
    const profile = await db.userProfile.findUnique({
      where: { id: auth.user.userId },
      select: { 
        interpreterId: true,
        interpreter: {
          select: {
            tariffPerMinute: true,
            callSessions: {
              where: { endedAt: null },
              select: { id: true },
              take: 1
            }
          }
        }
      }
    });

    if (!profile?.interpreterId || !profile.interpreter) {
      return { success: false, error: 'Interpreter profile not found', code: 'NOT_FOUND' };
    }

    const { interpreterId, interpreter } = profile;

    if (interpreter.callSessions.length > 0) {
      return { success: false, error: 'A call is already active', code: 'CONFLICT' };
    }

    // 2. Atomic session creation and status update
    const session = await db.$transaction(async (tx) => {
      const newSession = await tx.callSession.create({
        data: {
          interpreterId: interpreterId,
          tariffSnapshot: interpreter.tariffPerMinute,
        },
        select: { id: true, startedAt: true }
      });

      await tx.interpreter.update({
        where: { id: profile.interpreterId! },
        data: {
          realtimeStatus: 'Busy',
          statusReason: 'call_started',
          statusChangedAt: new Date(),
          lastActivity: new Date(),
        },
        select: { id: true }
      });

      await tx.interpreterStatusLog.create({
        data: {
          interpreterId: profile.interpreterId!,
          previousStatus: interpreter.callSessions.length > 0 ? 'Busy' : 'Online',
          newStatus: 'Busy',
          reason: 'call_started',
          changedBy: 'system',
          metadata: { source: 'startCall', sessionId: newSession.id },
        },
      });

      return newSession;
    });

    revalidatePath('/dashboard');
    return {
      success: true,
      data: { 
        sessionId: session.id, 
        startedAt: session.startedAt?.toISOString() ?? new Date().toISOString() 
      },
    };
  } catch (error: unknown) {
    console.error('Call action startCall failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to start call session', code: 'INTERNAL_ERROR' };
  }
}

/**
 * ACTION: End Call Session
 */
export async function endCall(sessionId: number): Promise<ActionResult<{ durationSeconds: number; callCost: number }>> {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const profile = auth.profile;
    if (!profile?.interpreterId) {
      return { success: false, error: 'Unauthorized profile', code: 'UNAUTHORIZED' };
    }

    const { interpreterId } = profile;

    // End session and reset status atomically
    const session = await db.$transaction(async (tx) => {
      // Claim the active session exactly once. Repeated/concurrent endCall
      // requests must never add the same call to ProductionLog more than once.
      const endedAt = new Date();
      const claimed = await tx.callSession.updateMany({
        where: { id: sessionId, interpreterId, endedAt: null },
        data: { endedAt },
      });

      const updated = await tx.callSession.findFirst({
        where: { id: sessionId, interpreterId },
        select: { durationSeconds: true, callCost: true, startedAt: true,
          tariffSnapshot: true, isSettled: true, payrollRecordId: true }
      });

      if (!updated) {
        throw new Error('Call session not found for this interpreter');
      }

      // Another request already ended and accounted for this session.
      if (claimed.count === 0) {
        return updated;
      }

      // When a live call starts, durationSeconds and callCost are still
      // unset. Calculate them at end time from the server timestamps and
      // the rate snapshot saved at call creation (never a later pay rate).
      // All session, production and ledger writes are in one transaction.
      const startMs = updated.startedAt?.getTime();
      const elapsedMs = startMs === undefined ? NaN : endedAt.getTime() - startMs;
      const tariff = Number(updated.tariffSnapshot);
      const durationSeconds = Math.floor(elapsedMs / 1000);
      const callCost = Math.round((durationSeconds / 60) * tariff * 100) / 100;
      if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(elapsedMs) || elapsedMs < 0 ||
        !Number.isSafeInteger(durationSeconds) || durationSeconds > 2_147_483_647 ||
        updated.tariffSnapshot == null || !Number.isFinite(tariff) || tariff < 0 ||
        !Number.isFinite(callCost) || callCost < 0 || callCost > 99_999_999.99
      ) {
        throw new EndCallTimingError();
      }

      // The claim above is part of this transaction and will roll back if
      // accounting is locked; no session or status change may commit alone.
      const getLocalDateStr = (d: Date) => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santo_Domingo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
      const dayStr = getLocalDateStr(updated.startedAt!);
      const logDate = new Date(`${dayStr}T12:00:00Z`);
      const minutes = Math.floor(durationSeconds / 60);
      const callsAttended = minutes > 0 ? 1 : 0;

      const existingLog = await tx.productionLog.findFirst({
        where: { interpreterId, date: logDate },
        select: {
          id: true, isSettled: true, interpretedMinutes: true,
          callsAttended: true, payrollRecordId: true,
        },
      });
      if (updated.isSettled || existingLog?.isSettled) {
        throw new EndCallFinancialConflict();
      }
      const lockedPayroll = await tx.payrollRecord.findFirst({
        where: {
          OR: [
            {
              interpreterId,
              periodStart: { lte: logDate },
              periodEnd: { gte: logDate },
            },
            ...(existingLog?.payrollRecordId
              ? [{ id: existingLog.payrollRecordId }]
              : []),
            ...(updated.payrollRecordId
              ? [{ id: updated.payrollRecordId }]
              : []),
          ],
          AND: [{
            OR: [
              { paidAt: { not: null } },
              { status: { notIn: ['PENDING', 'Pendiente'] } },
              { status: null },
            ],
          }],
        },
        select: { id: true },
      });
      if (lockedPayroll) throw new EndCallFinancialConflict();

      await tx.callSession.update({
        where: { id: sessionId },
        data: { durationSeconds, callCost },
        select: { id: true },
      });

      await tx.interpreter.update({
        where: { id: interpreterId },
        data: {
          realtimeStatus: 'Online',
          statusReason: 'call_ended',
          statusChangedAt: new Date(),
          lastActivity: new Date(),
          lastOnlineAt: new Date(),
        },
        select: { id: true }
      });

      await tx.interpreterStatusLog.create({
        data: {
          interpreterId,
          previousStatus: 'Busy',
          newStatus: 'Online',
          reason: 'call_ended',
          changedBy: 'system',
          metadata: { source: 'endCall', sessionId },
        },
      });

      // Persist a per-session ledger entry in the same transaction as the
      // daily aggregate. The primary key makes one production entry possible
      // per CallSession and provides an auditable source for future reports.
      let productionLogId: number | null = null;
      if (minutes > 0) {
        if (existingLog) {
          // Guard against a settlement between the initial read and the
          // write. Serializable isolation also detects concurrent updates.
          const changed = await tx.productionLog.updateMany({
            where: { id: existingLog.id, isSettled: false },
            data: {
              interpretedMinutes: (existingLog.interpretedMinutes || 0) + minutes,
              callsAttended: (existingLog.callsAttended || 0) + 1,
            },
          });
          if (changed.count !== 1) throw new EndCallFinancialConflict();
          productionLogId = existingLog.id;
        } else {
          const createdLog = await tx.productionLog.create({
            data: {
              interpreterId,
              date: logDate,
              interpretedMinutes: minutes,
              callsAttended: 1,
              status: 'Completed',
              observaciones: 'Sincronizado automáticamente (Llamada en vivo)',
              adherence: 100
            },
            select: { id: true },
          });
          productionLogId = createdLog.id;
        }
      }

      // Insert the ledger only after the aggregate ID is known. This keeps
      // ledger rows append-only while remaining atomic with the daily update.
      await tx.callProductionEntry.create({
        data: {
          callSessionId: sessionId,
          interpreterId,
          productionDate: logDate,
          interpretedMinutes: minutes,
          callsAttended,
          productionLogId,
        },
      });

      return { ...updated, durationSeconds, callCost };
    }, { isolationLevel: 'Serializable' });

    // A committed session is successful even when cache refresh fails; a
    // false failure could cause repeated endCall attempts.
    try {
      revalidateInterpreterProfileRecords(interpreterId);
    } catch (error) {
      console.warn('Call ended; cache refresh failed:', safeServerErrorCategory(error));
    }
    return {
      success: true,
      data: {
        durationSeconds: session.durationSeconds ?? 0,
        callCost: Number(session.callCost) ?? 0,
      },
    };
  } catch (error: unknown) {
    if (error instanceof EndCallTimingError) {
      return { success: false, error: 'Call timing or rate is invalid; contact an administrator.', code: 'CONFLICT' };
    }
    if (error instanceof EndCallFinancialConflict ||
        (error && typeof error === 'object' && 'code' in error && error.code === 'P2034')) {
      return { success: false, error: 'Production or payroll period is locked; contact an administrator.', code: 'CONFLICT' };
    }
    console.error('Call action endCall failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to end call session', code: 'INTERNAL_ERROR' };
  }
}

/**
 * ACTION: Get Active Call
 */
export async function getActiveCall(): Promise<ActionResult<CallSession | null>> {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const profile = auth.profile;
    if (!profile?.interpreterId) return { success: true, data: null };

    const session = await db.callSession.findFirst({
      where: {
        interpreterId: profile.interpreterId,
        endedAt: null
      }
    });

    return { success: true, data: session };
  } catch (error: unknown) {
    console.error('Call action getActiveCall failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to fetch active call', code: 'INTERNAL_ERROR' };
  }
}

const ManualCallSchema = z.object({
  interpreterId: z.coerce.number().int().positive(),
  // datetime-local values omit their timezone. Require a real ISO timestamp
  // with an explicit offset so server and browser cannot disagree about time.
  startedAt: z.string()
    .refine(value =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
      Number.isFinite(Date.parse(value)),
    )
    .transform(value => new Date(value)),
  durationMinutes: z.coerce.number().finite().positive()
    .refine(value => {
      const seconds = Math.round(value * 60);
      return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 2_147_483_647;
    }),
  notes: z.string().max(2_000).optional(),
});

/**
 * ACTION: Add Manual Call Entry (Admin)
 */
export async function addManualCall(formData: FormData): Promise<ActionResult<{ id: number }>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {

    const rawData = {
      interpreterId: formData.get('interpreterId'),
      startedAt: formData.get('startedAt'),
      durationMinutes: formData.get('durationMinutes'),
      // FormData.get() yields null for an absent optional field, not undefined.
      // Preserve the schema's optional contract for submissions without notes.
      notes: formData.get('notes') ?? undefined,
    };

    const validated = ManualCallSchema.parse(rawData);

    const interpreter = await db.interpreter.findUnique({
      where: { id: validated.interpreterId },
      select: { tariffPerMinute: true }
    });

    if (!interpreter) {
      return { success: false, error: 'Interpreter not found', code: 'NOT_FOUND' };
    }

    const durationSeconds = Math.round(validated.durationMinutes * 60);
    const endedAt = new Date(validated.startedAt.getTime() + durationSeconds * 1000);
    const tariff = Number(interpreter.tariffPerMinute);
    const callCost = Math.round((durationSeconds / 60) * tariff * 100) / 100;
    if (!Number.isFinite(endedAt.getTime()) ||
        !Number.isFinite(tariff) || tariff < 0 ||
        !Number.isFinite(callCost) || callCost < 0 || callCost > 99_999_999.99) {
      return { success: false, error: 'Invalid call time or rate', code: 'VALIDATION_ERROR' };
    }

    const session = await db.callSession.create({
      data: {
        interpreterId: validated.interpreterId,
        startedAt: validated.startedAt,
        endedAt,
        durationSeconds,
        tariffSnapshot: interpreter.tariffPerMinute,
        callCost,
        notes: validated.notes || 'Manual entry by Administrator',
      },
      select: { id: true }
    });

    // The insert has committed. A failed cache refresh is not a failed
    // manual call and must not encourage a duplicate administrative entry.
    try {
      revalidatePath('/admin/calls');
    } catch (error) {
      console.warn('Admin manual call saved; cache refresh failed:', safeServerErrorCategory(error));
    }
    return { success: true, data: { id: session.id } };
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid input data', code: 'VALIDATION_ERROR' };
    }
    console.error('Call action addManualCall failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to record manual call', code: 'INTERNAL_ERROR' };
  }
}

