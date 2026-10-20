-- Add RoleplayScenario and RoleplayResponse models
-- This migration only adds new tables and modifies RoleplaySession
-- Does not touch existing tables with cross-schema references (messages, notifications)

-- Create RoleplayStatus enum
DO $$ BEGIN
  CREATE TYPE "public"."RoleplayStatus" AS ENUM ('PENDING', 'EVALUATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add new fields to RoleplaySession
ALTER TABLE "public"."roleplay_sessions" 
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "current_scenario_index" INTEGER DEFAULT 0;

-- Preserve compatibility with both the legacy enum and the current lifecycle enum.
-- The current application uses DRAFT; older databases may still only have PENDING.
DO $status_default$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'RoleplayStatus'
      AND e.enumlabel = 'DRAFT'
  ) THEN
    EXECUTE 'ALTER TABLE public.roleplay_sessions ALTER COLUMN status SET DEFAULT ''DRAFT''';
  ELSIF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'RoleplayStatus'
      AND e.enumlabel = 'PENDING'
  ) THEN
    EXECUTE 'ALTER TABLE public.roleplay_sessions ALTER COLUMN status SET DEFAULT ''PENDING''';
  ELSE
    RAISE EXCEPTION 'RoleplayStatus must contain DRAFT or PENDING before applying the roleplay migration.';
  END IF;
END
$status_default$;

-- Create RoleplayScenario table
CREATE TABLE IF NOT EXISTS "public"."roleplay_scenarios" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "session_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "base_audio_url" TEXT NOT NULL,
    "duration_limit_sec" INTEGER,
    "script_prompt" TEXT,
    "expected_keys" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "roleplay_scenarios_pkey" PRIMARY KEY ("id")
);

-- Create RoleplayResponse table
CREATE TABLE IF NOT EXISTS "public"."roleplay_responses" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "scenario_id" TEXT NOT NULL,
    "recorded_audio_url" TEXT,
    "duration_sec" INTEGER,
    "self_score" JSONB,
    "self_notes" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "roleplay_responses_pkey" PRIMARY KEY ("id")
);

-- Create RoleplayAccess table
CREATE TABLE IF NOT EXISTS "public"."roleplay_access" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "roleplay_access_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys (only if they don't exist)
DO $$ BEGIN
  ALTER TABLE "public"."roleplay_scenarios" 
    ADD CONSTRAINT "roleplay_scenarios_session_id_fkey" 
    FOREIGN KEY ("session_id") REFERENCES "public"."roleplay_sessions"("id") 
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."roleplay_responses" 
    ADD CONSTRAINT "roleplay_responses_scenario_id_fkey" 
    FOREIGN KEY ("scenario_id") REFERENCES "public"."roleplay_scenarios"("id") 
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."roleplay_access" 
    ADD CONSTRAINT "roleplay_access_session_id_fkey" 
    FOREIGN KEY ("session_id") REFERENCES "public"."roleplay_sessions"("id") 
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add indexes
CREATE INDEX IF NOT EXISTS "idx_roleplay_scenarios_session_order" 
  ON "public"."roleplay_scenarios" ("session_id", "order");

CREATE INDEX IF NOT EXISTS "idx_roleplay_access_token_hash" 
  ON "public"."roleplay_access" ("token_hash");

CREATE INDEX IF NOT EXISTS "idx_roleplay_access_expires" 
  ON "public"."roleplay_access" ("expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "roleplay_access_session_id_key" 
  ON "public"."roleplay_access" ("session_id");

-- Add indexes to RoleplaySession
CREATE INDEX IF NOT EXISTS "idx_roleplay_sessions_status_created" 
  ON "public"."roleplay_sessions" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "idx_roleplay_sessions_status_submitted" 
  ON "public"."roleplay_sessions" ("status", "submitted_at");

-- XOR constraint: exactly one of interpreter_id or recruitment_candidate_id must be set
DO $$ BEGIN
  ALTER TABLE "public"."roleplay_sessions"
    ADD CONSTRAINT "roleplay_session_xor_subject" 
    CHECK (((interpreter_id IS NOT NULL)::int + (recruitment_candidate_id IS NOT NULL)::int) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;