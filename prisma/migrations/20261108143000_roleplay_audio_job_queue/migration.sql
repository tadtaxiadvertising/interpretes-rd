-- Persistent PostgreSQL-backed queue for Roleplay audio conversion.
-- Additive only: existing responses and sessions remain readable and unchanged.

DO $$
BEGIN
  CREATE TYPE "public"."RoleplayAudioJobStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "public"."roleplay_audio_jobs" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "scenario_id" TEXT NOT NULL,
  "source_audio_path" TEXT NOT NULL,
  "status" "public"."RoleplayAudioJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" TEXT,
  "last_error" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "roleplay_audio_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roleplay_audio_jobs_source_audio_path_key" UNIQUE ("source_audio_path"),
  CONSTRAINT "roleplay_audio_jobs_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "public"."roleplay_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "roleplay_audio_jobs_scenario_id_fkey"
    FOREIGN KEY ("scenario_id") REFERENCES "public"."roleplay_scenarios"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "roleplay_audio_jobs_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "roleplay_audio_jobs_max_attempts_check" CHECK ("max_attempts" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_roleplay_audio_jobs_claim"
  ON "public"."roleplay_audio_jobs" ("status", "available_at", "created_at");

CREATE INDEX IF NOT EXISTS "idx_roleplay_audio_jobs_session"
  ON "public"."roleplay_audio_jobs" ("session_id");

CREATE INDEX IF NOT EXISTS "idx_roleplay_audio_jobs_scenario"
  ON "public"."roleplay_audio_jobs" ("scenario_id");
