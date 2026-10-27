import 'dotenv/config';
import prisma from '@/lib/prisma';

async function main() {
  console.log('=== RBAC USER AUDIT (read-only) ===\n');

  // 1. Total counts
  console.log('rbac_users:', await prisma.rbacUser.count());
  console.log('user_profiles:', await prisma.userProfile.count());

  // 2. RbacUsers with non-lowercase email
  const nonLower = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM rbac_users WHERE email <> LOWER(email)`
  );
  console.log('RbacUsers non-lowercase email:', nonLower[0]?.n);

  // 3. RbacUsers whose email has no matching UserProfile (orphan rbac)
  const rbacNoProfile = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM rbac_users r LEFT JOIN user_profiles u ON u.email = r.email WHERE u.id IS NULL`
  );
  console.log('RbacUsers without matching UserProfile:', rbacNoProfile[0]?.n);

  // 4. UserProfiles whose email has no matching RbacUser (orphan profile)
  const profileNoRbac = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM user_profiles u LEFT JOIN rbac_users r ON r.email = u.email WHERE r.id IS NULL`
  );
  console.log('UserProfiles without matching RbacUser:', profileNoRbac[0]?.n);

  // 5. RbacUsers with admin role count
  const adminCount = await prisma.rbacUser.count({ where: { role: 'ADMIN' } });
  console.log('RbacUser admins:', adminCount);

  // 6. Duplicate email across rbac_users (should be 0 due to unique)
  const dupRbac = await prisma.$queryRawUnsafe<{ email: string; n: number }[]>(
    `SELECT email, COUNT(*)::int AS n FROM rbac_users GROUP BY email HAVING COUNT(*) > 1`
  );
  console.log('Duplicate rbac_users emails:', dupRbac.length);

  // 7. RbacUsers with role INTERPRETER that have no interpreter link via profile
  const rbacInterpreters = await prisma.rbacUser.findMany({
    where: { role: 'INTERPRETER' },
    select: { email: true },
  });
  let unlinked = 0;
  for (const r of rbacInterpreters) {
    const profile = await prisma.userProfile.findUnique({ where: { email: r.email }, select: { interpreterId: true } });
    if (!profile || profile.interpreterId === null) unlinked++;
  }
  console.log(`RbacUser interpreters without linked interpreterId: ${unlinked} / ${rbacInterpreters.length}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
