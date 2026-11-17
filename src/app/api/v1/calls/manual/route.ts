import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/actions';
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

export async function POST(req: Request) {
  try {
    const userData = await getCurrentUser();
    if (!userData || !userData.profile || !userData.profile.interpreterId) {
      return NextResponse.json({ success: false, error: 'Unauthorized or no interpreter profile' }, { status: 401 });
    }

    const interpreter = await prisma.interpreter.findUnique({
      where: { id: userData.profile.interpreterId }
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

      // 2. Sync into ProductionLog so it counts toward goals and payroll
      const minutes = Math.floor(totalSeconds / 60);
      if (minutes > 0) {
        const { startOfDay, endOfDay } = getDayBounds(startedAt);

        const existingLog = await tx.productionLog.findFirst({
          where: {
            interpreterId: interpreter.id,
            date: { gte: startOfDay, lte: endOfDay },
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
          const dayStr = formatSantoDomingoDate(startedAt);
          const logDate = new Date(`${dayStr}T12:00:00Z`);
          await tx.productionLog.create({
            data: {
              interpreterId: interpreter.id,
              date: logDate,
              interpretedMinutes: minutes,
              callsAttended: 1,
              status: 'Completed',
              observaciones: 'Sincronizado automáticamente (Llamada manual Quick Log)',
              adherence: 100,
            },
          });
        }
      }

      return session;
    });

    return NextResponse.json({ success: true, data: callSession });
  } catch (error) {
    console.error('Error creating manual call log:', safeServerErrorCategory(error));
    return apiError({ error, fallback: 'Internal Server Error', exposeMessage: false });
  }
}
