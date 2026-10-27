/**
 * Roleplay Session Audit Script
 * 
 * Detects:
 *   1. Duplicate sessions for same target (interpreter/candidate)
 *   2. Invalid states (PENDING without access, EVALUATED without QA score, etc.)
 *   3. Sessions with missing base audio
 *   4. RoleplayAccess tokens without proper expiration
 *   5. Sessions stuck in PENDING without responses
 *   6. Orphaned sessions (no interpreter, no candidate)
 *   7. Sessions with both interpreterId and recruitmentCandidateId
 *   8. Sessions with neither interpreterId nor recruitmentCandidateId
 * 
 * Run: npx tsx scripts/audit-roleplays.ts
 */

import prisma from '@/lib/prisma';

const db = prisma;

async function main() {
  console.log(`🔍 [Roleplay Audit] ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  // Fetch all roleplay sessions with relations
  const sessions = await db.roleplaySession.findMany({
    include: {
      interpreter: { select: { id: true } },
      recruitmentCandidate: { select: { id: true } },
      access: true,
      scenarios: {
        include: { responses: true }
      },
      qaScore: true,
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`\n📋 Total RoleplaySessions: ${sessions.length}`);

  // ── 1. Check target exclusivity ──
  const bothTargets = sessions.filter(s => s.interpreterId && s.recruitmentCandidateId);
  const neitherTarget = sessions.filter(s => !s.interpreterId && !s.recruitmentCandidateId);

  // ── 2. Check for duplicate active sessions per target ──
  const interpreterSessions = new Map<number, typeof sessions>();
  const candidateSessions = new Map<number, typeof sessions>();

  for (const s of sessions) {
    if (s.interpreterId) {
      const arr = interpreterSessions.get(s.interpreterId) || [];
      arr.push(s);
      interpreterSessions.set(s.interpreterId, arr);
    }
    if (s.recruitmentCandidateId) {
      const arr = candidateSessions.get(s.recruitmentCandidateId) || [];
      arr.push(s);
      candidateSessions.set(s.recruitmentCandidateId, arr);
    }
  }

  const duplicateInterpreterSessions: typeof sessions = [];
  for (const [id, sess] of interpreterSessions) {
    const activeStatuses: readonly string[] = ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW'];
    const active = sess.filter(s => activeStatuses.includes(s.status));
    if (active.length > 1) {
      duplicateInterpreterSessions.push(...active);
    }
  }

  const duplicateCandidateSessions: typeof sessions = [];
  for (const [id, sess] of candidateSessions) {
    const activeStatuses: readonly string[] = ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW'];
    const active = sess.filter(s => activeStatuses.includes(s.status));
    if (active.length > 1) {
      duplicateCandidateSessions.push(...active);
    }
  }

  // ── 3. State consistency checks ──
  const pendingWithoutAccess = sessions.filter(s => s.status === 'INVITED' && !s.access);
  const pendingWithUsedAccess = sessions.filter(s => s.status === 'INVITED' && s.access?.usedAt);
  const evaluatedWithoutQA = sessions.filter(s => s.status === 'EVALUATED' && !s.qaScoreId);
  const invitedWithQA = sessions.filter(s => s.status === 'INVITED' && s.qaScoreId);
  const submittedWithoutRecordedAudio = sessions.filter(s => s.submittedAt && !s.recordedAudioUrl);
  const withRecordedAudioButNotSubmitted = sessions.filter(s => s.recordedAudioUrl && !s.submittedAt);

  // ── 4. Access token checks ──
  const expiredAccess = sessions.filter(s => s.access && s.access.expiresAt < new Date() && !s.access.usedAt);
  // RoleplayAccess.session is a required FK with ON DELETE CASCADE; an orphan cannot be represented by this Prisma relation.

  // ── 5. Scenario/Response completeness ──
  const sessionsWithScenarios = sessions.filter(s => s.scenarios.length > 0);
  const sessionsWithoutScenarios = sessions.filter(s => s.scenarios.length === 0);
  const incompleteResponses = sessions.filter(s => 
    s.scenarios.length > 0 && s.scenarios.some(sc => !sc.responses || sc.responses.length === 0)
  );

  // ── 6. Old INVITED sessions (potential abandonment) ──
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const oldPending = sessions.filter(s => s.status === 'INVITED' && s.createdAt < thirtyDaysAgo);

  // ── 7. Status distribution ──
  const statusDist: Record<string, number> = {};
  for (const s of sessions) {
    statusDist[s.status] = (statusDist[s.status] || 0) + 1;
  }

  // ── REPORTING ──
  console.log('\n📊 Status Distribution:');
  for (const [status, count] of Object.entries(statusDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  console.log('\n🔴 CRITICAL ISSUES:');
  if (bothTargets.length > 0) {
    console.log(`  Sessions with BOTH interpreterId AND recruitmentCandidateId: ${bothTargets.length}`);
    for (const s of bothTargets) {
      console.log(`    ${s.id} - interp: ${s.interpreterId}, cand: ${s.recruitmentCandidateId}`);
    }
  }
  if (neitherTarget.length > 0) {
    console.log(`  Sessions with NEITHER interpreterId NOR recruitmentCandidateId: ${neitherTarget.length}`);
    for (const s of neitherTarget) {
      console.log(`    ${s.id} - status: ${s.status}, created: ${s.createdAt}`);
    }
  }
  if (duplicateInterpreterSessions.length > 0) {
    console.log(`  Duplicate active sessions for same interpreter: ${duplicateInterpreterSessions.length}`);
    for (const s of duplicateInterpreterSessions) {
      console.log(`    ${s.id} - interpreter: ${s.interpreterId} (interpreter id ${s.interpreterId}) - status: ${s.status}`);
    }
  }
  if (duplicateCandidateSessions.length > 0) {
    console.log(`  Duplicate active sessions for same candidate: ${duplicateCandidateSessions.length}`);
    for (const s of duplicateCandidateSessions) {
      console.log(`    ${s.id} - candidate: ${s.recruitmentCandidateId} (candidate id ${s.recruitmentCandidateId}) - status: ${s.status}`);
    }
  }
  if (evaluatedWithoutQA.length > 0) {
    console.log(`  EVALUATED sessions WITHOUT QA score: ${evaluatedWithoutQA.length}`);
    for (const s of evaluatedWithoutQA) {
      console.log(`    ${s.id} - status: ${s.status}, qaScoreId: ${s.qaScoreId}`);
    }
  }
  if (invitedWithQA.length > 0) {
    console.log(`  INVITED sessions WITH QA score (inconsistent): ${invitedWithQA.length}`);
    for (const s of invitedWithQA) {
      console.log(`    ${s.id} - status: ${s.status}, qaScoreId: ${s.qaScoreId}`);
    }
  }

  console.log('\n🟡 WARNINGS:');
  if (pendingWithoutAccess.length > 0) {
    console.log(`  INVITED sessions WITHOUT access token: ${pendingWithoutAccess.length}`);
    for (const s of pendingWithoutAccess.slice(0, 10)) {
      console.log(`    ${s.id} - target: ${s.interpreterId ? 'interp:' + s.interpreterId : 'cand:' + s.recruitmentCandidateId}`);
    }
  }
  if (pendingWithUsedAccess.length > 0) {
    console.log(`  INVITED sessions with USED access token (should be STARTED/IN_PROGRESS): ${pendingWithUsedAccess.length}`);
  }
  if (submittedWithoutRecordedAudio.length > 0) {
    console.log(`  Sessions with submittedAt but NO recordedAudioUrl: ${submittedWithoutRecordedAudio.length}`);
  }
  if (withRecordedAudioButNotSubmitted.length > 0) {
    console.log(`  Sessions with recordedAudioUrl but NO submittedAt: ${withRecordedAudioButNotSubmitted.length}`);
  }
  if (expiredAccess.length > 0) {
    console.log(`  Sessions with EXPIRED access tokens (unused): ${expiredAccess.length}`);
  }
  if (sessionsWithoutScenarios.length > 0) {
    console.log(`  Sessions WITHOUT scenarios: ${sessionsWithoutScenarios.length}`);
  }
  if (incompleteResponses.length > 0) {
    console.log(`  Sessions with INCOMPLETE scenario responses: ${incompleteResponses.length}`);
  }
  if (oldPending.length > 0) {
    console.log(`  INVITED sessions older than 30 days (potential abandonment): ${oldPending.length}`);
  }

  console.log('\n🟢 INFO:');
  console.log(`  Sessions with scenarios: ${sessionsWithScenarios.length}`);
  console.log(`  Sessions without scenarios: ${sessionsWithoutScenarios.length}`);

  // ── Scenario details for sessions with scenarios ──
  console.log('\n📋 Scenario/Response Details:');
  for (const s of sessionsWithScenarios.slice(0, 20)) {
    const scenarioCount = s.scenarios.length;
    const responseCount = s.scenarios.reduce((sum, sc) => sum + (sc.responses?.length || 0), 0);
    const selfAssessments = s.scenarios.reduce((sum, sc) => sum + (sc.responses?.filter(r => r.selfScore).length || 0), 0);
    console.log(`  ${s.id} (${s.status}) - ${scenarioCount} scenarios, ${responseCount} responses, ${selfAssessments} self-assessments`);
    if (scenarioCount > 0 && responseCount === 0) {
      console.log(`    ⚠️  No responses recorded for any scenario`);
    }
  }

  // ── Export report ──
  const fs = await import('fs');
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: sessions.length,
      statusDistribution: statusDist,
      critical: {
        bothTargets: bothTargets.length,
        neitherTarget: neitherTarget.length,
        duplicateInterpreterSessions: duplicateInterpreterSessions.length,
        duplicateCandidateSessions: duplicateCandidateSessions.length,
        evaluatedWithoutQA: evaluatedWithoutQA.length,
        invitedWithQA: invitedWithQA.length,
      },
      warnings: {
        pendingWithoutAccess: pendingWithoutAccess.length,
        pendingWithUsedAccess: pendingWithUsedAccess.length,
        submittedWithoutRecordedAudio: submittedWithoutRecordedAudio.length,
        withRecordedAudioButNotSubmitted: withRecordedAudioButNotSubmitted.length,
        expiredAccess: expiredAccess.length,
        
        sessionsWithoutScenarios: sessionsWithoutScenarios.length,
        incompleteResponses: incompleteResponses.length,
        oldPending: oldPending.length,
      },
    },
    details: {
      bothTargets: bothTargets.map(s => ({ id: s.id, interpreterId: s.interpreterId, candidateId: s.recruitmentCandidateId, status: s.status })),
      neitherTarget: neitherTarget.map(s => ({ id: s.id, status: s.status, createdAt: s.createdAt })),
      duplicateInterpreterSessions: duplicateInterpreterSessions.map(s => ({ id: s.id, interpreterId: s.interpreterId, status: s.status })),
      duplicateCandidateSessions: duplicateCandidateSessions.map(s => ({ id: s.id, candidateId: s.recruitmentCandidateId, status: s.status })),
      pendingWithoutAccess: pendingWithoutAccess.map(s => ({ id: s.id, status: s.status })),
      evaluatedWithoutQA: evaluatedWithoutQA.map(s => ({ id: s.id, status: s.status })),
      invitedWithQA: invitedWithQA.map(s => ({ id: s.id, status: s.status, qaScoreId: s.qaScoreId })),
    },
  };
  fs.writeFileSync('audit-roleplays-report.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Full report saved to: audit-roleplays-report.json');
}

main()
  .catch((err) => {
    console.error('🔴 [Roleplay Audit] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());