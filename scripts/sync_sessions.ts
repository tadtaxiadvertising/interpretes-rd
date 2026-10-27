import prisma from '@/lib/prisma';

async function main() {
  console.log('--- Iniciando sincronización de CallSessions a ProductionLogs ---');

  // 1. Fetch all CallSessions that have ended and are not from manual admin entries
  const sessions = await prisma.callSession.findMany({
    where: {
      endedAt: { not: null },
      notes: {
        notIn: ['Manual entry via Admin Server Action', 'Manual entry by Administrator']
      }
    }
  });

  console.log(`Se encontraron ${sessions.length} sesiones en vivo completadas.`);

  // 2. Group sessions by interpreter and by local date
  const grouped = new Map<string, number>(); // Key: "interpreterId_YYYY-MM-DD", Value: total minutes
  const callCount = new Map<string, number>(); // Total calls

  const getLocalDateStr = (date: Date): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (type: 'year' | 'month' | 'day') => parts.find(item => item.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    if (!year || !month || !day) throw new Error('Unable to format Santo Domingo date');
    return `${year}-${month}-${day}`;
  };

  for (const session of sessions) {
    if (!session.startedAt || !session.durationSeconds) continue;

    const dayStr = getLocalDateStr(session.startedAt);
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

  // 3. Process each group
  for (const [key, extraMinutes] of grouped.entries()) {
    const [interpreterIdStr, dayStr] = key.split('_');
    const interpreterId = parseInt(interpreterIdStr, 10);
    const calls = callCount.get(key) || 0;

    // Parse the dayStr to a noon UTC date to avoid timezone shift
    const logDate = new Date(`${dayStr}T12:00:00Z`);

    const allLogsForInt = await prisma.productionLog.findMany({
      where: { interpreterId }
    });

    const existingLog = allLogsForInt.find(l => getLocalDateStr(l.date) === dayStr);

    if (existingLog) {
      // Check if it already has "Sincronizado" or similar in observation to prevent double-running the script
      if (existingLog.observaciones?.includes('Sincronizado desde llamadas en vivo')) {
        continue; // Already synced this day
      }

      // Add minutes to the existing log
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
      // Create new log
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

  console.log(`Sincronización completada.`);
  console.log(`Logs creados: ${createdCount}`);
  console.log(`Logs actualizados: ${updatedCount}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
