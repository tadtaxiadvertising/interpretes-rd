/**
 * TAD Anomaly Detector - CRON job
 * 
 * Detecta autom�ticamente:
 *   1. Int�rpretes Offline > 30 min en horario laboral
 *   2. Int�rpretes Busy sin llamada activa (auto-remedia  Online)
 *   3. Int�rpretes Away > 2 horas
 *   4. M�ltiples offline simult�neos (>50% de la flota)
 *   5. Heartbeats stale > 3 min (auto-correcci�n a Offline)
 * 
 * Ejecutar: npx tsx scripts/detect-anomalies.ts
 * Programar en EasyPanel CRON: cada 5 minutos
 */

import prisma from '@/lib/prisma';

const db = prisma;

async function main() {
  console.log(`?? [Anomaly Detector] ${new Date().toISOString()}`);
  console.log('�'.repeat(50));

  const now = new Date();

  // �� Working hours check (Santo Domingo Time) ��
  const sd = new Date(now.toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' }));
  const isWorkingHours = sd.getDay() >= 1 && sd.getDay() <= 5 && sd.getHours() >= 8 && sd.getHours() < 18;
  console.log(`?? Santo Domingo: ${sd.toLocaleString('es-DO')} | Working hours: ${isWorkingHours}`);

  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const staleHeartbeatAgo = new Date(now.getTime() - 3 * 60 * 1000); // 3 min sin heartbeat

  let offlineFixed = 0;
  let busyFixed = 0;
  let staleFixed = 0;
  let alertsCreated = 0;

  if (isWorkingHours) {
    // 1. Offline > 30 min
    const offlineInterpreters = await db.interpreter.findMany({
      where: {
        realtimeStatus: 'Offline',
        statusChangedAt: { lt: thirtyMinAgo },
        status: 'Activo',
      },
      select: { id: true, name: true, externalId: true, lastOfflineAt: true },
    });

    for (const interp of offlineInterpreters) {
      const existing = await db.notification.findFirst({
        where: { title: { contains: interp.name }, type: 'critical', isRead: false },
      });
      if (!existing) {
        await db.notification.create({
          data: {
            title: `?? ${interp.name} offline prolongado`,
            message: `${interp.name} (${interp.externalId}) lleva m�s de 30 min offline.`,
            type: 'critical',
            category: 'status',
            link: '/admin/monitoring',
          },
        });
        alertsCreated++;
        console.log(`  ?? ${interp.name} - offline > 30min  alerta creada`);
      }
    }
    offlineFixed = offlineInterpreters.length;

    // 2. Busy sin llamada activa (auto-remediation)
    const busyInterpreters = await db.interpreter.findMany({
      where: { realtimeStatus: 'Busy', status: 'Activo' },
      select: {
        id: true,
        name: true,
        externalId: true,
        callSessions: { where: { endedAt: null }, select: { id: true }, take: 1 },
      },
    });

    for (const interp of busyInterpreters) {
      if (interp.callSessions.length === 0) {
        await db.$transaction([
          db.interpreter.update({
            where: { id: interp.id },
            data: { realtimeStatus: 'Online', statusReason: 'auto_remediated', statusChangedAt: now, lastActivity: now },
          }),
          db.interpreterStatusLog.create({
            data: {
              interpreterId: interp.id,
              previousStatus: 'Busy',
              newStatus: 'Online',
              reason: 'auto_remediated',
              changedBy: 'system',
              metadata: { source: 'anomaly_detector', autoFix: true },
            },
          }),
          db.notification.create({
            data: {
              title: `?? ${interp.name} estado corregido`,
              message: `${interp.name} (${interp.externalId}) estaba Busy sin llamada activa  corregido a Online.`,
              type: 'warning',
              category: 'status',
              link: '/admin/monitoring',
            },
          }),
        ]);
        busyFixed++;
        console.log(`  ?? ${interp.name} - Busy sin llamada  auto-corregido a Online`);
      }
    }
    busyFixed = busyInterpreters.length;

    // 2b. Stale heartbeat detection: Online/Away/Busy interpreters without heartbeat for > 3 min
    // This catches browser crashes, network loss, or tab kills without beforeunload firing
    const staleHeartbeatInterpreters = await db.interpreter.findMany({
      where: {
        realtimeStatus: { in: ['Online', 'Away', 'Busy'] },
        status: 'Activo',
        lastHeartbeat: { lt: staleHeartbeatAgo },
      },
      select: { id: true, name: true, externalId: true, realtimeStatus: true, lastHeartbeat: true },
    });

    let staleFixed = 0;
    for (const interp of staleHeartbeatInterpreters) {
      await db.$transaction([
        db.interpreter.update({
          where: { id: interp.id },
          data: { realtimeStatus: 'Offline', statusReason: 'stale_heartbeat', statusChangedAt: now, lastOfflineAt: now, lastActivity: now, browserTabId: null },
        }),
        db.interpreterStatusLog.create({
          data: {
            interpreterId: interp.id,
            previousStatus: interp.realtimeStatus,
            newStatus: 'Offline',
            reason: 'stale_heartbeat',
            changedBy: 'system',
            metadata: { source: 'anomaly_detector', lastHeartbeat: interp.lastHeartbeat?.toISOString(), autoFix: true },
          },
        }),
        db.notification.create({
          data: {
            title: `?? ${interp.name} heartbeat perdido`,
            message: `${interp.name} (${interp.externalId}) sin heartbeat por ${Math.round((now.getTime() - new Date(interp.lastHeartbeat!).getTime()) / 60000)} min  corregido a Offline.`,
            type: 'warning',
            category: 'status',
            link: '/admin/monitoring',
          },
        }),
      ]);
      staleFixed++;
      console.log(`  ?? ${interp.name} - stale heartbeat (${interp.realtimeStatus})  auto-corregido a Offline`);
    }
  }

  // 3. Away > 2 hours
  const awayInterpreters = await db.interpreter.findMany({
    where: { realtimeStatus: 'Away', statusChangedAt: { lt: twoHoursAgo }, status: 'Activo' },
    select: { id: true, name: true, externalId: true },
  });

  for (const interp of awayInterpreters) {
    const existing = await db.notification.findFirst({
      where: { title: { contains: interp.name }, type: 'warning', isRead: false },
    });
    if (!existing) {
      await db.notification.create({
        data: {
          title: `?? ${interp.name} ausente +2h`,
          message: `${interp.name} (${interp.externalId}) est� Ausente hace m�s de 2 horas.`,
          type: 'warning',
          category: 'status',
          link: '/admin/monitoring',
        },
      });
      alertsCreated++;
      console.log(`  ?? ${interp.name} - Away > 2h  alerta creada`);
    }
  }

  // 4. Concurrent offline (>50%)
  const totalActive = await db.interpreter.count({ where: { status: 'Activo' } });
  const totalOffline = await db.interpreter.count({ where: { realtimeStatus: 'Offline', status: 'Activo' } });

  if (totalOffline > Math.floor(totalActive * 0.5) && totalOffline >= 5) {
    const existing = await db.notification.findFirst({
      where: { title: '?? M�ltiples int�rpretes offline', isRead: false },
    });
    if (!existing) {
      await db.notification.create({
        data: {
          title: '?? M�ltiples int�rpretes offline',
          message: `${totalOffline} de ${totalActive} int�rpretes offline (${Math.round((totalOffline / totalActive) * 100)}%). Posible problema de conectividad.`,
          type: 'critical',
          category: 'fleet',
          link: '/admin/monitoring',
        },
      });
      alertsCreated++;
      console.log(`  ?? ${totalOffline}/${totalActive} offline - alerta de flota creada`);
    }
  }

  // Summary
  console.log('�'.repeat(50));
  console.log(`?? Resumen:`);
  console.log(`  Offline >30min: ${offlineFixed}`);
  console.log(`  Busy auto-fix:  ${busyFixed}`);
  console.log(`  Stale heartbeat: ${staleFixed}`);
  console.log(`  Away >2h:       ${awayInterpreters.length}`);
  console.log(`  Alertas nuevas: ${alertsCreated}`);
  console.log(`  Flota: ${totalOffline}/${totalActive} offline`);
  console.log('? Anomaly detection complete');
}

main()
  .catch((err) => {
    console.error('?? [Anomaly Detector] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());