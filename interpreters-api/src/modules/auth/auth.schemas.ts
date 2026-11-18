import { z } from 'zod';

/**
 * AUTH MODULE — Zod Schemas
 * ============================================================
 * Every auth payload MUST be validated before touching bcrypt or Prisma.
 * Fail-fast with 400 before any CPU-intensive or DB operations.
 * ============================================================
 */

// ── LOGIN ─────────────────────────────────────────────────
export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format').max(255),
    password: z.string().min(1, 'Password is required').max(128),
  }),
});

// Self-registration is never permitted to mint an elevated RBAC identity.
export const PUBLIC_REGISTRATION_ROLE = 'INTERPRETER' as const;

// ── REGISTER ──────────────────────────────────────────────
export const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format').max(255),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters'),
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    // Compatibility: clients may explicitly send INTERPRETER, but ADMIN and
    // HOLDER must be provisioned through an authenticated administrative path.
    role: z.literal(PUBLIC_REGISTRATION_ROLE).optional(),
  }),
});

export type LoginInput = z.infer<typeof loginSchema>['body'];
export type RegisterInput = z.infer<typeof registerSchema>['body'];
