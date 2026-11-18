import { NextResponse } from 'next/server';
import { resolveApiActor } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { ManualCallSchema } from '@/lib/api-schemas';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { getDayBounds } from '@/lib/interpreter-metrics';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

/**
 * Format a Timestamptz value to a Santo Domingo date string.
 * Used to determine which ProductionLog day a call belongs to.
 */
function formatSantoDomingoDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

class QuickLogConflictError extends Error {}

export async function POST(req: Request) {
  try {
    // Resolve the caller from the explicit Bearer token when supplied;
    // otherwise use the verified browser cookie identity. Never authorize
    // a different cookie identity after middleware accepted a Bearer token.
    const actor = await resolveApiActor(req);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, {
        status: 401, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (actor.role !== 'interpreter' || !actor.interpreterId) {
      return NextResponse.json({ success: false, error: 'Interpreter access required' }, {
        status: 403, headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const interpreter = await prisma.interpreter.findUnique({
      where: { id: actor.interpreterId }
    });

    if (!interpreter) {
      return NextResponse.json({ success: false, error: 'Interpreter profile not found' }, { status: 404 });
    }

    const { durationMinutes, seconds } = await parseJsonBody(req, ManualCallSchema);
    const totalSeconds = Math.round((durationMinutes * 60) + seconds);
    const tariffSnapshot = Number(interpreter.tariffPerMinute);
    const callCost = (totalSeconds / 60) * tariffSnapshot;
    const startedAt = new Date(Date.now() - totalSeconds * 1000);

    const callSession = await prisma.$transaction(async (tx) => {
      // 1. Create the call session
      const session = await tx.callSession.create({
        data: {
          interpreterId: interpreter.id,
          startedAt,
          endedAt: new Date(),
          durationSeconds: totalSeconds,
          tariffSnapshot: tariffSnapshot,
          callCost: callCost,
          notes: 'Manual entry via Quick Log'
        }
      });

      // 2. Sync into ProductionLog and the per-call ledger atomically.
      // The ledger is the durable accounting provenance for this session.
      // Sub-minute calls have a zero-minute ledger row and no daily log.
      const minutes = Math.floor(totalSeconds / 60);
      const dayStr = formatSantoDomingoDate(startedAt);
      const logDate = new Date(dayStr + 'T12:00:00Z');
      let productionLogId: number | null = null;

      const { startOfDay, endOfDay } = getDayBounds(startedAt);
      const existingLog = await tx.productionLog.findFirst({
        where: {
          interpreterId: interpreter.id,
          date: { gte: startOfDay, lte: endOfDay },
        },
        select: {
          id: true, isSettled: true, interpretedMinutes: true,
          callsAttended: true, payrollRecordId: true,
        },
      });

      // Do not alter financially finalized periods, even when isSettled is
      // false and payment has not yet been sent. Check the linked payroll
      // as well as any record covering the operational call date.
      const lockedPayroll = await tx.payrollRecord.findFirst({
        where: {
          OR: [
            {
              interpreterId: interpreter.id,
              periodStart: { lte: logDate },
              periodEnd: { gte: logDate },
            },
            ...(existingLog?.payrollRecordId
              ? [{ id: existingLog.payrollRecordId }]
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
      if (lockedPayroll || existingLog?.isSettled) {
        throw new QuickLogConflictError();
      }

      if (minutes > 0) {
        if (existingLog) {
          // Never silently amend settled production. Conditional write refuses
          // settlement even if it happens after the initial read.
          if (existingLog.isSettled) throw new QuickLogConflictError();
          const updated = await tx.productionLog.updateMany({
            where: { id: existingLog.id, isSettled: false },
            data: {
              interpretedMinutes: (existingLog.interpretedMinutes ?? 0) + minutes,
              callsAttended: (existingLog.callsAttended ?? 0) + 1,
            },
          });
          if (updated.count !== 1) throw new QuickLogConflictError();
          productionLogId = existingLog.id;
        } else {
          const created = await tx.productionLog.create({
            data: {
              interpreterId: interpreter.id,
              date: logDate,
              interpretedMinutes: minutes,
              callsAttended: 1,
              status: 'Completed',
              observaciones: 'Sincronizado automáticamente (Llamada manual Quick Log)',
              adherence: 100,
            },
            select: { id: true },
          });
          productionLogId = created.id;
        }
      }

      // An INSERT failure here rolls back CallSession and ProductionLog.
      // The callSessionId primary key prevents duplicate ledger rows for
      // one session, but not two different HTTP submissions.
      await tx.callProductionEntry.create({
        data: {
          callSessionId: session.id,
          interpreterId: interpreter.id,
          productionDate: logDate,
          interpretedMinutes: minutes,
          callsAttended: minutes > 0 ? 1 : 0,
          productionLogId,
        },
      });

      return session;
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json({ success: true, data: callSession }, {
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' },
    });
  } catch (error) {
    if (error instanceof QuickLogConflictError ||
        (error && typeof error === 'object' && 'code' in error && error.code === 'P2034')) {
      return NextResponse.json({ success: false, error: 'Production changed or is settled; reload and retry' }, {
        status: 409, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    console.error('Error creating manual call log:', safeServerErrorCategory(error));
    return apiError({ error, fallback: 'Internal Server Error', exposeMessage: false });
  }
}
