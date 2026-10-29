import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';

/**
 * Format a Santo_Domingo timestamp (from @db.Timestamptz) to "YYYY-MM-DD".
 * Works correctly for full timestamps with timezone info.
 */
function formatSantoDomingoDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * Format a @db.Date column value to "YYYY-MM-DD".
 * Prisma reads DATE as midnight UTC — toISOString gives the stored date.
 */
function formatDbDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function GET(request: Request) {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return denied;

  console.log('--- Iniciando sincronización de CallSessions a ProductionLogs ---');

  try {
    const sessions = await prisma.callSession.findMany({
      where: {
        endedAt: { not: null },
        notes: {
          notIn: ['Manual entry via Admin Server Action', 'Manual entry by Administrator']
        }
      }
    });

    console.log(`Se encontraron ${sessions.length} sesiones en vivo completadas.`);

    const grouped = new Map<string, number>();
    const callCount = new Map<string, number>();

    for (const session of sessions) {
      if (!session.startedAt || !session.durationSeconds || session.durationSeconds < 0) continue;

      // startedAt is a @db.Timestamptz — timezone-aware formatting is correct
      const dayStr = formatSantoDomingoDate(session.startedAt);
      const key = `${session.interpreterId}_${dayStr}`;
      const minutes = Math.floor(session.durationSeconds / 60);

      if (minutes > 0) {
        const existing = grouped.get(key) || 0;
        grouped.set(key, existing + minutes);

        const existingCalls = callCount.get(key) || 0;
        callCount.set(key, existingCalls + 1);
      }
    }

    let createdCount = 0;
    let updatedCount = 0;

    // Fetch all production logs for affected interpreters in one batch
    const interpreterIds = [...new Set(Array.from(grouped.keys()).map(k => parseInt(k.split('_')[0], 10)))];
    if (interpreterIds.length === 0) {
      return NextResponse.json({ success: true, message: 'Sincronización completada', createdCount: 0, updatedCount: 0 });
    }
    const allLogs = await prisma.productionLog.findMany({
      where: { interpreterId: { in: interpreterIds } }
    });

    // Index logs by interpreterId → date string for fast lookup
    const logsByInt = new Map<number, Map<string, typeof allLogs[number]>>();
    allLogs.forEach(log => {
      if (log.interpreterId == null) return;
      if (!logsByInt.has(log.interpreterId)) {
        logsByInt.set(log.interpreterId, new Map());
      }
      // Use formatDbDate for @db.Date column values
      logsByInt.get(log.interpreterId)!.set(formatDbDate(log.date), log);
    });

    for (const [key, extraMinutes] of grouped.entries()) {
      const [interpreterIdStr, dayStr] = key.split('_');
      const interpreterId = parseInt(interpreterIdStr, 10);
      const calls = callCount.get(key) || 0;

      const logDate = new Date(`${dayStr}T12:00:00Z`);
      const intLogs = logsByInt.get(interpreterId);
      const existingLog = intLogs?.get(dayStr);

      if (existingLog) {
        if (existingLog.observaciones?.includes('Sincronizado desde llamadas en vivo')) {
          continue;
        }

        await prisma.productionLog.update({
          where: { id: existingLog.id },
          data: {
            interpretedMinutes: (existingLog.interpretedMinutes || 0) + extraMinutes,
            callsAttended: (existingLog.callsAttended || 0) + calls,
            observaciones: existingLog.observaciones
              ? `${existingLog.observaciones} | Sincronizado desde llamadas en vivo (+${extraMinutes}m)`
              : `Sincronizado desde llamadas en vivo (+${extraMinutes}m)`
          }
        });
        updatedCount++;
      } else {
        await prisma.productionLog.create({
          data: {
            interpreterId,
            date: logDate,
            interpretedMinutes: extraMinutes,
            callsAttended: calls,
            status: 'Completed',
            observaciones: 'Sincronizado desde llamadas en vivo',
            adherence: 100
          }
        });
        createdCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Sincronización completada',
      createdCount,
      updatedCount
    });
  } catch (error: any) {
    console.error('Error syncing:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
