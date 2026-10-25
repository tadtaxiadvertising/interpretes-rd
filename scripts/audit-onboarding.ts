/**
 * Read-only onboarding consistency audit.
 *
 * Run: npm run audit:onboarding
 * Reads onboarding flags from UserProfile and linked Interpreter records.
 * The report intentionally excludes email, names, bank account numbers,
 * national IDs and raw notes to avoid writing PII into local files or CI logs.
 */
import 'dotenv/config';
import prisma from '@/lib/prisma';

type ComputedStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'NEEDS_REVIEW';
type ComputedStep = 'legal' | 'banking' | 'tutorial' | 'complete';

interface AuditResult {
  profileId: string;
  role: string | null;
  interpreterId: number | null;
  onboardingComplete: boolean;
  computedStatus: ComputedStatus;
  computedStep: ComputedStep;
  hasTerms: boolean;
  hasBanking: boolean;
  profileStateMismatch: boolean;
  interpreterDocCompleto: boolean | null;
  interpreterHasTermsMarker: boolean | null;
  interpreterHasBankData: boolean | null;
  interpreterStateMismatch: boolean | null;
}

async function main(): Promise<void> {
  console.log(`[Onboarding Audit] ${new Date().toISOString()}`);

  const profiles = await prisma.userProfile.findMany({
    include: {
      interpreter: {
        select: {
          id: true,
          documentosCompleto: true,
          banco: true,
          cuentaPago: true,
          cedulaRnc: true,
          notas: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const results: AuditResult[] = profiles.map((profile) => {
    const hasTerms = Boolean(profile.termsAcceptedAt);
    const hasBanking = Boolean(profile.bankName && profile.bankAccount && profile.bankCedula);
    const computedStep: ComputedStep = !hasTerms
      ? 'legal'
      : !hasBanking
        ? 'banking'
        : profile.onboardingComplete
          ? 'complete'
          : 'tutorial';

    let computedStatus: ComputedStatus = 'NOT_STARTED';
    if (profile.onboardingComplete) {
      computedStatus = !hasTerms || !hasBanking ? 'NEEDS_REVIEW' : 'COMPLETED';
    } else if (hasTerms) {
      computedStatus = 'IN_PROGRESS';
    }

    const interpreter = profile.interpreter;
    const interpreterHasTermsMarker = interpreter
      ? Boolean(interpreter.notas?.includes('[TERMS_ACCEPTED]'))
      : null;
    const interpreterHasBankData = interpreter
      ? Boolean(interpreter.banco && interpreter.cuentaPago && interpreter.cedulaRnc)
      : null;
    const interpreterStateMismatch = interpreter
      ? Boolean(
          interpreter.documentosCompleto &&
          (!interpreterHasTermsMarker || !interpreterHasBankData)
        )
      : null;

    return {
      profileId: profile.id,
      role: profile.role,
      interpreterId: profile.interpreterId,
      onboardingComplete: profile.onboardingComplete,
      computedStatus,
      computedStep,
      hasTerms,
      hasBanking,
      profileStateMismatch: profile.onboardingComplete !== (computedStatus === 'COMPLETED'),
      interpreterDocCompleto: interpreter?.documentosCompleto ?? null,
      interpreterHasTermsMarker,
      interpreterHasBankData,
      interpreterStateMismatch,
    };
  });

  const statusCounts: Record<ComputedStatus, number> = {
    NOT_STARTED: results.filter((r) => r.computedStatus === 'NOT_STARTED').length,
    IN_PROGRESS: results.filter((r) => r.computedStatus === 'IN_PROGRESS').length,
    COMPLETED: results.filter((r) => r.computedStatus === 'COMPLETED').length,
    NEEDS_REVIEW: results.filter((r) => r.computedStatus === 'NEEDS_REVIEW').length,
  };
  const stepCounts: Record<ComputedStep, number> = {
    legal: results.filter((r) => r.computedStep === 'legal').length,
    banking: results.filter((r) => r.computedStep === 'banking').length,
    tutorial: results.filter((r) => r.computedStep === 'tutorial').length,
    complete: results.filter((r) => r.computedStep === 'complete').length,
  };
  const profileMismatchCount = results.filter((r) => r.profileStateMismatch).length;
  const interpreterMismatchCount = results.filter((r) => r.interpreterStateMismatch).length;

  console.log('\nComputed profile status:', JSON.stringify(statusCounts));
  console.log('Computed profile step:', JSON.stringify(stepCounts));
  console.log(`Profile state mismatches: ${profileMismatchCount}`);
  console.log(`Interpreter state mismatches: ${interpreterMismatchCount}`);

  const mismatches = results.filter((r) => r.profileStateMismatch || r.interpreterStateMismatch);
  if (mismatches.length > 0) {
    console.log('\nRecords requiring review (internal IDs only):');
    for (const result of mismatches) {
      console.log(JSON.stringify({
        profileId: result.profileId,
        interpreterId: result.interpreterId,
        profileStateMismatch: result.profileStateMismatch,
        interpreterStateMismatch: result.interpreterStateMismatch,
        computedStatus: result.computedStatus,
        computedStep: result.computedStep,
      }));
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      statusCounts,
      stepCounts,
      profileMismatchCount,
      interpreterMismatchCount,
    },
    results,
  };
  const { writeFile } = await import('node:fs/promises');
  const reportPath = process.env.AUDIT_ONBOARDING_REPORT_PATH || 'audit-onboarding-report.json';
  await writeFile(reportPath, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log(`Report saved to ${reportPath} (PII fields omitted; file mode 0600 where supported).`);
}

main()
  .catch((error: unknown) => {
    console.error('[Onboarding Audit] Fatal error:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
