import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';

const MAX_BATCH_SIZE = 500;
const MANUAL_CALL_NOTES = [
  'Manual entry via Admin Server Action',
  'Manual entry by Administrator',
];

/**
 * Format a Timestamptz value to the operational Santo Domingo calendar date.
 */
function formatSantoDomingoDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Admin-only reconciliation of completed live CallSessions.
 *
 * This is intentionally POST-only: it writes production and settlement data.
 * Each source call is claimed and aggregated in one transaction, so retries
 * and concurrent requests cannot count the same call twice.
 */
export async function POST(request: Request) {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return denied;

  try {
    const where = {
      endedAt: { not: null },
      durationSeconds: { gt: 0 },
      isSettled: false,
      notes: { notIn: MANUAL_CALL_NOTES },
    } as const;

    const sessions = await prisma.callSession.findMany({
      where,
      select: {
        id: true,
        interpreterId: true,
        startedAt: true,
        durationSeconds: true,
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      take: MAX_BATCH_SIZE,
    });

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const session of sessions) {
      if (!session.startedAt || !session.durationSeconds || session.durationSeconds < 0) {
        skippedCount++;
        continue;
      }

      const minutes = Math.floor(session.durationSeconds / 60);
      const day = formatSantoDomingoDate(session.startedAt);
      const logDate = new Date(`${day}T12:00:00.000Z`);

      const result = await prisma.$transaction(async (tx) => {
        // Claim first inside the transaction. If the aggregate write fails,
        // the claim rolls back; another request cannot claim the same row.
        const claim = await tx.callSession.updateMany({
          where: { id: session.id, isSettled: false },
          data: { isSettled: true },
        });
        if (claim.count !== 1) return 'skipped' as const;

        // Calls shorter than one full minute do not add payroll minutes, but
        // are settled so the reconciliation does not retry them indefinitely.
        if (minutes <= 0) return 'skipped' as const;

        const existingLog = await tx.productionLog.findFirst({
          where: {
            interpreterId: session.interpreterId,
            date: logDate,
          },
          select: {
            id: true,
            interpretedMinutes: true,
            callsAttended: true,
          },
        });

        if (existingLog) {
          await tx.productionLog.update({
            where: { id: existingLog.id },
            data: {
              interpretedMinutes: (existingLog.interpretedMinutes ?? 0) + minutes,
              callsAttended: (existingLog.callsAttended ?? 0) + 1,
            },
          });
          return 'updated' as const;
        }

        await tx.productionLog.create({
          data: {
            interpreterId: session.interpreterId,
            date: logDate,
            interpretedMinutes: minutes,
            callsAttended: 1,
            status: 'Completed',
            observaciones: 'Synced from live CallSession reconciliation',
            adherence: 100,
          },
        });
        return 'created' as const;
      });

      if (result === 'created') createdCount++;
      else if (result === 'updated') updatedCount++;
      else skippedCount++;
    }

    const remainingCount = await prisma.callSession.count({ where });

    return NextResponse.json({
      success: true,
      processedCount: sessions.length,
      createdCount,
      updatedCount,
      skippedCount,
      remainingCount,
      hasMore: remainingCount > 0,
      batchSize: MAX_BATCH_SIZE,
    });
  } catch (error) {
    console.error(
      'CallSession reconciliation failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return NextResponse.json(
      { success: false, error: 'Unable to reconcile production sessions' },
      { status: 500 },
    );
  }
}
