import dotenv from 'dotenv';
dotenv.config();
import prisma from '@/lib/prisma';

async function main() {
  console.log('=== DATA INTEGRITY AUDIT (read-only) ===\n');

  // 1. Duplicate emails in recruitmentCandidate
  const dupCandidates = await prisma.$queryRawUnsafe<{ email: string; n: number }[]>(
    `SELECT email, COUNT(*)::int AS n FROM recruitment_candidates GROUP BY email HAVING COUNT(*) > 1`
  );
  console.log('Duplicate recruitment_candidate emails:', dupCandidates.length);
  if (dupCandidates.length) console.log(dupCandidates.slice(0, 10));

  // 2. Duplicate emails in interpreter (emailCorporativo)
  const dupInterpreters = await prisma.$queryRawUnsafe<{ email_corporativo: string; n: number }[]>(
    `SELECT email_corporativo, COUNT(*)::int AS n FROM interpreters WHERE email_corporativo IS NOT NULL GROUP BY email_corporativo HAVING COUNT(*) > 1`
  );
  console.log('Duplicate interpreter emails:', dupInterpreters.length);
  if (dupInterpreters.length) console.log(dupInterpreters.slice(0, 10));

  // 3. UserProfile without interpreter link (missing interpreterId)
  const profilesNoInterpreter = await prisma.userProfile.count({ where: { interpreterId: null } });
  console.log('UserProfiles with interpreterId = null:', profilesNoInterpreter);

  // 4. Interpreters with status 'Candidato' that have a hired application (should be Activo)
  const hiredButCandidato = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT i.id FROM interpreters i JOIN recruitment_candidates rc ON rc.email = i.email_corporativo JOIN recruitment_applications ra ON ra.candidate_id = rc.id WHERE ra.status = 'HIRED' AND i.status = 'Candidato'`
  );
  console.log('Hired candidates still marked Candidato:', hiredButCandidato.length);

  // 5. Roleplay sessions with both targets set (invariant violation)
  const bothTargets = await prisma.roleplaySession.count({
    where: { AND: [{ interpreterId: { not: null } }, { recruitmentCandidateId: { not: null } }] },
  });
  console.log('Roleplay sessions with BOTH interpreterId and candidateId:', bothTargets);

  // 6. Roleplay sessions with neither target
  const neitherTarget = await prisma.roleplaySession.count({
    where: { AND: [{ interpreterId: null }, { recruitmentCandidateId: null }] },
  });
  console.log('Roleplay sessions with NEITHER target:', neitherTarget);

  // 7. Orphaned roleplay sessions (interpreterId not in interpreters)
  const orphanInterp = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM roleplay_sessions rs LEFT JOIN interpreters i ON i.id = rs.interpreter_id WHERE rs.interpreter_id IS NOT NULL AND i.id IS NULL`
  );
  console.log('Roleplay sessions orphaned (interpreter):', orphanInterp[0]?.n);

  // 8. Orphaned roleplay sessions (candidateId not in recruitment_candidates)
  const orphanCand = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM roleplay_sessions rs LEFT JOIN recruitment_candidates rc ON rc.id = rs.recruitment_candidate_id WHERE rs.recruitment_candidate_id IS NOT NULL AND rc.id IS NULL`
  );
  console.log('Roleplay sessions orphaned (candidate):', orphanCand[0]?.n);

  // 9. Roleplay sessions with status not in canonical enum
  const badStatus = await prisma.$queryRawUnsafe<{ status: string; n: number }[]>(
    `SELECT status, COUNT(*)::int AS n FROM roleplay_sessions GROUP BY status`
  );
  console.log('Roleplay session status distribution:', badStatus);

  // 10. UserProfile emails not lowercase
  const nonLowerProfiles = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM user_profiles WHERE email <> LOWER(email)`
  );
  console.log('UserProfiles with non-lowercase email:', nonLowerProfiles[0]?.n);

  // 11. Interpreter emails not lowercase
  const nonLowerInterp = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM interpreters WHERE email_corporativo IS NOT NULL AND email_corporativo <> LOWER(email_corporativo)`
  );
  console.log('Interpreters with non-lowercase email:', nonLowerInterp[0]?.n);

  // 12. RecruitmentCandidate emails not lowercase
  const nonLowerCand = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM recruitment_candidates WHERE email <> LOWER(email)`
  );
  console.log('RecruitmentCandidates with non-lowercase email:', nonLowerCand[0]?.n);

  // 13. Applications without candidate (orphan)
  const orphanApps = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM recruitment_applications ra LEFT JOIN recruitment_candidates rc ON rc.id = ra.candidate_id WHERE rc.id IS NULL`
  );
  console.log('Orphaned recruitment applications:', orphanApps[0]?.n);

  // 14. Total counts
  console.log('\n--- Totals ---');
  console.log('interpreters:', await prisma.interpreter.count());
  console.log('user_profiles:', await prisma.userProfile.count());
  console.log('recruitment_candidates:', await prisma.recruitmentCandidate.count());
  console.log('recruitment_applications:', await prisma.recruitmentApplication.count());
  console.log('roleplay_sessions:', await prisma.roleplaySession.count());

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
