import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import crypto from "crypto";
import { resolveRbacRoleByEmail } from "@/lib/admin-identity";

// ---------------------------------------------------------------------------
// Dotenv fallback — load .env.local / .env when running standalone server
// ---------------------------------------------------------------------------
if (typeof window === 'undefined' && typeof (globalThis as any).EdgeRuntime === 'undefined') {
  try {
    const dotenv = require('dotenv');
    const fs = require('fs');
    const path = require('path');
    const getCwd = () => (process as any)['cwd']();

    const loadEnv = (file: string) => {
      try {
        const fullPath = path.resolve(getCwd(), file);
        if (fs.existsSync(fullPath)) {
          const parsed = dotenv.parse(fs.readFileSync(fullPath));
          for (const k in parsed) {
            if (!process.env[k]) process.env[k] = parsed[k];
          }
        }
      } catch {
        // Environment loading is best-effort; deployment variables remain authoritative.
      }
    };

    loadEnv('.env.local');
    loadEnv('.env');
  } catch {
    // dotenv may not be available in Edge.
  }
}

process.env.AUTH_TRUST_HOST = "true";

// AUTH_SECRET must be stable in production. Do not generate a production
// secret during module evaluation: Next.js imports route modules while
// collecting page data during `next build`, before deployment secrets are
// necessarily injected. Runtime auth remains fail-closed when no secret is
// configured because Auth.js receives no usable secret.
if (!process.env.AUTH_SECRET) {
  if (process.env.ENCRYPTION_KEY) {
    process.env.AUTH_SECRET = crypto
      .createHash('sha256')
      .update(process.env.ENCRYPTION_KEY)
      .digest('hex')
      .slice(0, 32);
    console.warn(
      '[AUTH-RBAC] AUTH_SECRET derived from ENCRYPTION_KEY. ' +
      'Set AUTH_SECRET explicitly for stable, independently managed sessions.'
    );
  } else if (process.env.NODE_ENV !== 'production') {
    process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('[AUTH-RBAC] AUTH_SECRET not set — using a development-only random secret.');
  } else {
    console.error('[AUTH-RBAC] AUTH_SECRET is not configured; production authentication will fail closed.');
  }
}

export async function requireRole(requiredRole: "ADMIN" | "HOLDER" | "INTERPRETER") {
  const session = await auth();
  const sessionUserId = session?.user?.id;
  const email = session?.user?.email?.toLowerCase().trim();

  if (!sessionUserId && !email) {
    throw new Error("Unauthorized");
  }

  // Identity is keyed by immutable Auth.js user id. Email is only a legacy
  // fallback for sessions created before ids were populated.
  const user = sessionUserId
    ? await prisma.rbacUser.findUnique({
        where: { id: sessionUserId },
        select: { id: true, email: true, name: true, role: true },
      })
    : await prisma.rbacUser.findUnique({
        where: { email: email! },
        select: { id: true, email: true, name: true, role: true },
      });

  if (!user || user.role !== requiredRole) {
    throw new Error(`Unauthorized: ${requiredRole} role required`);
  }

  return user;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    CredentialsProvider({
      credentials: { email: {}, password: {} },
      async authorize(credentials: unknown) {
        const { email, password } = z
          .object({ email: z.string().email().toLowerCase().trim(), password: z.string() })
          .parse(credentials);

        const user = await prisma.rbacUser.findUnique({ where: { email } });
        if (!user || !(await bcrypt.compare(password, user.password))) {
          throw new Error("Invalid credentials");
        }

        const role = resolveRbacRoleByEmail(user.email, user.role);
        if (user.role !== role) {
          await prisma.rbacUser.update({ where: { id: user.id }, data: { role } });
        }

        return {
          id: user.id,
          email: user.email,
          role,
          name: user.name,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }: { token: JWT; user?: any }) {
      if (user) token.role = user.role;
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (!session.user) return session;

      // Resolve the database identity by token.sub first. Do not OR-match id
      // and email: that can bind a session to the wrong record after an email
      // change or if stale identity data exists.
      const dbUser = token.sub
        ? await prisma.rbacUser.findUnique({
            where: { id: token.sub },
            select: { id: true, email: true, name: true, role: true },
          })
        : null;

      if (dbUser) {
        session.user.id = dbUser.id;
        session.user.email = dbUser.email;
        session.user.name = dbUser.name;
        (session.user as any).role = resolveRbacRoleByEmail(dbUser.email, dbUser.role);
      } else {
        // No DB identity means no authoritative role. Preserve the session
        // shape but do not manufacture elevated privileges from an email.
        session.user.id = token.sub ?? session.user.id;
        (session.user as any).role = undefined;
      }

      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
}) as any;
