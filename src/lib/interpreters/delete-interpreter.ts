/** A missing interpreter is an expected, idempotent deletion outcome. */
export class InterpreterNotFoundError extends Error {
  constructor() {
    super('Intérprete no encontrado');
    this.name = 'InterpreterNotFoundError';
  }
}

/**
 * An interpreter with historical or audit-linked records cannot be hard-deleted.
 * The administrator must use a separately reviewed retention/deactivation flow.
 */
export class InterpreterHasHistoricalRecordsError extends Error {
  constructor() {
    super('Interpreter has historical records and cannot be deleted');
    this.name = 'InterpreterHasHistoricalRecordsError';
  }
}

/** A possible Auth.js/RBAC login requires a reviewed cross-provider identity resolution. */
export class InterpreterLegacyIdentityReviewRequiredError extends Error {
  constructor() {
    super('Interpreter may still have an independent legacy login');
    this.name = 'InterpreterLegacyIdentityReviewRequiredError';
  }
}

/** The legacy login directory must be readable before destructive operations. */
export class InterpreterLegacyIdentityCheckUnavailableError extends Error {
  constructor() {
    super('Legacy identity check unavailable');
    this.name = 'InterpreterLegacyIdentityCheckUnavailableError';
  }
}

/**
 * Removes an interpreter account while preserving auditable Roleplay history.
 *
 * Roleplay sessions are retained as historical records. Active sessions are
 * cancelled before their interpreter owner is detached. The database CHECK
 * constraint deliberately permits an unowned historical session after a hard
 * deletion, while still forbidding a session from having two owners.
 */
export async function deleteInterpreterDatabaseRecords(tx: any, interpreterId: number) {
  // Lock the owner row before checking dependent history. FK inserts need a
  // conflicting row lock, so a concurrent new call/payroll item cannot slip
  // between the checks and the hard delete within this transaction.
  const lockedRows: Array<{ id: number }> = await tx.$queryRaw`
    SELECT id FROM public.interpreters WHERE id = ${interpreterId} FOR UPDATE
  `;
  if (lockedRows.length === 0) {
    throw new InterpreterNotFoundError();
  }

  const interpreter = await tx.interpreter.findUnique({
    where: { id: interpreterId },
    select: {
      id: true,
      emailCorporativo: true,
      userProfile: { select: { id: true, email: true } },
    },
  });
  if (!interpreter) {
    throw new InterpreterNotFoundError();
  }

  // A hard delete previously erased financial, operational and audit records
  // (including CASCADE-linked status/metrics). Fail closed until an approved
  // retention and anonymization policy exists. Only select identifiers, not PII.
  const historicalReferences = await Promise.all([
    tx.payrollRecord.findFirst({ where: { interpreterId }, select: { id: true } }),
    tx.callSession.findFirst({ where: { interpreterId }, select: { id: true } }),
    tx.productionLog.findFirst({ where: { interpreterId }, select: { id: true } }),
    tx.qAScore.findFirst({ where: { interpreterId }, select: { id: true } }),
    tx.payrateAuditLog.findFirst({ where: { interpreterId }, select: { id: true } }),
    tx.interpreterStatusLog.findFirst({ where: { interpreterId }, select: { id: true } }),
    tx.interpreterMonthlyMetrics.findFirst({ where: { interpreterId }, select: { id: true } }),
    tx.interpreterAccountAssignment.findFirst({ where: { interpreterId }, select: { id: true } }),
    tx.recruitmentApplication.findFirst({ where: { hiredInterpreterId: interpreterId }, select: { id: true } }),
  ]);

  if (historicalReferences.some(Boolean)) {
    throw new InterpreterHasHistoricalRecordsError();
  }

  // Auth.js credentials from public.rbac_users are an independent login
  // provider. Supabase Admin deletion cannot revoke one. A matching email
  // indicates *possible* linked access, never identity equivalence.
  // Block destructive deletion for human review; never delete RBAC by email.
  // The same guard runs inside the locked DB transaction for both API and
  // Server Action, before any local rows or Roleplay history are changed.
  if (interpreter.userProfile && !interpreter.userProfile.email?.trim()) {
    throw new InterpreterLegacyIdentityCheckUnavailableError();
  }
  const candidateEmails = [...new Set(
    [interpreter.emailCorporativo, interpreter.userProfile?.email]
      .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
      .map((email) => email.trim().toLowerCase()),
  )];
  if (candidateEmails.length > 0) {
    let possibleLegacyLogin: { id: string } | null;
    try {
      possibleLegacyLogin = await tx.rbacUser.findFirst({
        where: {
          OR: candidateEmails.map((email) => ({
            email: { equals: email, mode: 'insensitive' as const },
          })),
        },
        select: { id: true },
      });
    } catch {
      // A failed directory check must not be treated as absence. Do not log
      // provider errors, which can contain credentials or personal data.
      throw new InterpreterLegacyIdentityCheckUnavailableError();
    }
    if (possibleLegacyLogin) {
      throw new InterpreterLegacyIdentityReviewRequiredError();
    }
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
