import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * DATABASE SEED — FREE INTERPRETERS OS
 * ============================================================
 * Idempotent seed script for all core tables.
 * Safe to run multiple times — uses upsert to prevent duplicates.
 *
 * RUN: npx prisma db seed
 *      (configured via package.json → prisma.seed → "tsx prisma/seed.ts")
 *
 * SECURITY NOTE:
 *   Default passwords are for initial deployment ONLY.
 *   Change them immediately after first login.
 * ============================================================
 */

import { getPrisma } from '../src/lib/prisma';

const SALT_ROUNDS = 12;

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
console.log('Connecting to:', connectionString ? 'URL present' : 'MISSING URL');

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const prisma = getPrisma();

async function seedInterpreters(): Promise<void> {
  console.log('👥 Seeding interpreters...');

  const interpreters = [
    {
      externalId: 'INT-001',
      name: 'Arismendy Rodriguez',
      status: 'Activo',
      campaign: 'Medical',
      languageA: 'Español',
      languageB: 'Inglés',
      tariffPerMinute: 0.15,
      pais: 'Dominican Republic',
      metodoPago: 'PayPal',
      emailCorporativo: 'arismendy@freeinterpreters.com',
    },
    {
      externalId: 'INT-002',
      name: 'Sofia Martinez',
      status: 'Activo',
      campaign: 'Legal',
      languageA: 'Español',
      languageB: 'Inglés',
      tariffPerMinute: 0.18,
      pais: 'Mexico',
      metodoPago: 'Bank Transfer',
    },
    {
      externalId: 'INT-003',
      name: 'John Doe',
      status: 'Probation',
      campaign: 'Customer Service',
      languageA: 'Español',
      languageB: 'Inglés',
      tariffPerMinute: 0.12,
      pais: 'Colombia',
      metodoPago: 'Payoneer',
    },
    {
      externalId: 'INT-004',
      name: 'Elena Gilbert',
      status: 'Inactivo',
      campaign: 'Medical',
      languageA: 'Español',
      languageB: 'Inglés',
      tariffPerMinute: 0.15,
      pais: 'USA',
      metodoPago: 'USDT',
    },
    {
      externalId: 'INT-005',
      name: 'Deury Interpreter',
      status: 'Activo',
      campaign: 'Medical',
      languageA: 'Español',
      languageB: 'Inglés',
      tariffPerMinute: 0.15,
      pais: 'Dominican Republic',
      metodoPago: 'PayPal',
      emailCorporativo: 'deury@freeinterpreters.com',
    },
    {
      externalId: 'INT-006',
      name: 'Melvin Interpreter',
      status: 'Activo',
      campaign: 'Medical',
      languageA: 'Español',
      languageB: 'Inglés',
      tariffPerMinute: 0.15,
      pais: 'Dominican Republic',
      metodoPago: 'PayPal',
      emailCorporativo: 'melvin@freeinterpreters.com',
    },
    {
      externalId: 'INT-007',
      name: 'Isaac Interpreter',
      status: 'Activo',
      campaign: 'Legal',
      languageA: 'Español',
      languageB: 'Inglés',
      tariffPerMinute: 0.18,
      pais: 'Dominican Republic',
      metodoPago: 'Bank Transfer',
      emailCorporativo: 'isaac@freeinterpreters.com',
    },
    {
      externalId: 'INT-008',
      name: 'Miguel Interpreter',
      status: 'Activo',
      campaign: 'Customer Service',
      languageA: 'Español',
      languageB: 'Inglés',
      tariffPerMinute: 0.12,
      pais: 'Dominican Republic',
      metodoPago: 'Payoneer',
      emailCorporativo: 'miguel@freeinterpreters.com',
    },
  ];

  for (const int of interpreters) {
    await prisma.interpreter.upsert({
      where: { externalId: int.externalId },
      update: {},
      create: int,
    });
  }

  console.log(`  ✅ ${interpreters.length} interpreters seeded.`);
}

async function seedRecruitmentCandidates(): Promise<void> {
  console.log('📋 Seeding recruitment candidates...');

  const candidates = [
    {
      name: 'Marcos Peña',
      email: 'marcos@example.com',
      status: 'Aplicante',
      pais: 'Dominican Republic',
      englishLevel: 'C1',
      fechaPostulacion: new Date('2026-04-20'),
    },
    {
      name: 'Laura Garcia',
      email: 'laura@example.com',
      status: 'Entrevista',
      pais: 'Argentina',
      englishLevel: 'C2',
      resultRoleplay: 85,
      fechaPostulacion: new Date('2026-04-18'),
    },
    {
      name: 'Ricardo Fort',
      email: 'ricardo@example.com',
      status: 'Contratado',
      pais: 'Argentina',
      englishLevel: 'C1',
      resultRoleplay: 92,
      fechaPostulacion: new Date('2026-04-10'),
    },
    {
      name: 'Bad Bunny',
      email: 'benito@example.com',
      status: 'Rechazado',
      pais: 'Puerto Rico',
      englishLevel: 'B2',
      resultRoleplay: 45,
      fechaPostulacion: new Date('2026-04-15'),
    },
  ];

  for (const cand of candidates) {
    await prisma.recruitmentCandidate.upsert({
      where: { email: cand.email },
      update: {},
      create: cand,
    });
  }

  console.log(`  ✅ ${candidates.length} candidates seeded.`);
}

async function seedRbacUsers(): Promise<void> {
  console.log('🔐 Seeding RBAC users...');

  // No hard-coded/default passwords: a developer must explicitly provide a
  // secret for each local bootstrap account. This seed is blocked entirely
  // in production because it also contains demonstration interpreters/candidates.
  const rbacUsers: Array<{
    email: string;
    name: string;
    role: 'ADMIN' | 'HOLDER' | 'INTERPRETER';
    passwordEnv: string;
  }> = [
    {
      email: 'interpretersfree@gmail.com',
      name: 'Administrador Titular',
      role: 'ADMIN',
      passwordEnv: 'SEED_OWNER_ADMIN_PASSWORD',
    },
    {
      email: 'melvinramonduranmesa@gmail.com',
      name: 'Melvin Duran',
      role: 'ADMIN',
      passwordEnv: 'SEED_SECOND_ADMIN_PASSWORD',
    },
    {
      email: 'admin@freeinterpreters.com',
      name: 'Arismendy Admin',
      role: 'ADMIN',
      passwordEnv: 'SEED_THIRD_ADMIN_PASSWORD',
    },
  ];

  for (const user of rbacUsers) {
    const password = process.env[user.passwordEnv];
    if (!password) {
      console.info(
        `ℹ️ Skipping RBAC seed for ${user.email}: set ${user.passwordEnv} explicitly to create it.`
      );
      continue;
    }

    const existingUser = await prisma.rbacUser.findUnique({
      where: { email: user.email },
    });

    if (!existingUser) {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      await prisma.rbacUser.create({
        data: {
          email: user.email,
          password: hashedPassword,
          name: user.name,
          role: user.role,
        },
      });

      console.log(`  ✅ Created RBAC user: ${user.email} (${user.role})`);
    } else {
      console.log(`  ℹ️  RBAC user already exists: ${user.email}`);
    }
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Production seed is disabled: this script contains demonstration interpreter/candidate data. Use an explicit, reviewed production provisioning process instead.'
    );
  }
  console.log('🌱 Seeding database...\n');

  await seedInterpreters();
  await seedRecruitmentCandidates();
  await seedRbacUsers();

  console.log('\n✅ Seed completed successfully!');
}

main()
  .catch((error: unknown) => {
    console.error('❌ Error crítico durante la ejecución del Seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('🔌 Conexión con Prisma cerrada limpiamente.');
  });
