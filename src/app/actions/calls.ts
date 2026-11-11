'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import type { ActionResult } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { CallSession, Prisma } from '@prisma/client';
import { z } from 'zod';

const db = prisma;

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
    console.error('🔴 ERROR [startCall]:', error);
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
      const activeSession = await tx.callSession.findFirst({
        where: { id: sessionId, interpreterId, endedAt: null },
        select: { startedAt: true, tariffSnapshot: true },
      });
      if (!activeSession?.startedAt) {
        throw new Error('Active call session not found or has no start timestamp.');
      }

      const endedAt = new Date();
      const durationSeconds = Math.max(
        0,
        Math.round((endedAt.getTime() - activeSession.startedAt.getTime()) / 1000),
      );
      const tariffSnapshot = Number(activeSession.tariffSnapshot);
      if (!Number.isFinite(tariffSnapshot) || tariffSnapshot < 0) {
        throw new Error('Active call session has an invalid tariff snapshot.');
      }
      const callCost = Math.round((durationSeconds / 60) * tariffSnapshot * 100) / 100;

      // The call, its production aggregate and its settled flag share one
      // transaction. Retries cannot leave a null duration or double-count it.
      const updated = await tx.callSession.update({
        where: { id: sessionId, interpreterId, endedAt: null },
        data: { endedAt, durationSeconds, callCost, isSettled: true },
        select: { durationSeconds: true, callCost: true, startedAt: true }
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

      // Synchronize live call into ProductionLog so it appears in "Production Logs"
      if (updated.durationSeconds && updated.durationSeconds > 0) {
        const getLocalDateStr = (d: Date) => {
          return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Santo_Domingo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(d);
        };
        const dayStr = getLocalDateStr(updated.startedAt || new Date());
        const logDate = new Date(`${dayStr}T12:00:00Z`);
        const minutes = Math.floor(updated.durationSeconds / 60);

        if (minutes > 0) {
          // Check if there's already a log for today
          const existingLog = await tx.productionLog.findFirst({
            where: {
              interpreterId,
              date: logDate
            }
          });

          if (existingLog) {
            await tx.productionLog.update({
              where: { id: existingLog.id },
              data: {
                interpretedMinutes: (existingLog.interpretedMinutes || 0) + minutes,
                callsAttended: (existingLog.callsAttended || 0) + 1,
              }
            });
          } else {
            await tx.productionLog.create({
              data: {
                interpreterId,
                date: logDate,
                interpretedMinutes: minutes,
                callsAttended: 1,
                status: 'Completed',
                observaciones: 'Sincronizado automáticamente (Llamada en vivo)',
                adherence: 100
              }
            });
          }
        }
      }

      return updated;
    });

    revalidateInterpreterProfileRecords(interpreterId);
    return {
      success: true,
      data: {
        durationSeconds: session.durationSeconds ?? 0,
        callCost: Number(session.callCost) ?? 0,
      },
    };
  } catch (error: unknown) {
    console.error('🔴 ERROR [endCall]:', error);
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
    console.error('🔴 ERROR [getActiveCall]:', error);
    return { success: false, error: 'Failed to fetch active call', code: 'INTERNAL_ERROR' };
  }
}

const ManualCallSchema = z.object({
  interpreterId: z.coerce.number(),
  startedAt: z.string().transform(s => new Date(s)),
  durationMinutes: z.coerce.number().positive(),
  notes: z.string().optional()
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
      notes: formData.get('notes'),
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
    const callCost = (durationSeconds / 60) * Number(interpreter.tariffPerMinute);

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

    revalidatePath('/admin/calls');
    return { success: true, data: { id: session.id } };
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid input data', code: 'VALIDATION_ERROR' };
    }
    console.error('🔴 ERROR [addManualCall]:', error);
    return { success: false, error: 'Failed to record manual call', code: 'INTERNAL_ERROR' };
  }
}

