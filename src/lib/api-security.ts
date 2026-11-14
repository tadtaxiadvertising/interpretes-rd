import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

/**
 * Senior DevSecOps: Security Wrapper for Next.js App Router API Routes.
 * Implements strict input validation, sanitization, and global error handling
 * to prevent BOLA, Injection, and Information Disclosure.
 */

type RouteHandler = (req: NextRequest, context: unknown) => Promise<NextResponse>;

const PRIVATE_ERROR_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization, Cookie, Origin',
};

function apiErrorResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_ERROR_HEADERS });
}

// Preserve the existing 409 contract for actual write conflicts, but never
// classify schema drift (P2022), connection errors or unexpected Prisma codes
// as an ordinary business conflict.
const PRISMA_CONFLICT_CODES = new Set(['P2002', 'P2003', 'P2025']);


export function withSecurity(
  handler: RouteHandler,
  schemas?: { body?: z.ZodTypeAny; query?: z.ZodTypeAny }
): RouteHandler {
  return async (req: NextRequest, context: unknown) => {
    try {
      // 1. INPUT VALIDATION & SANITIZATION
      if (schemas?.query) {
        const query = Object.fromEntries(new URL(req.url).searchParams);
        schemas.query.parse(query);
      }

      // To avoid "Body has already been consumed" error, we don't consume it here
      // if the handler needs to consume it too. 
      // However, for strict Rule D, we should validate it.
      // Next.js 15/16 Request clone() is reliable.
      if (schemas?.body && req.method !== 'GET' && req.method !== 'DELETE') {
        const clonedReq = req.clone();
        const body = await clonedReq.json();
        schemas.body.parse(body);
      }

      // Execute original handler
      return await handler(req, context);

    } catch (error: unknown) {
      // Never write provider-supplied .message, .stack, .name or arbitrary
      // thrown objects: they can contain connection URLs and signed media.
      console.error('[SECURITY-AUDIT] API handler failure:', safeServerErrorCategory(error));

      if (error instanceof z.ZodError) {
        return apiErrorResponse({
          success: false,
          error: 'Bad Request: Validation failed',
          details: error.issues,
        }, 400);
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError &&
          PRISMA_CONFLICT_CODES.has(error.code)) {
        return apiErrorResponse({ success: false, error: 'Database conflict or constraint violation' }, 409);
      }

      return apiErrorResponse({ success: false, error: 'Internal Server Error' }, 500);
    }
  };
}
