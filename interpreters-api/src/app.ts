import express, { Request, Response } from 'express';
import cors from 'cors';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/users.routes.js';
import callRoutes from './routes/calls.js';
import productionRoutes from './routes/production.js';
import { globalErrorHandler } from './middlewares/errorHandler.js';
import { asyncHandler } from './lib/asyncHandler.js';
import { prisma } from './lib/prisma.js';
import { AppError } from './lib/AppError.js';
import { resolveAllowedCorsOrigins, isCorsOriginAllowed } from './lib/cors-policy.js';
import { createCachedReadinessProbe } from './lib/readiness.js';

/**
 * EXPRESS APPLICATION SETUP
 * ============================================================
 * Middleware pipeline (order matters):
 *   1. CORS → restrict origins
 *   2. JSON parser → reject payloads > 512KB
 *   3. Routes → business logic
 *   4. 404 catch-all → unknown endpoints
 *   5. globalErrorHandler → unified error formatting
 * ============================================================
 */

const app = express();

// ── Core Middlewares ──────────────────────────────────────
// CORS: Only allow known frontends. NEVER use cors() with no config in production.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGINS = resolveAllowedCorsOrigins(process.env.CORS_ORIGINS, IS_PRODUCTION);

app.use(
  cors({
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin, ALLOWED_ORIGINS, IS_PRODUCTION)) {
        callback(null, true);
      } else {
        // Constant message: never echo attacker-controlled origin to logs.
        callback(AppError.forbidden('Cross-origin request is not allowed'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Parse JSON with a strict size limit to prevent memory bombs
app.use(express.json({ limit: '512kb' }));

// Disable x-powered-by header (security hygiene)
app.disable('x-powered-by');


// ── Routes ────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/calls', callRoutes);
app.use('/api/v1/production', productionRoutes);


// ── Liveness and Readiness ───────────────────────────────
// /health is only process liveness, not proof that PostgreSQL is available.
// Docker/Easypanel MUST use /ready to avoid marking a DB-unavailable backend
// as healthy. Coalesce public requests to protect the tiny shared DB pool.
const checkDatabaseReadiness = createCachedReadinessProbe(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
app.get('/health', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    service: 'interpreters-api',
    uptime: Math.floor(process.uptime()),
  });
});

app.get('/ready', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const ready = await checkDatabaseReadiness();
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'unavailable',
    service: 'interpreters-api',
  });
});


// ── 404 Catch-All (MUST be after all routes) ──────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      type: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
});


// ── Centralized Error Handler (MUST be last) ──────────────
app.use(globalErrorHandler);

export default app;
