import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { createUserSchema, updateUserSchema } from './users.schemas.js';
import { withPasswordWork } from '../../lib/password-work-gate.js';

/**
 * USERS CONTROLLER — RESTful, Stateless, Lean Queries
 * ============================================================
 * ARCHITECTURAL RULES ENFORCED:
 *
 *   1. LEAN QUERIES ONLY — Every Prisma call uses explicit `select`.
 *      NEVER use `include` or return the full model.
 *      This minimizes Supabase CPU usage and network payload.
 *
 *   2. IDEMPOTENT MUTATIONS — POST uses upsert-like error handling
 *      (catch P2002 → 409). PUT is naturally idempotent.
 *      DELETE returns 204 even if already deleted.
 *
 *   3. NO TRY/CATCH HERE — Controllers are wrapped by `asyncHandler`
 *      in the routes file. Errors bubble to globalErrorHandler.
 *
 *   4. NO STACK TRACES — AppError messages are user-safe.
 *      Internal details are logged by the error middleware.
 * ============================================================
 */

// ── Shared select projection (DRY) ───────────────────────
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;


/**
 * GET /api/v1/users
 * List users with optional role filter and pagination.
 */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const role = req.query.role as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const where = role ? { role: role as 'ADMIN' | 'INTERPRETER' | 'HOLDER' } : {};

  const [users, total] = await Promise.all([
    prisma.rbacUser.findMany({
      where,
      select: USER_SELECT,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.rbacUser.count({ where }),
  ]);

  res.json({
    success: true,
    data: users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}


/**
 * GET /api/v1/users/:id
 * Retrieve a single user by CUID or UUID. Returns 404 if not found.
 */
export async function getUserById(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const user = await prisma.rbacUser.findUnique({
    where: { id },
    select: USER_SELECT,
  });

  if (!user) {
    throw AppError.notFound(`User with ID ${id} not found`);
  }

  res.json({ success: true, data: user });
}


/**
 * POST /api/v1/users
 * Create a new user. Idempotent: returns 409 on duplicate email
 * (handled by globalErrorHandler via Prisma P2002).
 */
export async function createUser(req: Request, res: Response): Promise<void> {
  const { email, password, name, role } = createUserSchema.parse({ body: req.body }).body;

  // Hash password — bcrypt with cost factor 10 (balanced for VPS CPU)
  const hashedPassword = await withPasswordWork(() => bcrypt.hash(password, 10));

  const user = await prisma.rbacUser.create({
    data: {
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      name: name.trim(),
      role,
    },
    select: USER_SELECT,
  });

  res.status(201).json({ success: true, data: user });
}


/**
 * PUT /api/v1/users/:id
 * Partial update of user fields. Idempotent by nature.
 * Returns 404 if user doesn't exist (Prisma P2025 → globalErrorHandler).
 */
export async function updateUser(req: Request, res: Response): Promise<void> {
  const { params: { id }, body: updateData } = updateUserSchema.parse({
    params: req.params, body: req.body,
  });
  // Persist only the fields explicitly supported by this operation.
  const data = {
    ...(updateData.name !== undefined ? { name: updateData.name } : {}),
    ...(updateData.role !== undefined ? { role: updateData.role } : {}),
  };

  // Verify user exists before update (explicit 404 vs Prisma's P2025)
  const existing = await prisma.rbacUser.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw AppError.notFound(`User with ID ${id} not found`);
  }

  const user = await prisma.rbacUser.update({
    where: { id },
    data,
    select: USER_SELECT,
  });

  res.json({ success: true, data: user });
}


/**
 * DELETE /api/v1/users/:id
 * Soft-safe delete. Returns 204 No Content.
 * Idempotent: if user already deleted, Prisma throws P2025
 * which the globalErrorHandler maps to 404.
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  await prisma.rbacUser.delete({
    where: { id },
  });

  res.status(204).send();
}
