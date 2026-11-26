import { z } from 'zod';
import { newBcryptPasswordSchema } from '../../lib/password-policy.js';

/**
 * USERS MODULE — Zod Schemas
 * ============================================================
 * Every payload entering the API MUST be validated by a Zod schema.
 * If validation fails → 400 Bad Request with exact field details.
 *
 * NOTE: These schemas validate the `body` property of the request,
 * matching the validate() middleware pattern.
 * ============================================================
 */

// Prisma generates CUIDs; preserve UUID compatibility for imported identities.
const userIdSchema = z.union([z.cuid(), z.uuid()], { error: 'Invalid user ID format' });

// ── CREATE USER ───────────────────────────────────────────
export const createUserSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format'),
    password: newBcryptPasswordSchema,
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    role: z.enum(['ADMIN', 'INTERPRETER', 'HOLDER']).default('INTERPRETER'),
  }).strict(),
});

// ── UPDATE USER ───────────────────────────────────────────
export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    role: z.enum(['ADMIN', 'INTERPRETER', 'HOLDER']).optional(),
  }).strict(),
  params: z.object({
    id: userIdSchema,
  }),
});

// ── GET USER BY ID (params only) ──────────────────────────
export const getUserByIdSchema = z.object({
  params: z.object({
    id: userIdSchema,
  }),
});

// ── LIST USERS (query params) ─────────────────────────────
export const listUsersSchema = z.object({
  query: z.object({
    role: z.enum(['ADMIN', 'INTERPRETER', 'HOLDER']).optional(),
    page: z.string().regex(/^\d+$/).transform(Number).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  }),
});

// Inferred types for use in controllers
export type CreateUserInput = z.infer<typeof createUserSchema>['body'];
export type UpdateUserInput = z.infer<typeof updateUserSchema>['body'];
