/**
 * User Identity Audit Script
 * 
 * Detects:
 *   1. Duplicate emails across rbac_users, user_profiles, interpreters, recruitment_candidates
 *   2. Orphaned UserProfile records without linked Interpreter
 *   3. Orphaned Interpreter records without UserProfile
 *   4. Users with onboardingComplete = true but inconsistent data
 *   5. Email case sensitivity issues
 *   6. rbac_users without matching user_profiles
 * 
 * Run: npx tsx scripts/audit-users.ts
 */

import prisma from '@/lib/prisma';

const db = prisma;

interface AuditResult {
  category: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  count: number;
  details: any[];
}

async function main() {
  console.log(`🔍 [User Audit] ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  const results: AuditResult[] = [];

  // ── 1. Email duplicates across all identity tables ──
  console.log('\n📧 Checking email duplicates across identity tables...');
  
  const rbacUsers = await db.rbacUser.findMany({ select: { id: true, email: true, name: true, role: true } });
  const userProfiles = await db.userProfile.findMany({ select: { id: true, email: true, displayName: true, role: true, interpreterId: true, onboardingComplete: true } });
  const interpreters = await db.interpreter.findMany({ select: { id: true, emailCorporativo: true, name: true, status: true, documentosCompleto: true, banco: true, cuentaPago: true, cedulaRnc: true } });
  const candidates = await db.recruitmentCandidate.findMany({ select: { id: true, email: true, name: true } });

  // Normalize emails to lowercase for comparison
  type EmailSources = {
    rbac?: (typeof rbacUsers)[number];
    profile?: (typeof userProfiles)[number];
    interpreter?: (typeof interpreters)[number];
    candidate?: (typeof candidates)[number];
  };
  const allEmails = new Map<string, EmailSources>();
  
  for (const u of rbacUsers) {
    const key = u.email.toLowerCase().trim();
    if (!allEmails.has(key)) allEmails.set(key, {});
    allEmails.get(key)!.rbac = u;
  }
  for (const u of userProfiles) {
    const key = u.email.toLowerCase().trim();
    if (!allEmails.has(key)) allEmails.set(key, {});
    allEmails.get(key)!.profile = u;
  }
  for (const u of interpreters) {
    if (u.emailCorporativo) {
      const key = u.emailCorporativo.toLowerCase().trim();
      if (!allEmails.has(key)) allEmails.set(key, {});
      allEmails.get(key)!.interpreter = u;
    }
  }
  for (const u of candidates) {
    const key = u.email.toLowerCase().trim();
    if (!allEmails.has(key)) allEmails.set(key, {});
    allEmails.get(key)!.candidate = u;
  }

  const duplicateEmails = Array.from(allEmails.entries()).filter(([, v]) => {
    const sources = Object.entries(v).filter(([, value]) => Boolean(value)).map(([key]) => key);
    return sources.length > 1;
  });

  results.push({
    category: 'Email Duplicates Across Tables',
    severity: duplicateEmails.length > 0 ? 'CRITICAL' : 'INFO',
    count: duplicateEmails.length,
    details: duplicateEmails.map(([, v]) => ({
      sources: Object.entries(v).filter(([, value]) => Boolean(value)).map(([key]) => key),
      rbac: v.rbac?.id,
      profile: v.profile?.id,
      interpreter: v.interpreter?.id,
      candidate: v.candidate?.id,
    })),
  });

  // ── 2. Orphaned UserProfiles (no linked Interpreter) ──
  console.log('\n👤 Checking orphaned UserProfiles...');
  const orphanedProfiles = await db.userProfile.findMany({
    where: { interpreterId: null },
    select: { id: true, email: true, displayName: true, role: true, onboardingComplete: true, createdAt: true },
  });
  
  results.push({
    category: 'Orphaned UserProfiles (no interpreterId)',
    severity: orphanedProfiles.length > 0 ? 'WARNING' : 'INFO',
    count: orphanedProfiles.length,
    details: orphanedProfiles.map(p => ({ id: p.id, role: p.role, hasDisplayName: Boolean(p.displayName), createdAt: p.createdAt })),
  });

  // ── 3. Orphaned Interpreters (no UserProfile linking to them) ──
  console.log('\n🎭 Checking orphaned Interpreters...');
  const profileInterpreterIds = new Set(userProfiles.filter(p => p.interpreterId).map(p => p.interpreterId));
  const orphanedInterpreters = interpreters.filter(i => !profileInterpreterIds.has(i.id));
  
  results.push({
    category: 'Orphaned Interpreters (no UserProfile link)',
    severity: orphanedInterpreters.length > 0 ? 'WARNING' : 'INFO',
    count: orphanedInterpreters.length,
    details: orphanedInterpreters.map(i => ({ id: i.id, status: i.status, documentosCompleto: i.documentosCompleto })),
  });

  // ── 4. rbac_users without matching UserProfile ──
  console.log('\n🔐 Checking rbac_users without UserProfile...');
  const profileEmails = new Set(userProfiles.map(p => p.email.toLowerCase().trim()));
  const rbacWithoutProfile = rbacUsers.filter(u => !profileEmails.has(u.email.toLowerCase().trim()));
  
  results.push({
    category: 'rbac_users without UserProfile',
    severity: rbacWithoutProfile.length > 0 ? 'WARNING' : 'INFO',
    count: rbacWithoutProfile.length,
    details: rbacWithoutProfile.map(u => ({ id: u.id, role: u.role })),
  });

  // ── 5. UserProfiles without matching rbac_user ──
  console.log('\n👤 Checking UserProfiles without rbac_user...');
  const rbacEmails = new Set(rbacUsers.map(u => u.email.toLowerCase().trim()));
  const profilesWithoutRbac = userProfiles.filter(p => !rbacEmails.has(p.email.toLowerCase().trim()));
  
  results.push({
    category: 'UserProfiles without rbac_user',
    severity: profilesWithoutRbac.length > 0 ? 'INFO' : 'INFO',
    count: profilesWithoutRbac.length,
    details: profilesWithoutRbac.map(p => ({ id: p.id, role: p.role, hasDisplayName: Boolean(p.displayName), interpreterId: p.interpreterId })),
  });

  // ── 6. onboardingComplete = true but missing required data ──
  console.log('\n✅ Checking onboardingComplete=true with missing data...');
  const completedProfiles = userProfiles.filter(p => p.onboardingComplete);
  const incompleteCompleted = completedProfiles.filter(p => 
    !p.displayName || (p.role === 'interpreter' && !p.interpreterId)
  );
  
  results.push({
    category: 'onboardingComplete=true but missing data',
    severity: incompleteCompleted.length > 0 ? 'CRITICAL' : 'INFO',
    count: incompleteCompleted.length,
    details: incompleteCompleted.map(p => ({ id: p.id, role: p.role, hasDisplayName: Boolean(p.displayName), interpreterId: p.interpreterId })),
  });

  // ── 7. Interpreters with documentosCompleto=true but missing payment info ──
  console.log('\n💰 Checking interpreters with documentosCompleto but missing payment info...');
  const completedInterpreters = interpreters.filter(i => i.documentosCompleto);
  const incompleteInterpreters = completedInterpreters.filter(i => 
    !i.banco || !i.cuentaPago || !i.cedulaRnc
  );
  
  results.push({
    category: 'Interpreters documentosCompleto=true but missing payment data',
    severity: incompleteInterpreters.length > 0 ? 'WARNING' : 'INFO',
    count: incompleteInterpreters.length,
    details: incompleteInterpreters.map(i => ({ id: i.id, missingBank: !i.banco, missingAccount: !i.cuentaPago, missingTaxId: !i.cedulaRnc })),
  });

  // ── 8. Email case sensitivity issues ──
  console.log('\n🔤 Checking email case sensitivity...');
  const caseIssues: any[] = [];
  
  // Check rbac_users
  const rbacEmailCounts = new Map<string, number>();
  for (const u of rbacUsers) {
    const key = u.email.toLowerCase().trim();
    rbacEmailCounts.set(key, (rbacEmailCounts.get(key) || 0) + 1);
  }
  for (const [email, count] of rbacEmailCounts) {
    if (count > 1) caseIssues.push({ table: 'rbac_users', count });
  }
  
  // Check user_profiles
  const profileEmailCounts = new Map<string, number>();
  for (const u of userProfiles) {
    const key = u.email.toLowerCase().trim();
    profileEmailCounts.set(key, (profileEmailCounts.get(key) || 0) + 1);
  }
  for (const [email, count] of profileEmailCounts) {
    if (count > 1) caseIssues.push({ table: 'user_profiles', count });
  }

  // Check interpreters
  const interpEmailCounts = new Map<string, number>();
  for (const u of interpreters) {
    if (u.emailCorporativo) {
      const key = u.emailCorporativo.toLowerCase().trim();
      interpEmailCounts.set(key, (interpEmailCounts.get(key) || 0) + 1);
    }
  }
  for (const [email, count] of interpEmailCounts) {
    if (count > 1) caseIssues.push({ table: 'interpreters', count });
  }

  results.push({
    category: 'Email case sensitivity duplicates (same email different case)',
    severity: caseIssues.length > 0 ? 'CRITICAL' : 'INFO',
    count: caseIssues.length,
    details: caseIssues,
  });

  // ── SUMMARY ──
  console.log('\n' + '='.repeat(60));
  console.log('📊 AUDIT SUMMARY');
  console.log('='.repeat(60));

  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const r of results) {
    const icon = r.severity === 'CRITICAL' ? '🔴' : r.severity === 'WARNING' ? '🟡' : '🟢';
    console.log(`${icon} ${r.category}: ${r.count}`);
    if (r.count > 0 && r.severity !== 'INFO') {
      console.log(`   Details: ${JSON.stringify(r.details.slice(0, 5), null, 2)}${r.details.length > 5 ? ` ... (${r.details.length} total)` : ''}`);
    }
    if (r.severity === 'CRITICAL') criticalCount += r.count;
    else if (r.severity === 'WARNING') warningCount += r.count;
    else infoCount += r.count;
  }

  console.log('\n' + '-'.repeat(60));
  console.log(`🔴 Critical: ${criticalCount}  🟡 Warning: ${warningCount}  🟢 Info: ${infoCount}`);
  console.log('='.repeat(60));

  // Export to JSON for further analysis
  const fs = await import('fs');
  const report = {
    timestamp: new Date().toISOString(),
    summary: { critical: criticalCount, warning: warningCount, info: infoCount },
    results,
  };
  fs.writeFileSync('audit-users-report.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Full report saved to: audit-users-report.json');
}

main()
  .catch((err) => {
    console.error('🔴 [User Audit] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());