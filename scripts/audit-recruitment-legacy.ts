/**
 * Recruitment legacy audit (read-only).
 *
 * Purpose: before backfilling `RecruitmentApplication` rows or retiring the
 * legacy `RecruitmentCandidate.status` column, quantify how much legacy data
 * exists and whether it can be safely interpreted by the canonical state
 * machine.
 *
 * Run: npx tsx scripts/audit-recruitment-legacy.ts
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';

const db = prisma;

const LEGACY_STATUS_TO_CANONICAL: Record<string, string> = {
  Aplicante: 'APPLIED',
  'Entrevista Agendada': 'ROLEPLAY_PENDING',
  Contratado: 'HIRED',
  Rechazado: 'REJECTED',
};

async function main() {
  console.log(`[Recruitment Legacy Audit] ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  const totalCandidates = await db.recruitmentCandidate.count();
  const totalApplications = await db.recruitmentApplication.count();

  const candidatesWithoutApplication = await db.recruitmentCandidate.findMany({
    where: { applications: { none: {} } },
    select: { id: true, email: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const candidatesWithMultipleApplications = await db.recruitmentApplication.groupBy({
    by: ['candidateId'],
    _count: { _all: true },
    having: { candidateId: { _count: { gt: 1 } } },
  });

  const legacyStatusDistribution = await db.recruitmentCandidate.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const applicationStatusDistribution = await db.recruitmentApplication.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  console.log(`\nCandidates: ${totalCandidates}`);
  console.log(`Applications: ${totalApplications}`);
  console.log(`Candidates WITHOUT an application (need backfill): ${candidatesWithoutApplication.length}`);
  console.log(`Candidates with MORE THAN ONE application (integrity risk): ${candidatesWithMultipleApplications.length}`);

  console.log('\nLegacy candidate.status distribution:');
  for (const row of legacyStatusDistribution.sort((a, b) => b._count._all - a._count._all)) {
    const mapped = row.status ? LEGACY_STATUS_TO_CANONICAL[row.status] : undefined;
    console.log(`  ${row.status ?? '(null)'}: ${row._count._all}${mapped ? ` -> ${mapped}` : ' -> UNMAPPED'}`);
  }

  console.log('\nCanonical application.status distribution:');
  for (const row of applicationStatusDistribution.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.status}: ${row._count._all}`);
  }

  if (candidatesWithoutApplication.length > 0) {
    console.log('\nCandidates without an application (first 50):');
    for (const c of candidatesWithoutApplication.slice(0, 50)) {
      const mapped = c.status ? LEGACY_STATUS_TO_CANONICAL[c.status] : undefined;
      console.log(
        `  id=${c.id} status=${c.status ?? '(null)'} -> ${mapped ?? 'UNMAPPED'} created=${c.createdAt.toISOString()}`
      );
    }
  }

  console.log('\n[Recruitment Legacy Audit] read-only: no rows were modified.');
}

main()
  .catch((err) => {
    console.error('[Recruitment Legacy Audit] Fatal error:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
