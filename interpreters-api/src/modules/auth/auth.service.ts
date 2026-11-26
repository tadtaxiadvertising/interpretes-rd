import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '../../lib/prisma.js';
import { ENV } from '../../config/env.js';
import { AppError } from '../../lib/AppError.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import { PUBLIC_REGISTRATION_ROLE } from './auth.schemas.js';
import { newBcryptPasswordSchema } from '../../lib/password-policy.js';
import { sessionRevision } from '../../lib/session-revision.js';
import { withPasswordWork } from '../../lib/password-work-gate.js';

/**
 * AUTH SERVICE — Business Logic
 * ============================================================
 * RULES:
 *   1. LEAN QUERIES: Only select fields needed for auth logic.
 *   2. AppError: Throw typed errors (401, 409) — never plain Error.
 *   3. Password: bcrypt cost factor 10 (balanced for VPS CPU).
 *   4. JWT: Includes id, email, role, interpreterId for RBAC.
 * ============================================================
 */

// Only fetch what's needed for password verification + token generation
const LOGIN_SELECT = {
  id: true,
  email: true,
  password: true,
  updatedAt: true,
  name: true,
  role: true,
} as const;

// What we return to the client (no password hash!)
const USER_SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} as const;


export class AuthService {
  static async login(data: LoginInput) {
    const { email, password } = data;

    const user = await prisma.rbacUser.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: LOGIN_SELECT,
    });

    if (!user) {
      // Same response as an incorrect password; timing is not equalized.
      throw AppError.unauthorized('Invalid credentials');
    }

    const isPasswordValid = await withPasswordWork(() => bcrypt.compare(password, user.password));
    if (!isPasswordValid) {
      throw AppError.unauthorized('Invalid credentials');
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        revision: sessionRevision(user, ENV.JWT_SECRET),
      },
      ENV.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: ENV.JWT_EXPIRES_IN }
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    };
  }

  static async register(data: RegisterInput) {
    const { email, password, name } = data;
    // Keep the invariant even if a future caller bypasses HTTP validation.
    const validatedPassword = newBcryptPasswordSchema.parse(password);

    // Check for existing user before hashing (save CPU on duplicate)
    const existing = await prisma.rbacUser.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true },
    });

    if (existing) {
      throw AppError.conflict('Email already registered');
    }

    const hashedPassword = await withPasswordWork(() => bcrypt.hash(validatedPassword, 10));

    return prisma.rbacUser.create({
      data: {
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        name: name.trim(),
        role: PUBLIC_REGISTRATION_ROLE,
      },
      select: USER_SAFE_SELECT,
    });
  }
}
