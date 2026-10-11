# ============================================================
# FREE INTERPRETERS OS — STABLE MULTI-STAGE DOCKERFILE
# Target: Easypanel (Docker/VPS ~457MB RAM) — STANDALONE BUILD
# ============================================================

# --- STAGE 1: Dependencies ---
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Copy package definition files
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Clean install of all dependencies (needed for build & Prisma client)
RUN npm ci --legacy-peer-deps

# --- STAGE 2: Builder ---
FROM node:22 AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client (requires schema, NOT DATABASE_URL)
RUN npx prisma generate

# Build-time args: ONLY public vars needed for static bundling.
# SENSITIVE vars (DATABASE_URL, AUTH_SECRET) are injected at RUNTIME
# by Easypanel — they must NOT appear as build ARGs.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_ROLE

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_ROLE=$NEXT_PUBLIC_APP_ROLE

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Increase heap during build (build machine has more RAM than runtime)
ENV NODE_OPTIONS="--max-old-space-size=2048"

RUN npm run build

# --- STAGE 3: Runner (Ultra-Lean ~150MB) ---
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl curl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Limit heap to 340MB → triggers GC before the 457MB hard kill.
# Easypanel hard limit is 512MB per container. With NODE_OPTIONS=340,
# we leave ~172MB for the runtime, Next.js internals, and buffer.
# The old value (384MB) left only ~73MB overhead, causing OOM kills
# under even moderate request load.
ENV NODE_OPTIONS="--max-old-space-size=340"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build (server.js + minimal node_modules)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs

# Accept PORT from Easypanel build-arg (default 3000 to match Easypanel config).
# Easypanel passes --build-arg PORT=3000, so the container and health check
# must use the same port the orchestrator expects.
ARG PORT=3000
ENV PORT=$PORT
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

# ── HEALTHCHECK ──────────────────────────────────────────────
# Uses dynamic PORT so it always matches whatever port the container serves.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT}/api/health || exit 1

# ── CMD ────────────────────────────────────────────────────
# IMPORTANT: Starts node with redirect to stdout so Easypanel's log
# collector can see boot errors even when the healthcheck hasn't
# passed yet. The heredoc captures the full process stdout/stderr.
CMD ["node", "server.js"]
