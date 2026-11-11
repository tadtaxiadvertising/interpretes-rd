import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentActor } from '@/lib/auth/current-actor';

/**
 * POST /api/calls/sync
 * 
 * Syncs orphaned CallSessions (ended but not in ProductionLog) to ProductionLog.
 * This fixes the issue where calls ended but metrics weren't updated.
 * 
 * Can be called:
 * 1. Called by the authenticated interpreter to reconcile their own calls
 * 2. Automatically on dashboard load to catch missed syncs
 * 3. After a call ends as a safety net
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (actor.role !== 'interpreter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!actor.interpreterId) {
      return NextResponse.json({ error: 'Interpreter profile not found' }, { status: 404 });
    }
    const interpreterId = actor.interpreterId;

    // Use Santo Domingo timezone for date calculation
    const getLocalDateStr = (d: Date) => {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santo_Domingo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    };

    // Find all CallSessions that:
    // 1. Have endedAt (not active)
    // 2. Have durationSeconds > 0
    // 3. Are not already settled (not in payroll)
    // 4. Don't have a corresponding ProductionLog entry for their date
    const orphanedSessions = await prisma.callSession.findMany({
      where: {
        interpreterId,
        endedAt: { not: null },
        isSettled: false,
      },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
        tariffSnapshot: true,
      },
      orderBy: {
        startedAt: 'asc',
      },
    });

    const synced: number[] = [];
    const skipped: number[] = [];

    for (const session of orphanedSessions) {
      if (!session.endedAt || !session.startedAt || session.tariffSnapshot === null) {
        // Missing source timestamps or tariff require explicit repair. Never
        // assign an unknown call to today's payroll date or invent its cost.
        skipped.push(session.id);
        continue;
      }

      const durationSeconds = session.durationSeconds && session.durationSeconds > 0
        ? session.durationSeconds
        : Math.max(0, Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 1000));
      const tariffSnapshot = Number(session.tariffSnapshot);
      if (!Number.isFinite(tariffSnapshot) || tariffSnapshot < 0) {
        skipped.push(session.id);
        continue;
      }
      const callCost = Math.round((durationSeconds / 60) * tariffSnapshot * 100) / 100;
      const minutes = Math.floor(durationSeconds / 60);
      if (minutes <= 0) {
        // Sub-minute calls do not contribute production minutes. Mark them
        // settled so the same immutable call is not retried on every request.
        await prisma.callSession.updateMany({
          where: { id: session.id, isSettled: false },
          data: { isSettled: true, durationSeconds, callCost },
        });
        skipped.push(session.id);
        continue;
      }

      const dayStr = getLocalDateStr(session.startedAt);
      const logDate = new Date(`${dayStr}T12:00:00Z`);

      // Claim, aggregate and settle the source call in one transaction. A
      // failed write rolls back the claim, while concurrent requests cannot
      // add the same CallSession minutes twice.
      const wasSynced = await prisma.$transaction(async (tx) => {
        const claim = await tx.callSession.updateMany({
          where: { id: session.id, isSettled: false },
          data: { isSettled: true, durationSeconds, callCost },
        });
        if (claim.count !== 1) return false;

        const existingLog = await tx.productionLog.findFirst({
          where: {
            interpreterId,
            date: logDate,
          },
        });

        if (existingLog) {
          await tx.productionLog.update({
            where: { id: existingLog.id },
            data: {
              interpretedMinutes: (existingLog.interpretedMinutes || 0) + minutes,
              callsAttended: (existingLog.callsAttended || 0) + 1,
            },
          });
        } else {
          await tx.productionLog.create({
            data: {
              interpreterId,
              date: logDate,
              interpretedMinutes: minutes,
              callsAttended: 1,
              status: 'Completed',
              observaciones: 'Synced from orphaned CallSession',
              adherence: 100,
            },
          });
        }

        return true;
      });

      if (wasSynced) synced.push(session.id);
      else skipped.push(session.id);
    }

    return NextResponse.json({
      success: true,
      synced,
      skipped,
      totalSynced: synced.length,
      totalSkipped: skipped.length,
    });
  } catch (error) {
    console.error(' ERROR [/api/calls/sync]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/calls/sync
 * 
 * Returns stats about orphaned sessions without syncing them.
 * Useful for debugging and monitoring.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (actor.role !== 'interpreter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!actor.interpreterId) {
      return NextResponse.json({ error: 'Interpreter profile not found' }, { status: 404 });
    }
    const interpreterId = actor.interpreterId;

    const orphanedCount = await prisma.callSession.count({
      where: {
        interpreterId,
        endedAt: { not: null },
        isSettled: false,
      },
    });

    return NextResponse.json({
      success: true,
      orphanedSessions: orphanedCount,
    });
  } catch (error) {
    console.error('🔴 ERROR [/api/calls/sync GET]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
