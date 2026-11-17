# Development Guide — Intérpretes RD

This guide provides the necessary information for developers working on the Intérpretes RD.

## 1. Project Overview

The platform is divided into two main areas:

- **Main Roster App**: Manages interpreters, production, and payroll. (Auth: Supabase)
- **Portal RBAC (Vault)**: Secure storage for platform credentials. (Auth: Auth.js)

## 2. Authentication Systems

### 2.1 Supabase Auth (Main App)

Used for all routes under `/dashboard`, `/admin`, `/payroll`, and `/qa`.

- Configuration: `src/lib/supabase/`
- Middleware logic: `src/middleware.ts` (Legacy section)

### 2.2 Auth.js / NextAuth v5 (Portal RBAC)

Used for all routes under `/portal-rbac`.

- Configuration: `src/lib/auth-rbac.ts`
- Access control: `requireRole(role)` in Server Actions.

## 3. Data Architecture

### 3.1 Direct Prisma Access

We use a Prisma singleton for all server-side data access to avoid DNS resolution issues.

- Client: `src/lib/prisma.ts`
- Usage: `import prisma from "@/lib/prisma"`

### 3.2 Server Actions

All mutations and sensitive data fetching should be handled via Server Actions in `src/app/actions/`.

- **Validation**: Every action must use Zod to validate input data.
- **RBAC**: Use `requireRole` to enforce permissions.

```typescript
// Example Action
import { requireRole } from "@/lib/auth-rbac";
import { MySchema } from "@/lib/validators-rbac";

export async function myAction(data: unknown) {
  const session = await requireRole("ADMIN");
  const parsed = MySchema.parse(data);
  // ... logic
}
```

## 4. UI Standards

- **Framework**: Next.js 15.2.6 (App Router)
- **Styling**: Tailwind CSS v4
- **Components**: Reusable UI components are located in `src/components/`.

## 5. Deployment

Deployed via **Easypanel** (Docker).

- Main App: `Dockerfile`
- API Service: `Dockerfile.api`
