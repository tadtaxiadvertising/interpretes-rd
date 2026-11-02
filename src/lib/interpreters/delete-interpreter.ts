/**
 * Removes an interpreter account while preserving auditable Roleplay history.
 *
 * Roleplay sessions are retained as historical records. Active sessions are
 * cancelled before their interpreter owner is detached. The database CHECK
 * constraint deliberately permits an unowned historical session after a hard
 * deletion, while still forbidding a session from having two owners.
 */
export async function deleteInterpreterDatabaseRecords(tx: any, interpreterId: number) {
  const interpreter = await tx.interpreter.findUnique({
    where: { id: interpreterId },
    select: {
      id: true,
      userProfile: { select: { id: true } },
    },
  });

  if (!interpreter) {
    throw new Error('Intérprete no encontrado');
  }

  // Do not cascade-delete Roleplay evidence (sessions, scenarios, responses,
  // audio references or QA linkage). Stop any active attempt and retain it.
  const activeRoleplayStatuses = [
    'DRAFT',
    'INVITED',
    'STARTED',
    'IN_PROGRESS',
    'SUBMITTED',
    'UNDER_REVIEW',
  ];

  await tx.roleplaySession.updateMany({
    where: { interpreterId, status: { in: activeRoleplayStatuses } },
    data: {
      interpreterId: null,
      status: 'CANCELLED',
      completedAt: new Date(),
    },
  });

  // Completed/terminal sessions also remain available as unowned historical
  // evidence. This update is safe only with the relaxed XOR CHECK migration.
  await tx.roleplaySession.updateMany({
    where: { interpreterId },
    data: { interpreterId: null },
  });

  await tx.userProfile.deleteMany({ where: { interpreterId } });
  await tx.interpreterAccountRate.deleteMany({ where: { interpreterId } });
  await tx.payrateAuditLog.deleteMany({ where: { interpreterId } });
  await tx.qAScore.deleteMany({ where: { interpreterId } });
  await tx.productionLog.deleteMany({ where: { interpreterId } });
  await tx.callSession.deleteMany({ where: { interpreterId } });
  await tx.payrollRecord.deleteMany({ where: { interpreterId } });

  await tx.interpreter.delete({ where: { id: interpreterId } });

  return {
    authUserId: interpreter.userProfile?.id ?? null,
  };
}
